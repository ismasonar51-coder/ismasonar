// =====================================================================
// ISMASONAR — Logique de l'accueil, création/jonction de salon, lobby
// Phase 1 : structure + Firebase + lobby temps réel
// =====================================================================

import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, updateDoc,
  collection, addDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ---------- État local ----------
let sameRoomValue = true;   // true = tous dans la même pièce
let modeValue = "rounds";   // "rounds" ou "time"
let unsubscribePlayers = null;
let currentRoomCode = null;
let currentPlayerId = null;
let hostPlays = true;
const pendingSongs = { host: [null, null], player: [null, null] };
const MIN_PLAYERS = 3; // ajustable selon tes tests

// ---------- Navigation entre vues ----------
function showView(id){
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById(id).classList.add("active");
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

    // Le host apparaît aussi dans la liste des joueurs
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

    document.getElementById("display-room-code").textContent = code;
    generateQRCode(code);
    listenPlayers(code, "host-player-list", "player-count");
    showView("view-host-lobby");
  } catch(err){
    console.error(err);
    alert("Erreur lors de la création du salon : " + err.message);
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

    document.getElementById("display-join-code").textContent = code;
    listenPlayers(code, "player-player-list", "player-count-2");
    showView("view-player-lobby");
  } catch(err){
    console.error(err);
    errorEl.textContent = "Erreur de connexion, réessaie.";
  }
}
window.handleJoinRoom = handleJoinRoom;

// ---------- Liste des joueurs en temps réel ----------
function listenPlayers(code, listElementId, countElementId){
  if(unsubscribePlayers) unsubscribePlayers();

  const listEl = document.getElementById(listElementId);
  const countEl = document.getElementById(countElementId);

  unsubscribePlayers = onSnapshot(collection(db, "rooms", code, "players"), snapshot => {
    listEl.innerHTML = "";
    countEl.textContent = `(${snapshot.size})`;

    let readyCount = 0;
    let totalCount = 0;

    snapshot.forEach(playerDoc => {
      const player = playerDoc.data();
      totalCount++;
      const isReady = player.songsSubmitted === true;
      if(isReady) readyCount++;

      const li = document.createElement("li");
      li.innerHTML = `
        <span class="dot ${isReady ? "" : "pending"}"></span>
        <span>${escapeHtml(player.name)}</span>
        <span class="tags">
          ${player.isHost ? '<span class="host-tag">HOST</span>' : ""}
          ${isReady ? '<span class="ready-tag">🎵 prêt</span>' : ""}
        </span>
      `;
      listEl.appendChild(li);
    });

    // Le bouton "Lancer la partie" n'existe que côté host
    const startBtn = document.getElementById("btn-start-game");
    const startHint = document.getElementById("start-hint");
    if(startBtn){
      const allReady = totalCount > 0 && readyCount === totalCount;
      const enoughPlayers = totalCount >= MIN_PLAYERS;
      startBtn.disabled = !(allReady && enoughPlayers);

      if(!enoughPlayers){
        startHint.textContent = `Il faut au moins ${MIN_PLAYERS} joueurs (${totalCount}/${MIN_PLAYERS}).`;
      } else if(!allReady){
        startHint.textContent = `En attente des musiques : ${readyCount}/${totalCount} prêts.`;
      } else {
        startHint.textContent = "Tout le monde est prêt !";
      }
    }
  });
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
    statusEl.textContent = "Ajoute bien 2 musiques valides avant de valider.";
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

// ---------- Lancement de partie (placeholder, phase 2b) ----------
function handleStartGame(){
  alert("Bravo, tout le monde est prêt ! La logique de la partie (lecture des musiques, débat, vote, score) arrive dans la prochaine étape 🎶");
}
window.handleStartGame = handleStartGame;

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
