import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const myRankTextEl = document.getElementById("myRankText");
const myUsernameTextEl = document.getElementById("myUsernameText");
const myRatingTextEl = document.getElementById("myRatingText");
const myRecordTextEl = document.getElementById("myRecordText");

const leaderboardListEl = document.getElementById("leaderboardList");
const leaderboardHintEl = document.getElementById("leaderboardHint");

let currentUser = null;
let unsubscribeLeaderboard = null;

function createLeaderboardRow(player, rank, isMe) {
  const row = document.createElement("div");
  row.className = "room-code-box";
  row.style.display = "grid";
  row.style.gridTemplateColumns = "80px 1.5fr 120px 120px 140px";
  row.style.gap = "12px";
  row.style.alignItems = "center";
  row.style.marginBottom = "12px";

  if (isMe) {
    row.style.borderColor = "rgba(96, 165, 250, 0.55)";
    row.style.boxShadow = "0 0 0 1px rgba(96, 165, 250, 0.18)";
  }

  const rankEl = document.createElement("div");
  rankEl.innerHTML = `<span class="room-label">Rang</span><strong>#${rank}</strong>`;

  const nameEl = document.createElement("div");
  nameEl.innerHTML = `<span class="room-label">Spieler</span><strong>${player.username ?? "Player"}</strong>`;

  const ratingEl = document.createElement("div");
  ratingEl.innerHTML = `<span class="room-label">Rating</span><strong>${player.rating ?? 1000}</strong>`;

  const gamesEl = document.createElement("div");
  const totalGames = (player.wins ?? 0) + (player.losses ?? 0) + (player.draws ?? 0);
  gamesEl.innerHTML = `<span class="room-label">Spiele</span><strong>${totalGames}</strong>`;

  const recordEl = document.createElement("div");
  recordEl.innerHTML = `<span class="room-label">Bilanz</span><strong>${player.wins ?? 0} / ${player.losses ?? 0} / ${player.draws ?? 0}</strong>`;

  row.appendChild(rankEl);
  row.appendChild(nameEl);
  row.appendChild(ratingEl);
  row.appendChild(gamesEl);
  row.appendChild(recordEl);

  return row;
}

function renderLeaderboard(players) {
  leaderboardListEl.innerHTML = "";

  if (players.length === 0) {
    leaderboardHintEl.textContent = "Noch keine Spieler im Leaderboard.";
    myRankTextEl.textContent = "-";
    return;
  }

  leaderboardHintEl.textContent = `${players.length} Spieler geladen.`;

  let myRank = "-";
  let myFound = false;

  players.forEach((player, index) => {
    const rank = index + 1;
    const isMe = currentUser && player.id === currentUser.uid;

    if (isMe) {
      myFound = true;
      myRank = `#${rank}`;
      myUsernameTextEl.textContent = player.username ?? "-";
      myRatingTextEl.textContent = String(player.rating ?? 1000);
      myRecordTextEl.textContent = `${player.wins ?? 0} / ${player.losses ?? 0} / ${player.draws ?? 0}`;
    }

    leaderboardListEl.appendChild(createLeaderboardRow(player, rank, isMe));
  });

  myRankTextEl.textContent = myRank;

  if (currentUser && !myFound) {
    myUsernameTextEl.textContent = "Nicht gefunden";
    myRatingTextEl.textContent = "-";
    myRecordTextEl.textContent = "-";
  }
}

function sortPlayers(players) {
  return [...players].sort((a, b) => {
    const ratingDiff = (b.rating ?? 1000) - (a.rating ?? 1000);
    if (ratingDiff !== 0) return ratingDiff;

    const winDiff = (b.wins ?? 0) - (a.wins ?? 0);
    if (winDiff !== 0) return winDiff;

    const lossDiff = (a.losses ?? 0) - (b.losses ?? 0);
    if (lossDiff !== 0) return lossDiff;

    const drawDiff = (b.draws ?? 0) - (a.draws ?? 0);
    if (drawDiff !== 0) return drawDiff;

    return (a.username ?? "").localeCompare(b.username ?? "");
  });
}

function subscribeToLeaderboard() {
  if (unsubscribeLeaderboard) {
    unsubscribeLeaderboard();
    unsubscribeLeaderboard = null;
  }

  leaderboardHintEl.textContent = "Leaderboard wird live geladen...";

  unsubscribeLeaderboard = onSnapshot(
    collection(db, "users"),
    (snapshot) => {
      const players = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data()
      }));

      const sortedPlayers = sortPlayers(players);
      renderLeaderboard(sortedPlayers);
    },
    (error) => {
      console.error("Fehler beim Laden des Leaderboards:", error);
      leaderboardHintEl.textContent = "Fehler beim Laden des Leaderboards.";
    }
  );
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user ?? null;

  if (!user) {
    myRankTextEl.textContent = "-";
    myUsernameTextEl.textContent = "Nicht eingeloggt";
    myRatingTextEl.textContent = "-";
    myRecordTextEl.textContent = "-";
    subscribeToLeaderboard();
    return;
  }

  try {
    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);

    if (!snap.exists()) {
      myUsernameTextEl.textContent = "Profil fehlt";
      myRatingTextEl.textContent = "-";
      myRecordTextEl.textContent = "-";
    } else {
      const profile = snap.data();
      myUsernameTextEl.textContent = profile.username ?? "-";
      myRatingTextEl.textContent = String(profile.rating ?? 1000);
      myRecordTextEl.textContent = `${profile.wins ?? 0} / ${profile.losses ?? 0} / ${profile.draws ?? 0}`;
    }
  } catch (error) {
    console.error("Fehler beim Laden des Profils:", error);
  }

  subscribeToLeaderboard();
});