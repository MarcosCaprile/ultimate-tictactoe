import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  addDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
  updateDoc,
  setDoc,
  orderBy,
  serverTimestamp,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const profileUsernameEl = document.getElementById("profileUsername");
const profileStatusEl = document.getElementById("profileStatus");
const profileRatingEl = document.getElementById("profileRating");
const profileRecordEl = document.getElementById("profileRecord");

const searchToggleBtn = document.getElementById("searchToggleBtn");
const logoutBtn = document.getElementById("logoutBtn");

const searchingPlayersListEl = document.getElementById("searchingPlayersList");
const searchingPlayersHintEl = document.getElementById("searchingPlayersHint");

const incomingInvitesListEl = document.getElementById("incomingInvitesList");
const incomingInvitesHintEl = document.getElementById("incomingInvitesHint");

const outgoingInvitesListEl = document.getElementById("outgoingInvitesList");
const outgoingInvitesHintEl = document.getElementById("outgoingInvitesHint");

const onlineStatusHintEl = document.getElementById("onlineStatusHint");

let currentUser = null;
let currentProfile = null;
let activeGameRedirect = false;

function nowMs() {
  return Date.now();
}

async function updateOwnUserProfile(patch) {
  if (!currentUser) return;
  const userRef = doc(db, "users", currentUser.uid);
  await updateDoc(userRef, {
    ...patch,
    updatedAt: nowMs(),
    lastSeen: nowMs()
  });
}

function renderProfile(profile) {
  if (!profile) return;
  profileUsernameEl.textContent = profile.username ?? "-";
  profileStatusEl.textContent = profile.status ?? "-";
  profileRatingEl.textContent = String(profile.rating ?? 1000);
  profileRecordEl.textContent = `${profile.wins ?? 0} / ${profile.losses ?? 0} / ${profile.draws ?? 0}`;

  if (profile.status === "searching") {
    searchToggleBtn.textContent = "Suche beenden";
  } else {
    searchToggleBtn.textContent = "Ich suche Gegner";
  }
}

function createPlayerCard(player) {
  const wrapper = document.createElement("div");
  wrapper.className = "room-code-box";

  const name = document.createElement("div");
  name.className = "room-label";
  name.textContent = `${player.username} • Rating ${player.rating ?? 1000}`;

  const status = document.createElement("div");
  status.className = "join-hint";
  status.textContent = `Status: ${player.status}`;

  const button = document.createElement("button");
  button.className = "primary-btn small-btn";
  button.type = "button";
  button.style.marginTop = "12px";
  button.textContent = "Einladen";
  button.addEventListener("click", async () => {
    try {
      button.disabled = true;
      await sendInvite(player);
      onlineStatusHintEl.textContent = `Einladung an ${player.username} gesendet.`;
    } catch (error) {
      console.error(error);
      onlineStatusHintEl.textContent = `Fehler beim Einladen: ${error.message}`;
      button.disabled = false;
    }
  });

  wrapper.appendChild(name);
  wrapper.appendChild(status);
  wrapper.appendChild(button);

  return wrapper;
}

function createIncomingInviteCard(invite) {
  const wrapper = document.createElement("div");
  wrapper.className = "room-code-box";

  const title = document.createElement("div");
  title.className = "room-label";
  title.textContent = `${invite.fromUsername} lädt dich ein`;

  const status = document.createElement("div");
  status.className = "join-hint";
  status.textContent = `Status: ${invite.status}`;

  const buttonRow = document.createElement("div");
  buttonRow.className = "stack-actions";
  buttonRow.style.marginTop = "12px";

  const acceptBtn = document.createElement("button");
  acceptBtn.className = "primary-btn small-btn";
  acceptBtn.type = "button";
  acceptBtn.textContent = "Annehmen";
  acceptBtn.addEventListener("click", async () => {
    try {
      acceptBtn.disabled = true;
      declineBtn.disabled = true;
      await acceptInvite(invite);
    } catch (error) {
      console.error(error);
      onlineStatusHintEl.textContent = `Fehler beim Annehmen: ${error.message}`;
      acceptBtn.disabled = false;
      declineBtn.disabled = false;
    }
  });

  const declineBtn = document.createElement("button");
  declineBtn.className = "secondary-btn small-btn";
  declineBtn.type = "button";
  declineBtn.textContent = "Ablehnen";
  declineBtn.addEventListener("click", async () => {
    try {
      acceptBtn.disabled = true;
      declineBtn.disabled = true;
      await declineInvite(invite.id);
      onlineStatusHintEl.textContent = "Einladung abgelehnt.";
    } catch (error) {
      console.error(error);
      onlineStatusHintEl.textContent = `Fehler beim Ablehnen: ${error.message}`;
      acceptBtn.disabled = false;
      declineBtn.disabled = false;
    }
  });

  buttonRow.appendChild(acceptBtn);
  buttonRow.appendChild(declineBtn);

  wrapper.appendChild(title);
  wrapper.appendChild(status);
  wrapper.appendChild(buttonRow);

  return wrapper;
}

function createOutgoingInviteCard(invite) {
  const wrapper = document.createElement("div");
  wrapper.className = "room-code-box";

  const title = document.createElement("div");
  title.className = "room-label";
  title.textContent = `An ${invite.toUsername}`;

  const status = document.createElement("div");
  status.className = "join-hint";
  status.textContent = `Status: ${invite.status}`;

  wrapper.appendChild(title);
  wrapper.appendChild(status);

  return wrapper;
}

async function ensureOwnProfile(user) {
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) {
    const username = user.email?.split("@")[0] || "Player";
    await setDoc(userRef, {
      uid: user.uid,
      username,
      email: user.email ?? "",
      status: "online",
      lastSeen: nowMs(),
      rating: 1000,
      wins: 0,
      losses: 0,
      draws: 0,
      currentGameId: null,
      createdAt: nowMs(),
      updatedAt: nowMs()
    });
    return;
  }

  await updateDoc(userRef, {
    status: "online",
    lastSeen: nowMs(),
    updatedAt: nowMs()
  });
}

async function sendInvite(targetPlayer) {
  if (!currentUser || !currentProfile) {
    throw new Error("Nicht eingeloggt.");
  }

  if (targetPlayer.uid === currentUser.uid) {
    throw new Error("Du kannst dich nicht selbst einladen.");
  }

  await addDoc(collection(db, "invites"), {
    fromUid: currentUser.uid,
    fromUsername: currentProfile.username,
    toUid: targetPlayer.uid,
    toUsername: targetPlayer.username,
    status: "pending",
    createdAt: nowMs(),
    updatedAt: nowMs(),
    createdAtServer: serverTimestamp()
  });
}

async function declineInvite(inviteId) {
  const inviteRef = doc(db, "invites", inviteId);
  await updateDoc(inviteRef, {
    status: "declined",
    updatedAt: nowMs()
  });
}

async function acceptInvite(invite) {
  const inviteRef = doc(db, "invites", invite.id);
  const hostRef = doc(db, "users", invite.fromUid);
  const guestRef = doc(db, "users", invite.toUid);
  const gameRef = doc(collection(db, "games"));

  await runTransaction(db, async (transaction) => {
    const inviteSnap = await transaction.get(inviteRef);
    const hostSnap = await transaction.get(hostRef);
    const guestSnap = await transaction.get(guestRef);

    if (!inviteSnap.exists()) throw new Error("Einladung existiert nicht mehr.");
    if (!hostSnap.exists() || !guestSnap.exists()) throw new Error("Spielerprofil fehlt.");

    const inviteData = inviteSnap.data();
    const hostData = hostSnap.data();
    const guestData = guestSnap.data();

    if (inviteData.status !== "pending") {
      throw new Error("Diese Einladung ist nicht mehr offen.");
    }

    transaction.set(gameRef, {
      gameId: gameRef.id,
      hostUid: invite.fromUid,
      hostUsername: invite.fromUsername,
      guestUid: invite.toUid,
      guestUsername: invite.toUsername,
      hostSymbol: "X",
      guestSymbol: "O",
      status: "playing",
      currentPlayer: "X",
      nextBoardIndex: null,
      cellStates: Array(81).fill(""),
      miniBoardWinners: Array(9).fill(""),
      winner: "",
      hostConnected: false,
      guestConnected: false,
      hostLastSeen: null,
      guestLastSeen: null,
      createdAt: nowMs(),
      updatedAt: nowMs()
    });

    transaction.update(inviteRef, {
      status: "accepted",
      gameId: gameRef.id,
      updatedAt: nowMs()
    });

    transaction.update(hostRef, {
      status: "in_game",
      currentGameId: gameRef.id,
      updatedAt: nowMs(),
      lastSeen: nowMs()
    });

    transaction.update(guestRef, {
      status: "in_game",
      currentGameId: gameRef.id,
      updatedAt: nowMs(),
      lastSeen: nowMs()
    });

    if (hostData.currentGameId && hostData.currentGameId !== gameRef.id) {
      console.warn("Host war bereits in anderem Spiel eingetragen.");
    }
    if (guestData.currentGameId && guestData.currentGameId !== gameRef.id) {
      console.warn("Guest war bereits in anderem Spiel eingetragen.");
    }
  });

  window.location.href = `game.html?gameId=${encodeURIComponent(gameRef.id)}`;
}

function subscribeToProfile() {
  const userRef = doc(db, "users", currentUser.uid);

  onSnapshot(userRef, (snapshot) => {
    if (!snapshot.exists()) return;

    currentProfile = snapshot.data();
    renderProfile(currentProfile);

    if (
      currentProfile.status === "in_game" &&
      currentProfile.currentGameId &&
      !activeGameRedirect
    ) {
      activeGameRedirect = true;
      window.location.href = `game.html?gameId=${encodeURIComponent(currentProfile.currentGameId)}`;
    }
  });
}

function subscribeToSearchingPlayers() {
  const playersQuery = query(
    collection(db, "users"),
    where("status", "==", "searching")
  );

  onSnapshot(playersQuery, (snapshot) => {
    searchingPlayersListEl.innerHTML = "";

    const players = snapshot.docs
      .map((docSnap) => docSnap.data())
      .filter((player) => player.uid !== currentUser.uid);

    if (players.length === 0) {
      searchingPlayersHintEl.textContent = "Noch keine anderen suchenden Spieler.";
      return;
    }

    searchingPlayersHintEl.textContent = `${players.length} Spieler gefunden.`;

    players.forEach((player) => {
      searchingPlayersListEl.appendChild(createPlayerCard(player));
    });
  });
}

function subscribeToIncomingInvites() {
  const incomingQuery = query(
    collection(db, "invites"),
    where("toUid", "==", currentUser.uid),
    where("status", "==", "pending")
  );

  onSnapshot(incomingQuery, (snapshot) => {
    incomingInvitesListEl.innerHTML = "";

    const invites = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data()
    }));

    if (invites.length === 0) {
      incomingInvitesHintEl.textContent = "Keine offenen Einladungen.";
      return;
    }

    incomingInvitesHintEl.textContent = `${invites.length} offene Einladung(en).`;

    invites.forEach((invite) => {
      incomingInvitesListEl.appendChild(createIncomingInviteCard(invite));
    });
  });
}

function subscribeToOutgoingInvites() {
  const outgoingQuery = query(
    collection(db, "invites"),
    where("fromUid", "==", currentUser.uid)
  );

  onSnapshot(outgoingQuery, (snapshot) => {
    outgoingInvitesListEl.innerHTML = "";

    const invites = snapshot.docs
      .map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data()
      }))
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, 10);

    if (invites.length === 0) {
      outgoingInvitesHintEl.textContent = "Keine ausgehenden Einladungen.";
      return;
    }

    outgoingInvitesHintEl.textContent = `${invites.length} Einladung(en) geladen.`;

    invites.forEach((invite) => {
      outgoingInvitesListEl.appendChild(createOutgoingInviteCard(invite));
    });
  });
}

if (searchToggleBtn) {
  searchToggleBtn.addEventListener("click", async () => {
    if (!currentProfile) return;

    try {
      const nextStatus = currentProfile.status === "searching" ? "online" : "searching";
      await updateOwnUserProfile({
        status: nextStatus
      });
      onlineStatusHintEl.textContent =
        nextStatus === "searching"
          ? "Du bist jetzt auf Gegnersuche sichtbar."
          : "Du suchst aktuell nicht mehr.";
    } catch (error) {
      console.error(error);
      onlineStatusHintEl.textContent = `Fehler beim Statuswechsel: ${error.message}`;
    }
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      if (currentUser) {
        await updateOwnUserProfile({
          status: "offline",
          currentGameId: null
        });
      }
      await signOut(auth);
      window.location.href = "login.html";
    } catch (error) {
      console.error(error);
      onlineStatusHintEl.textContent = `Fehler beim Logout: ${error.message}`;
    }
  });
}

window.addEventListener("beforeunload", async () => {
  try {
    if (!currentUser || !currentProfile) return;

    if (currentProfile.status === "online" || currentProfile.status === "searching") {
      await updateOwnUserProfile({
        status: "offline"
      });
    } else {
      await updateOwnUserProfile({});
    }
  } catch (error) {
    console.error("beforeunload Fehler:", error);
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  currentUser = user;
  await ensureOwnProfile(user);

  subscribeToProfile();
  subscribeToSearchingPlayers();
  subscribeToIncomingInvites();
  subscribeToOutgoingInvites();
});