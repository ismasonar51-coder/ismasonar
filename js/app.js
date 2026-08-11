// =====================================================================
// ISMASONAR — Logique de l'accueil, création/jonction de salon, lobby
// Phase 1 : structure + Firebase + lobby temps réel
// =====================================================================

import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc,
  collection, addDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ---------- État local ----------
let sameRoomValue = true;   // true = tous dans la même pièce
let modeValue = "rounds";   // "rounds" ou "time"
let unsubscribePlayers = null;

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
    await addDoc(collection(db, "rooms", code, "players"), {
      name: hostName,
      isHost: true,
      score: 0,
      joinedAt: serverTimestamp()
    });

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

    await addDoc(collection(db, "rooms", code, "players"), {
      name: pseudo,
      isHost: false,
      score: 0,
      joinedAt: serverTimestamp()
    });

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

    snapshot.forEach(playerDoc => {
      const player = playerDoc.data();
      const li = document.createElement("li");
      li.innerHTML = `
        <span class="dot"></span>
        <span>${escapeHtml(player.name)}</span>
        ${player.isHost ? '<span class="host-tag">HOST</span>' : ""}
      `;
      listEl.appendChild(li);
    });
  });
}

function escapeHtml(str){
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
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
