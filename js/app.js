// =====================================================================
// ISMASONAR — Lobby, musiques, manches, débat, vote
// =====================================================================

import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, updateDoc, deleteDoc,
  collection, addDoc, getDocs, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ---------- État local ----------
let sameRoomValue = true;
let modeValue = "rounds";
let unsubscribePlayers = null;
let unsubscribeRoom = null;
let unsubscribeChat = null;
let currentRoomCode = null;
let currentPlayerId = null;
let hostPlays = true;
let currentPlayersCache = [];
let currentRoundIndexCache = 0;
let lastRenderedPhase = null;
let hasSeenSelfInRoom = false; // pour détecter une exclusion (et pas un simple délai de chargement)
const pendingSongs = { host: [null, null], player: [null, null] };
const MIN_PLAYERS = 3; // ajustable selon tes tests
const WARMUP_VIDEO_ID = "jNQXAC9IVRw"; // vidéo courte et fiable, sert juste à "débloquer" le son

// ---------- Minuteurs & audio ----------
let roundTimerInterval = null;
let ytPlayer = null;
let audioUnlocked = false;
let ytApiReadyResolve;
const ytApiReadyPromise = new Promise(resolve => { ytApiReadyResolve = resolve; });

function loadYouTubeAPI(){
  if(window.YT && window.YT.Player){ ytApiReadyResolve(); return; }
  const tag = document.createElement("script");
  tag.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(tag);
  window.onYouTubeIframeAPIReady = () => ytApiReadyResolve();
}
loadYouTubeAPI();

// ---------- Popup générique (remplace confirm()/alert()) ----------
function showModal({ message, confirmLabel, cancelLabel, danger }){
  return new Promise(resolve => {
    const overlay = document.getElementById("modal-overlay");
    document.getElementById("modal-message").textContent = message;
    const actions = document.getElementById("modal-actions");
    actions.innerHTML = "";

    if(cancelLabel){
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "btn-big btn-secondary";
      cancelBtn.textContent = cancelLabel;
      cancelBtn.onclick = () => { overlay.classList.remove("visible"); resolve(false); };
      actions.appendChild(cancelBtn);
    }

    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = danger ? "btn-big btn-danger" : "btn-big btn-primary";
    okBtn.textContent = confirmLabel || "OK";
    okBtn.onclick = () => { overlay.classList.remove("visible"); resolve(true); };
    actions.appendChild(okBtn);

    overlay.classList.remove("hidden");
    requestAnimationFrame(() => overlay.classList.add("visible"));
  });
}

function notify(message){
  showModal({ message, confirmLabel: "OK" });
}

// ---------- Navigation entre vues (avec fondu) ----------
function showView(id){
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active", "visible"));
  const target = document.getElementById(id);
  target.classList.add("active");
  requestAnimationFrame(() => target.classList.add("visible"));
}
window.showView = showView;

// ---------- Toggles du formulaire de création ----------
function setSameRoom(value){
  sameRoomValue = value;
  document.querySelectorAll("#toggle-same-room .toggle-option").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.value === String(value));
  });
  const hint = document.getElementById("same-room-hint");
  hint.textContent = value
    ? "Toi seul diffuseras la musique. Les autres verront juste les infos du titre."
    : "Chaque joueur recevra la musique sur son propre téléphone, et le chat texte sera activé pendant le débat.";
}
window.setSameRoom = setSameRoom;

function setMode(mode){
  modeValue = mode;
  document.querySelectorAll("#toggle-mode .toggle-option").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.value === mode);
  });
  document.getElementById("field-rounds-count").classList.toggle("hidden", mode !== "rounds");
  document.getElementById("field-time-minutes").classList.toggle("hidden", mode !== "time");
}
window.setMode = setMode;

// ---------- Génération d'un code de salon à 6 chiffres ----------
function randomCode(){
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function generateUniqueRoomCode(){
  for(let i = 0; i < 5; i++){
    const code = randomCode();
    const snap = await getDoc(doc(db, "rooms", code));
    if(!snap.exists()) return code;
  }
  throw new Error("Impossible de générer un code de salon, réessaie.");
}

// ---------- Activation du son (à faire une fois, dans le lobby) ----------
async function handleAudioWarmup(){
  await ytApiReadyPromise;
  if(!ytPlayer){
    ytPlayer = new YT.Player("yt-player-container", {
      height: "1",
      width: "1",
      videoId: WARMUP_VIDEO_ID,
      playerVars: { autoplay: 1, controls: 0, disablekb: 1, modestbranding: 1, rel: 0 },
      events: {
        onReady: e => {
          e.target.mute();
          e.target.playVideo();
          setTimeout(() => e.target.pauseVideo(), 400);
        }
      }
    });
  }
  audioUnlocked = true;
  document.getElementById("audio-warmup-host").classList.add("hidden");
  document.getElementById("audio-warmup-player").classList.add("hidden");
}
window.handleAudioWarmup = handleAudioWarmup;

function maybeShowAudioWarmup(sameRoom, elementId){
  if(!sameRoom && !audioUnlocked){
    document.getElementById(elementId).classList.remove("hidden");
  }
}

// ---------- Création d'un salon (host) ----------
async function handleCreateRoom(event){
  event.preventDefault();
  const submitBtn = event.target.querySelector(".btn-submit");
  submitBtn.disabled = true;
  submitBtn.textContent = "Création...";

  try{
    const hostName = document.getElementById("input-host-name").value.trim();
    const roundsCount = document.getElementById("input-rounds-count").value || null;
    const timeMinutes = document.getElementById("input-time-minutes").value || null;

    const code = await generateUniqueRoomCode();

    const settings = {
      sameRoom: sameRoomValue,
      mode: modeValue,
      roundsCount: modeValue === "rounds" && roundsCount ? Number(roundsCount) : null,
      timeMinutes: modeValue === "time" ? Number(timeMinutes) : null
    };

    await setDoc(doc(db, "rooms", code), {
      hostName,
      status: "lobby",
      settings,
      createdAt: serverTimestamp()
    });

    const playerRef = await addDoc(collection(db, "rooms", code, "players"), {
      name: hostName,
      isHost: true,
      isPlaying: true,
      songs: [],
      songsSubmitted: false,
      score: 0,
      joinedAt: serverTimestamp()
    });

    currentRoomCode = code;
    currentPlayerId = playerRef.id;
    hasSeenSelfInRoom = false;

    document.getElementById("display-room-code").textContent = code;
    generateQRCode(code);
    maybeShowAudioWarmup(sameRoomValue, "audio-warmup-host");
    listenPlayers(code, "host-player-list", "player-count", true);
    listenRoomStatus(code, true, sameRoomValue);
    showView("view-host-lobby");
  } catch(err){
    console.error(err);
    notify("Erreur lors de la création du salon : " + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Créer le salon";
  }
}
window.handleCreateRoom = handleCreateRoom;

// ---------- Rejoindre un salon (player) ----------
async function handleJoinRoom(event){
  event.preventDefault();
  const errorEl = document.getElementById("join-error");
  errorEl.textContent = "";

  const code = document.getElementById("input-join-code").value.trim();
  const pseudo = document.getElementById("input-join-name").value.trim();

  try{
    const roomSnap = await getDoc(doc(db, "rooms", code));
    if(!roomSnap.exists()){
      errorEl.textContent = "Ce salon n'existe pas. Vérifie le code.";
      return;
    }
    if(roomSnap.data().status !== "lobby"){
      errorEl.textContent = "Cette partie a déjà commencé.";
      return;
    }

    const existingPlayersSnap = await getDocs(collection(db, "rooms", code, "players"));
    const nameTaken = existingPlayersSnap.docs.some(
      p => p.data().name.trim().toLowerCase() === pseudo.toLowerCase()
    );
    if(nameTaken){
      errorEl.textContent = "Ce pseudo est déjà pris dans ce salon, choisis-en un autre.";
      return;
    }

    const playerRef = await addDoc(collection(db, "rooms", code, "players"), {
      name: pseudo,
      isHost: false,
      isPlaying: true,
      songs: [],
      songsSubmitted: false,
      score: 0,
      joinedAt: serverTimestamp()
    });

    currentRoomCode = code;
    currentPlayerId = playerRef.id;
    hasSeenSelfInRoom = false;

    document.getElementById("display-join-code").textContent = code;
    maybeShowAudioWarmup(roomSnap.data().settings.sameRoom, "audio-warmup-player");
    listenPlayers(code, "player-player-list", "player-count-2", false);
    listenRoomStatus(code, false, roomSnap.data().settings.sameRoom);
    showView("view-player-lobby");
  } catch(err){
    console.error(err);
    errorEl.textContent = "Erreur de connexion, réessaie.";
  }
}
window.handleJoinRoom = handleJoinRoom;

// ---------- Liste des joueurs en temps réel ----------
function listenPlayers(code, listElementId, countElementId, isHostView){
  if(unsubscribePlayers) unsubscribePlayers();

  const listEl = document.getElementById(listElementId);
  const countEl = document.getElementById(countElementId);
  const summaryEl = document.getElementById("player-summary");

  unsubscribePlayers = onSnapshot(collection(db, "rooms", code, "players"), snapshot => {
    currentPlayersCache = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

    // Détection d'exclusion (le joueur n'est plus dans la liste alors qu'il y était)
    if(!isHostView && currentPlayerId){
      const stillHere = currentPlayersCache.some(p => p.id === currentPlayerId);
      if(stillHere){
        hasSeenSelfInRoom = true;
      } else if(hasSeenSelfInRoom){
        handleKicked();
        return;
      }
    }

    countEl.textContent = `(${snapshot.size})`;

    let readyCount = 0;
    const totalCount = currentPlayersCache.length;

    if(isHostView){
      listEl.innerHTML = "";
      currentPlayersCache.forEach(player => {
        const isReady = player.songsSubmitted === true;
        if(isReady) readyCount++;

        const li = document.createElement("li");
        li.innerHTML = `
          <span class="dot ${isReady ? "" : "pending"}"></span>
          <span>${escapeHtml(player.name)}</span>
          <span class="tags">
            ${player.isHost ? '<span class="host-tag">HOST</span>' : ""}
            ${isReady ? '<span class="ready-tag">🎵 prêt</span>' : ""}
            ${!player.isHost ? `<button type="button" class="kick-btn" onclick="kickPlayer('${player.id}', '${escapeHtml(player.name)}')" title="Exclure ce joueur">✕</button>` : ""}
          </span>
        `;
        listEl.appendChild(li);
      });
    } else {
      // Vue joueur : pas de liste de noms, juste des chiffres
      readyCount = currentPlayersCache.filter(p => p.songsSubmitted === true).length;
      if(summaryEl) summaryEl.textContent = `${totalCount} joueur${totalCount > 1 ? "s" : ""} connecté${totalCount > 1 ? "s" : ""} · ${readyCount} prêt${readyCount > 1 ? "s" : ""}`;
    }

    const startBtn = document.getElementById("btn-start-game");
    const startHint = document.getElementById("start-hint");
    if(startBtn){
      const enoughReady = readyCount >= MIN_PLAYERS;
      startBtn.disabled = !enoughReady;

      if(!enoughReady){
        startHint.textContent = `En attente des musiques : ${readyCount}/${MIN_PLAYERS} prêts minimum.`;
      } else if(readyCount === totalCount){
        startHint.textContent = "Tout le monde est prêt !";
      } else {
        startHint.textContent = `${readyCount}/${totalCount} joueurs prêts — tu peux lancer, ou attendre les autres.`;
      }
    }
  });
}

async function kickPlayer(playerId, playerName){
  const confirmed = await showModal({
    message: `Exclure ${playerName} du salon ?`,
    confirmLabel: "Exclure",
    cancelLabel: "Annuler",
    danger: true
  });
  if(!confirmed) return;

  try{
    await deleteDoc(doc(db, "rooms", currentRoomCode, "players", playerId));
  } catch(err){
    console.error(err);
    notify("Impossible d'exclure ce joueur, réessaie.");
  }
}
window.kickPlayer = kickPlayer;

function handleKicked(){
  if(unsubscribePlayers) unsubscribePlayers();
  if(unsubscribeRoom) unsubscribeRoom();
  if(unsubscribeChat) unsubscribeChat();
  currentRoomCode = null;
  currentPlayerId = null;
  hasSeenSelfInRoom = false;

  showView("view-home");
  document.getElementById("kicked-message").classList.remove("hidden");
}

function escapeHtml(str){
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Le host joue ou reste arbitre ----------
function setHostPlays(value){
  hostPlays = value;
  document.querySelectorAll("#toggle-host-plays .toggle-option").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.value === String(value));
  });
  document.getElementById("songs-block-host").classList.toggle("hidden", !value);

  if(currentPlayerId){
    const updates = value
      ? { isPlaying: true, songsSubmitted: false, songs: [] }
      : { isPlaying: false, songsSubmitted: true, songs: [] };
    updateDoc(doc(db, "rooms", currentRoomCode, "players", currentPlayerId), updates);
  }
}
window.setHostPlays = setHostPlays;

// ---------- Musiques : extraction d'ID YouTube ----------
function extractYouTubeId(url){
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

async function fetchYouTubeTitle(videoId){
  const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
  if(!res.ok) throw new Error("Vidéo introuvable");
  const data = await res.json();
  return data.title;
}

async function handleSongInput(role, slot){
  const input = document.getElementById(`song${slot}-input-${role}`);
  const preview = document.getElementById(`song${slot}-preview-${role}`);
  const url = input.value.trim();

  if(!url){
    preview.textContent = "";
    preview.className = "song-preview";
    pendingSongs[role][slot - 1] = null;
    return;
  }

  const videoId = extractYouTubeId(url);
  if(!videoId){
    preview.textContent = "⚠️ Lien YouTube invalide";
    preview.className = "song-preview error";
    pendingSongs[role][slot - 1] = null;
    return;
  }

  // Vérifie que ce n'est pas la même musique que l'autre champ
  const otherSlot = slot === 1 ? 2 : 1;
  const otherSong = pendingSongs[role][otherSlot - 1];
  if(otherSong && otherSong.youtubeId === videoId){
    preview.textContent = "⚠️ Tu as déjà mis cette musique dans l'autre champ";
    preview.className = "song-preview error";
    pendingSongs[role][slot - 1] = null;
    return;
  }

  preview.textContent = "Chargement...";
  preview.className = "song-preview";

  try{
    const title = await fetchYouTubeTitle(videoId);
    preview.textContent = "✓ " + title;
    preview.className = "song-preview valid";
    pendingSongs[role][slot - 1] = { youtubeId: videoId, title };
  } catch(err){
    preview.textContent = "⚠️ Vidéo introuvable";
    preview.className = "song-preview error";
    pendingSongs[role][slot - 1] = null;
  }
}
window.handleSongInput = handleSongInput;

async function submitSongs(role){
  const [song1, song2] = pendingSongs[role];
  const statusEl = document.getElementById(`songs-status-${role}`);

  if(!song1 || !song2){
    statusEl.textContent = "Ajoute bien 2 musiques valides et différentes avant de valider.";
    statusEl.style.color = "var(--danger)";
    return;
  }
  if(song1.youtubeId === song2.youtubeId){
    statusEl.textContent = "Les 2 musiques doivent être différentes.";
    statusEl.style.color = "var(--danger)";
    return;
  }

  try{
    await updateDoc(doc(db, "rooms", currentRoomCode, "players", currentPlayerId), {
      songs: [song1, song2],
      songsSubmitted: true
    });
    statusEl.textContent = "✓ Musiques enregistrées !";
    statusEl.style.color = "var(--teal)";
  } catch(err){
    console.error(err);
    statusEl.textContent = "Erreur, réessaie.";
    statusEl.style.color = "var(--danger)";
  }
}
window.submitSongs = submitSongs;

// ---------- Sélection des musiques pour la partie ----------
function shuffle(array){
  for(let i = array.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function buildRoundOrder(readyPlayers, settings){
  let pool;

  if(settings.mode === "rounds" && !settings.roundsCount){
    pool = readyPlayers.map(p => {
      const song = p.songs[Math.floor(Math.random() * p.songs.length)];
      return { playerId: p.id, youtubeId: song.youtubeId, title: song.title };
    });
  } else {
    pool = readyPlayers.flatMap(p =>
      p.songs.map(song => ({ playerId: p.id, youtubeId: song.youtubeId, title: song.title }))
    );
  }

  shuffle(pool);

  let roundsCount;
  if(settings.mode === "time"){
    roundsCount = Math.max(1, Math.round(settings.timeMinutes));
  } else {
    roundsCount = settings.roundsCount || pool.length;
  }

  return pool.slice(0, Math.min(roundsCount, pool.length));
}

// ---------- Lancement de la partie ----------
async function handleStartGame(){
  const startBtn = document.getElementById("btn-start-game");
  startBtn.disabled = true;
  startBtn.textContent = "Lancement...";
  audioUnlocked = true; // le clic du host sert de geste utilisateur

  try{
    const roomSnap = await getDoc(doc(db, "rooms", currentRoomCode));
    const settings = roomSnap.data().settings;

    const playersSnap = await getDocs(collection(db, "rooms", currentRoomCode, "players"));
    const readyPlayers = playersSnap.docs
      .filter(d => d.data().songsSubmitted)
      .map(d => ({ id: d.id, songs: d.data().songs }));

    const roundOrder = buildRoundOrder(readyPlayers, settings);
    const activePlayerIds = readyPlayers.map(p => p.id);

    await updateDoc(doc(db, "rooms", currentRoomCode), {
      status: "playing",
      roundOrder,
      activePlayerIds,
      currentRoundIndex: 0,
      roundPhase: "song",
      phaseStartedAt: serverTimestamp(),
      votes: {}
    });
  } catch(err){
    console.error(err);
    notify("Erreur au lancement de la partie, réessaie.");
    startBtn.disabled = false;
    startBtn.textContent = "Lancer la partie";
  }
}
window.handleStartGame = handleStartGame;

// ---------- Suivi de l'état de la partie (room) ----------
function listenRoomStatus(code, isHost, sameRoom){
  if(unsubscribeRoom) unsubscribeRoom();
  unsubscribeRoom = onSnapshot(doc(db, "rooms", code), snap => {
    const room = snap.data();
    if(!room) return;
    if(room.status === "playing"){
      currentRoundIndexCache = room.currentRoundIndex;
      renderRoundState(room, isHost, sameRoom);
    }
  });
}

// ---------- Dispatcher d'affichage selon la phase de la manche ----------
function renderRoundState(room, isHost, sameRoom){
  const phaseKey = `${room.currentRoundIndex}-${room.roundPhase}`;
  const isNewPhase = phaseKey !== lastRenderedPhase;
  lastRenderedPhase = phaseKey;

  if(room.roundPhase === "song"){
    if(isNewPhase) enterSongPhase(room, isHost, sameRoom);
  } else if(room.roundPhase === "debate"){
    if(isNewPhase) enterDebatePhase(room, isHost, sameRoom);
  } else if(room.roundPhase === "voting"){
    renderVotingPhase(room, isHost);
  } else if(room.roundPhase === "results"){
    if(isNewPhase) enterResultsPlaceholder();
  }
}

// ---------- Phase 1 : lecture de la musique ----------
function enterSongPhase(room, isHost, sameRoom){
  showView("view-round");

  const round = room.roundOrder[room.currentRoundIndex];
  document.getElementById("round-progress").textContent =
    `Manche ${room.currentRoundIndex + 1} / ${room.roundOrder.length}`;
  document.getElementById("round-ended-message").classList.add("hidden");
  document.getElementById("round-unlock-btn").classList.add("hidden");

  const hostOnlyCaption = document.getElementById("round-audio-host-only");
  const playerCaption = document.getElementById("round-audio-player");

  const onTimerEnd = () => {
    if(ytPlayer && ytPlayer.pauseVideo) ytPlayer.pauseVideo();
    if(isHost) advanceToDebate();
  };

  if(sameRoom && !isHost){
    hostOnlyCaption.classList.remove("hidden");
    playerCaption.classList.add("hidden");
    startCountdown(room.phaseStartedAt, "round-countdown", onTimerEnd);
  } else {
    hostOnlyCaption.classList.add("hidden");
    playerCaption.classList.remove("hidden");

    if(audioUnlocked){
      playRoundSong(round.youtubeId);
    } else {
      // Filet de sécurité si le son n'a pas été activé dans le lobby
      document.getElementById("round-unlock-btn").classList.remove("hidden");
      document.getElementById("round-unlock-btn").onclick = () => {
        audioUnlocked = true;
        document.getElementById("round-unlock-btn").classList.add("hidden");
        playRoundSong(round.youtubeId);
      };
    }
    startCountdown(room.phaseStartedAt, "round-countdown", onTimerEnd);
  }
}

async function advanceToDebate(){
  try{
    await updateDoc(doc(db, "rooms", currentRoomCode), {
      roundPhase: "debate",
      phaseStartedAt: serverTimestamp()
    });
  } catch(err){ console.error(err); }
}

// ---------- Phase 2 : débat ----------
function enterDebatePhase(room, isHost, sameRoom){
  showView("view-debate");
  document.getElementById("debate-progress").textContent =
    `Manche ${room.currentRoundIndex + 1} / ${room.roundOrder.length} — Débat`;

  const chatBlock = document.getElementById("debate-chat-block");
  if(!sameRoom){
    chatBlock.classList.remove("hidden");
    listenChat(room.currentRoundIndex);
  } else {
    chatBlock.classList.add("hidden");
    if(unsubscribeChat) unsubscribeChat();
  }

  startCountdown(room.phaseStartedAt, "debate-countdown", () => {
    if(isHost) advanceToVoting();
  });
}

async function advanceToVoting(){
  try{
    await updateDoc(doc(db, "rooms", currentRoomCode), {
      roundPhase: "voting",
      phaseStartedAt: serverTimestamp()
    });
  } catch(err){ console.error(err); }
}

// ---------- Chat texte (mode à distance uniquement) ----------
function listenChat(roundIndex){
  if(unsubscribeChat) unsubscribeChat();
  const chatEl = document.getElementById("chat-messages");
  chatEl.innerHTML = "";

  unsubscribeChat = onSnapshot(collection(db, "rooms", currentRoomCode, "chat"), snapshot => {
    const messages = snapshot.docs
      .map(d => d.data())
      .filter(m => m.roundIndex === roundIndex)
      .sort((a, b) => (a.sentAt?.toMillis?.() || 0) - (b.sentAt?.toMillis?.() || 0));

    chatEl.innerHTML = messages.map(m => `
      <li><strong>${escapeHtml(m.name)}:</strong> ${escapeHtml(m.text)}</li>
    `).join("");
    chatEl.scrollTop = chatEl.scrollHeight;
  });
}

async function sendChatMessage(event){
  event.preventDefault();
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if(!text) return;

  const me = currentPlayersCache.find(p => p.id === currentPlayerId);
  input.value = "";

  try{
    await addDoc(collection(db, "rooms", currentRoomCode, "chat"), {
      name: me ? me.name : "?",
      text,
      roundIndex: currentRoundIndexCache,
      sentAt: serverTimestamp()
    });
  } catch(err){ console.error(err); }
}
window.sendChatMessage = sendChatMessage;

// ---------- Phase 3 : vote ----------
function renderVotingPhase(room, isHost){
  showView("view-voting");
  document.getElementById("voting-progress").textContent =
    `Manche ${room.currentRoundIndex + 1} / ${room.roundOrder.length} — Vote`;

  const votes = room.votes || {};
  const myVote = votes[currentPlayerId];
  const listEl = document.getElementById("vote-list");
  const statusEl = document.getElementById("voting-status");

  const votedCount = Object.keys(votes).length;
  const totalActive = room.activePlayerIds.length;

  if(myVote){
    listEl.innerHTML = "";
    statusEl.textContent = `✓ Vote enregistré. En attente des autres joueurs... (${votedCount}/${totalActive})`;
  } else {
    listEl.innerHTML = currentPlayersCache
      .filter(p => p.id !== currentPlayerId && room.activePlayerIds.includes(p.id))
      .map(p => `<li class="vote-card" onclick="submitVote('${p.id}')">${escapeHtml(p.name)}</li>`)
      .join("");
    statusEl.textContent = `Choisis qui, selon toi, a proposé cette musique. (${votedCount}/${totalActive})`;
  }

  if(isHost && votedCount >= totalActive && room.roundPhase === "voting"){
    advanceToResultsPlaceholder();
  }
}

async function submitVote(votedForId){
  try{
    await updateDoc(doc(db, "rooms", currentRoomCode), {
      [`votes.${currentPlayerId}`]: votedForId
    });
  } catch(err){
    console.error(err);
    notify("Erreur lors du vote, réessaie.");
  }
}
window.submitVote = submitVote;

async function advanceToResultsPlaceholder(){
  try{
    await updateDoc(doc(db, "rooms", currentRoomCode), { roundPhase: "results" });
  } catch(err){ console.error(err); }
}

// ---------- Phase 4 : résultats (placeholder, calcul des scores à venir) ----------
function enterResultsPlaceholder(){
  showView("view-voting");
  document.getElementById("vote-list").innerHTML = "";
  document.getElementById("voting-status").textContent =
    "🚧 Tous les votes sont reçus ! Le calcul des scores et l'écran de résultats arrivent dans la prochaine étape.";
}

// ---------- Minuteur générique (30s) ----------
function startCountdown(startTimestamp, elementId, onExpire){
  clearInterval(roundTimerInterval);
  const startMs = startTimestamp && startTimestamp.toMillis ? startTimestamp.toMillis() : Date.now();
  const countdownEl = document.getElementById(elementId);
  let expired = false;

  roundTimerInterval = setInterval(() => {
    const elapsed = (Date.now() - startMs) / 1000;
    const remaining = Math.max(0, Math.ceil(30 - elapsed));
    countdownEl.textContent = remaining;

    if(remaining <= 0 && !expired){
      expired = true;
      clearInterval(roundTimerInterval);
      onExpire();
    }
  }, 250);
}

// ---------- Lecture audio (vidéo cachée, YouTube IFrame API) ----------
async function playRoundSong(videoId){
  await ytApiReadyPromise;
  if(ytPlayer){
    ytPlayer.unMute();
    ytPlayer.loadVideoById(videoId);
    return;
  }
  ytPlayer = new YT.Player("yt-player-container", {
    height: "1",
    width: "1",
    videoId: videoId,
    playerVars: { autoplay: 1, controls: 0, disablekb: 1, modestbranding: 1, rel: 0 },
    events: { onReady: e => { e.target.unMute(); e.target.playVideo(); } }
  });
}

// ---------- QR Code ----------
function generateQRCode(code){
  const container = document.getElementById("qrcode-container");
  container.innerHTML = "";
  // eslint-disable-next-line no-undef
  new QRCode(container, {
    text: code,
    width: 140,
    height: 140,
    colorDark: "#0c0d18",
    colorLight: "#ffffff"
  });
}

// ---------- Init ----------
setSameRoom(true);
setMode("rounds");
