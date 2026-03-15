import { db } from "./firebase.js";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  deleteDoc,
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const generatedCodeEl = document.getElementById("generatedCode");
const generateCodeBtn = document.getElementById("generateCodeBtn");
const createHint = document.getElementById("createHint");

const joinRoomBtn = document.getElementById("joinRoomBtn");
const roomInput = document.getElementById("roomInput");
const joinHint = document.getElementById("joinHint");

const queueStatusTextEl = document.getElementById("queueStatusText");
const queueDetailTextEl = document.getElementById("queueDetailText");
const queueHintEl = document.getElementById("queueHint");
const cancelQueueBtn = document.getElementById("cancelQueueBtn");

const ultimateBoard = document.getElementById("ultimateBoard");
const currentPlayerEl = document.getElementById("currentPlayer");
const targetBoardEl = document.getElementById("targetBoard");
const statusTextEl = document.getElementById("statusText");
const resetBtn = document.getElementById("resetBtn");
const leaveRoomBtn = document.getElementById("leaveRoomBtn");
const copyRoomCodeBtn = document.getElementById("copyRoomCodeBtn");
const copyJoinLinkBtn = document.getElementById("copyJoinLinkBtn");
const modeTextEl = document.getElementById("modeText");
const roomCodeTextEl = document.getElementById("roomCodeText");
const playerRoleTextEl = document.getElementById("playerRoleText");
const opponentStatusTextEl = document.getElementById("opponentStatusText");
const gameSubtitleEl = document.getElementById("gameSubtitle");

const WINNING_COMBINATIONS = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6]
];

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_PREFIX = "UTTT";
const MAX_ROOM_CODE_ATTEMPTS = 25;

const HEARTBEAT_INTERVAL_MS = 5000;
const PLAYER_STALE_AFTER_MS = 15000;
const ROOM_DELETE_AFTER_EMPTY_MS = 25000;
const FINISHED_ROOM_RETENTION_MS = 5 * 60 * 1000;

const MATCHMAKING_DOC_PREFIX = "queue-";
const MATCHMAKING_WAITING_TIMEOUT_MS = 45000;
const MATCHMAKING_CHECK_INTERVAL_MS = 2500;

let isCreatingRoom = false;
let isJoiningRoom = false;

function nowMs() {
  return Date.now();
}

function createEmptyCellStates() {
  return Array(81).fill("");
}

function createEmptyMiniWinners() {
  return Array(9).fill("");
}

function getFlatIndex(boardIndex, cellIndex) {
  return boardIndex * 9 + cellIndex;
}

function getCellValue(cellStates, boardIndex, cellIndex) {
  return cellStates[getFlatIndex(boardIndex, cellIndex)];
}

function setCellValue(cellStates, boardIndex, cellIndex, value) {
  cellStates[getFlatIndex(boardIndex, cellIndex)] = value;
}

function getMiniBoard(cellStates, boardIndex) {
  const start = boardIndex * 9;
  return cellStates.slice(start, start + 9);
}

function randomCodePart(length) {
  let result = "";

  for (let i = 0; i < length; i++) {
    const index = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
    result += ROOM_CODE_ALPHABET[index];
  }

  return result;
}

function randomToken() {
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function generateRoomCode() {
  return `${ROOM_CODE_PREFIX}-${randomCodePart(ROOM_CODE_LENGTH)}`;
}

function getWinner(board) {
  for (const combination of WINNING_COMBINATIONS) {
    const [a, b, c] = combination;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  return "";
}

function findWinningLine(board) {
  for (const combination of WINNING_COMBINATIONS) {
    const [a, b, c] = combination;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return combination;
    }
  }
  return null;
}

function isBoardFull(board) {
  return board.every((cell) => cell !== "");
}

function boardName(index) {
  const row = Math.floor(index / 3) + 1;
  const col = (index % 3) + 1;
  return `Reihe ${row}, Spalte ${col}`;
}

function readGameMode() {
  const params = new URLSearchParams(window.location.search);
  return params.get("mode");
}

function readRoomCode() {
  const params = new URLSearchParams(window.location.search);
  return params.get("room");
}

function readAuthToken() {
  const params = new URLSearchParams(window.location.search);
  return params.get("auth");
}

function readJoinCodeFromLobbyUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("join");
}

function readQueueId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("queue");
}

function buildQuickMatchUrl(queueId) {
  return `quickmatch.html?queue=${encodeURIComponent(queueId)}`;
}

function isPresenceOnline(connected, lastSeen) {
  if (!connected) return false;
  if (typeof lastSeen !== "number") return false;
  return nowMs() - lastSeen <= PLAYER_STALE_AFTER_MS;
}

function bothPlayersOffline(game) {
  const hostOnline = isPresenceOnline(game.hostConnected, game.hostLastSeen);
  const guestExists = !!game.guest;
  const guestOnline = guestExists
    ? isPresenceOnline(game.guestConnected, game.guestLastSeen)
    : false;

  if (!guestExists) {
    return !hostOnline;
  }

  return !hostOnline && !guestOnline;
}

function roomShouldBeDeleted(game) {
  const updatedAt = typeof game.updatedAt === "number" ? game.updatedAt : 0;
  const ageSinceUpdate = nowMs() - updatedAt;

  if (game.status === "finished" && ageSinceUpdate > FINISHED_ROOM_RETENTION_MS) {
    return true;
  }

  if (bothPlayersOffline(game) && ageSinceUpdate > ROOM_DELETE_AFTER_EMPTY_MS) {
    return true;
  }

  return false;
}

function queueShouldBeDeleted(queueEntry) {
  if (!queueEntry) return false;
  const updatedAt = typeof queueEntry.updatedAt === "number" ? queueEntry.updatedAt : 0;
  return nowMs() - updatedAt > MATCHMAKING_WAITING_TIMEOUT_MS;
}

async function cleanupExpiredRooms() {
  try {
    const snapshot = await getDocs(collection(db, "games"));

    for (const roomDoc of snapshot.docs) {
      const game = roomDoc.data();

      if (roomShouldBeDeleted(game)) {
        await deleteDoc(roomDoc.ref);
      }
    }
  } catch (error) {
    console.error("Fehler beim Aufräumen alter Rooms:", error);
  }
}

async function cleanupExpiredQueue() {
  try {
    const snapshot = await getDocs(collection(db, "matchmakingQueue"));

    for (const queueDoc of snapshot.docs) {
      const entry = queueDoc.data();
      if (queueShouldBeDeleted(entry)) {
        await deleteDoc(queueDoc.ref);
      }
    }
  } catch (error) {
    console.error("Fehler beim Aufräumen der Matchmaking-Queue:", error);
  }
}

async function roomExists(roomCode) {
  const roomRef = doc(db, "games", roomCode);
  const snapshot = await getDoc(roomRef);
  return snapshot.exists();
}

async function generateUniqueRoomCode() {
  for (let attempt = 0; attempt < MAX_ROOM_CODE_ATTEMPTS; attempt++) {
    const roomCode = generateRoomCode();
    const exists = await roomExists(roomCode);

    if (!exists) {
      return roomCode;
    }
  }

  throw new Error("Es konnte kein freier Room-Code erzeugt werden. Bitte versuche es erneut.");
}

function buildHostGameUrl(roomCode, hostToken, isRandom = false) {
  const mode = isRandom ? "random-host" : "private-host";
  return `game.html?room=${encodeURIComponent(roomCode)}&mode=${encodeURIComponent(mode)}&auth=${encodeURIComponent(hostToken)}`;
}

function buildGuestGameUrl(roomCode, joinToken, isRandom = false) {
  const mode = isRandom ? "random-guest" : "private-guest";
  return `game.html?room=${encodeURIComponent(roomCode)}&mode=${encodeURIComponent(mode)}&auth=${encodeURIComponent(joinToken)}`;
}

function buildJoinLink(roomCode, joinToken) {
  return `${window.location.origin}/game.html?room=${encodeURIComponent(roomCode)}&mode=private-guest&auth=${encodeURIComponent(joinToken)}`;
}

async function createRoom(roomCode) {
  const roomRef = doc(db, "games", roomCode);
  const existingSnapshot = await getDoc(roomRef);

  if (existingSnapshot.exists()) {
    throw new Error("Dieser Room-Code ist bereits belegt.");
  }

  const timestamp = nowMs();
  const hostToken = `host-${randomToken()}`;
  const joinToken = `join-${randomToken()}`;

  await setDoc(roomRef, {
    roomCode,
    status: "waiting",
    host: {
      name: "Player 1",
      symbol: "X"
    },
    guest: null,

    hostToken,
    joinToken,

    hostConnected: false,
    hostLastSeen: null,
    guestConnected: false,
    guestLastSeen: null,

    currentPlayer: "X",
    nextBoardIndex: null,
    cellStates: createEmptyCellStates(),
    miniBoardWinners: createEmptyMiniWinners(),
    winner: "",

    createdAt: timestamp,
    updatedAt: timestamp
  });

  return { hostToken, joinToken };
}

if (roomInput) {
  const joinCode = readJoinCodeFromLobbyUrl();
  if (joinCode) {
    roomInput.value = joinCode.toUpperCase();
    if (joinHint) {
      joinHint.textContent = `Join-Link erkannt für ${joinCode.toUpperCase()}.`;
    }
  }
}

if (generateCodeBtn && generatedCodeEl && createHint) {
  cleanupExpiredRooms();

  generateCodeBtn.addEventListener("click", async () => {
    if (isCreatingRoom) return;

    isCreatingRoom = true;
    generateCodeBtn.disabled = true;
    createHint.textContent = "Sicherer Room-Code wird erzeugt...";

    try {
      const roomCode = await generateUniqueRoomCode();
      generatedCodeEl.textContent = roomCode;
      createHint.textContent = "Room wird erstellt...";

      const { hostToken } = await createRoom(roomCode);

      createHint.textContent = `Room ${roomCode} erstellt. Weiterleitung als Host...`;
      window.location.href = buildHostGameUrl(roomCode, hostToken, false);
    } catch (error) {
      console.error("Fehler beim Erstellen des Rooms:", error);
      createHint.textContent = `Fehler beim Erstellen des Rooms: ${error.message}`;
      generateCodeBtn.disabled = false;
      isCreatingRoom = false;
    }
  });
}

if (joinRoomBtn && roomInput && joinHint) {
  cleanupExpiredRooms();

  joinRoomBtn.addEventListener("click", async () => {
    if (isJoiningRoom) return;

    const roomCode = roomInput.value.trim().toUpperCase();

    if (!roomCode) {
      joinHint.textContent = "Bitte gib zuerst einen Room-Code ein.";
      return;
    }

    try {
      isJoiningRoom = true;
      joinRoomBtn.disabled = true;
      joinHint.textContent = "Room wird gesucht...";

      const gameRef = doc(db, "games", roomCode);
      const snap = await getDoc(gameRef);

      if (!snap.exists()) {
        joinHint.textContent = "Room nicht gefunden.";
        joinRoomBtn.disabled = false;
        isJoiningRoom = false;
        return;
      }

      const game = snap.data();

      if (roomShouldBeDeleted(game)) {
        await deleteDoc(gameRef);
        joinHint.textContent = "Dieser Room ist abgelaufen.";
        joinRoomBtn.disabled = false;
        isJoiningRoom = false;
        return;
      }

      if (!game.joinToken) {
        joinHint.textContent = "Dieser Room ist ungültig.";
        joinRoomBtn.disabled = false;
        isJoiningRoom = false;
        return;
      }

      if (game.guest) {
        joinHint.textContent = "Room ist bereits voll.";
        joinRoomBtn.disabled = false;
        isJoiningRoom = false;
        return;
      }

      await updateDoc(gameRef, {
        guest: {
          name: "Player 2",
          symbol: "O"
        },
        guestConnected: false,
        guestLastSeen: null,
        status: "playing",
        updatedAt: nowMs()
      });

      window.location.href = buildGuestGameUrl(roomCode, game.joinToken, false);
    } catch (error) {
      console.error("Fehler beim Joinen des Rooms:", error);
      joinHint.textContent = `Fehler beim Joinen des Rooms: ${error.message}`;
      joinRoomBtn.disabled = false;
      isJoiningRoom = false;
    }
  });
}

/* =========================
   QUICK MATCH / RANDOM MODE
   ========================= */

if (queueStatusTextEl && queueDetailTextEl && queueHintEl && cancelQueueBtn) {
  let queueId = readQueueId();
  if (!queueId) {
    queueId = `${MATCHMAKING_DOC_PREFIX}${randomToken()}`;
    history.replaceState({}, "", buildQuickMatchUrl(queueId));
  }

  const queueRef = doc(db, "matchmakingQueue", queueId);
  let queueWatcherActive = true;
  let matchmakingInterval = null;
  let redirecting = false;

  cleanupExpiredRooms();
  cleanupExpiredQueue();

  async function ensureQueueEntry() {
    const snapshot = await getDoc(queueRef);

    if (!snapshot.exists()) {
      await setDoc(queueRef, {
        queueId,
        status: "waiting",
        createdAt: nowMs(),
        updatedAt: nowMs(),
        roomCode: null,
        authToken: null,
        role: null
      });
    } else {
      const data = snapshot.data();
      if (data.status !== "matched") {
        await updateDoc(queueRef, {
          status: "waiting",
          updatedAt: nowMs()
        });
      }
    }
  }

  async function tryMatchOpponent() {
    if (redirecting) return;

    const ownSnap = await getDoc(queueRef);
    if (!ownSnap.exists()) return;

    const ownEntry = ownSnap.data();
    if (ownEntry.status !== "waiting") return;

    const allQueuesSnap = await getDocs(collection(db, "matchmakingQueue"));
    const waitingEntries = [];

    allQueuesSnap.forEach((docSnap) => {
      const data = docSnap.data();
      if (
        docSnap.id !== queueId &&
        data.status === "waiting" &&
        !queueShouldBeDeleted(data)
      ) {
        waitingEntries.push({ id: docSnap.id, ...data });
      }
    });

    waitingEntries.sort((a, b) => a.createdAt - b.createdAt);

    const opponent = waitingEntries[0];
    if (!opponent) return;

    const latestOpponentSnap = await getDoc(doc(db, "matchmakingQueue", opponent.id));
    if (!latestOpponentSnap.exists()) return;

    const latestOpponent = latestOpponentSnap.data();
    if (latestOpponent.status !== "waiting") return;

    const roomCode = await generateUniqueRoomCode();
    const { hostToken, joinToken } = await createRoom(roomCode);

    await updateDoc(doc(db, "games", roomCode), {
      status: "playing",
      guest: {
        name: "Player 2",
        symbol: "O"
      },
      updatedAt: nowMs()
    });

    await updateDoc(queueRef, {
      status: "matched",
      roomCode,
      authToken: hostToken,
      role: "host",
      updatedAt: nowMs()
    });

    await updateDoc(doc(db, "matchmakingQueue", opponent.id), {
      status: "matched",
      roomCode,
      authToken: joinToken,
      role: "guest",
      updatedAt: nowMs()
    });
  }

  async function heartbeatQueue() {
    try {
      const snap = await getDoc(queueRef);
      if (!snap.exists()) return;

      const data = snap.data();
      if (data.status === "waiting") {
        await updateDoc(queueRef, {
          updatedAt: nowMs()
        });
      }
    } catch (error) {
      console.error("Queue-Heartbeat fehlgeschlagen:", error);
    }
  }

  async function removeQueueEntry() {
    try {
      await deleteDoc(queueRef);
    } catch (error) {
      console.error("Queue-Löschen fehlgeschlagen:", error);
    }
  }

  cancelQueueBtn.addEventListener("click", async () => {
    queueWatcherActive = false;
    if (matchmakingInterval) {
      clearInterval(matchmakingInterval);
    }
    await removeQueueEntry();
    window.location.href = "play.html";
  });

  window.addEventListener("beforeunload", async () => {
    if (!redirecting) {
      await removeQueueEntry();
    }
  });

  ensureQueueEntry().then(() => {
    queueStatusTextEl.textContent = "Suche läuft";
    queueHintEl.textContent = "Warte auf einen zufälligen Gegner...";

    onSnapshot(queueRef, async (snapshot) => {
      if (!queueWatcherActive || redirecting) return;

      if (!snapshot.exists()) {
        queueStatusTextEl.textContent = "Queue beendet";
        queueHintEl.textContent = "Die Suche wurde beendet.";
        return;
      }

      const data = snapshot.data();

      if (data.status === "waiting") {
        queueStatusTextEl.textContent = "Suche läuft";
        queueDetailTextEl.textContent = "Sobald ein anderer Spieler sucht, wird automatisch ein Match erstellt.";
        queueHintEl.textContent = "Noch kein Gegner gefunden.";
      }

      if (data.status === "matched" && data.roomCode && data.authToken && data.role) {
        redirecting = true;
        queueStatusTextEl.textContent = "Match gefunden!";
        queueHintEl.textContent = "Weiterleitung ins Spiel...";

        if (matchmakingInterval) {
          clearInterval(matchmakingInterval);
        }

        await removeQueueEntry();

        const isHost = data.role === "host";
        window.location.href = isHost
          ? buildHostGameUrl(data.roomCode, data.authToken, true)
          : buildGuestGameUrl(data.roomCode, data.authToken, true);
      }
    });

    matchmakingInterval = setInterval(async () => {
      await heartbeatQueue();
      await tryMatchOpponent();
    }, MATCHMAKING_CHECK_INTERVAL_MS);

    tryMatchOpponent();
  });
}

/* =========================
   GAME LOGIC
   ========================= */

if (
  ultimateBoard &&
  currentPlayerEl &&
  targetBoardEl &&
  statusTextEl &&
  resetBtn &&
  modeTextEl &&
  roomCodeTextEl &&
  playerRoleTextEl &&
  opponentStatusTextEl
) {
  let currentPlayer = "X";
  let nextBoardIndex = null;
  let gameOver = false;

  let cellStates = createEmptyCellStates();
  let miniBoardWinners = createEmptyMiniWinners();

  const roomCode = readRoomCode();
  const authToken = readAuthToken();
  let mode = readGameMode();
  let playerSymbol = "X";
  const isRealtimeGame = Boolean(roomCode);
  const isBotMode = mode === "bot-easy" || mode === "bot-medium" || mode === "bot-hard";
  const botDifficulty = isBotMode ? mode.replace("bot-", "") : null;

  let currentGameStatus = "waiting";
  let opponentOnline = false;
  const roomRef = roomCode ? doc(db, "games", roomCode) : null;
  let heartbeatInterval = null;
  let isLeavingRoom = false;
  let globalWinningLine = null;
  let globalWinner = "";
  let roomJoinToken = null;
  let botThinking = false;

  function getRolePrefix() {
    return playerSymbol === "X" ? "host" : "guest";
  }

  function setModeDisplay() {
    if (mode === "private-host") {
      modeTextEl.textContent = "Private Host";
      playerSymbol = "X";
    } else if (mode === "private-guest") {
      modeTextEl.textContent = "Private Guest";
      playerSymbol = "O";
    } else if (mode === "random-host") {
      modeTextEl.textContent = "Random Match";
      playerSymbol = "X";
    } else if (mode === "random-guest") {
      modeTextEl.textContent = "Random Match";
      playerSymbol = "O";
    } else if (mode === "local") {
      modeTextEl.textContent = "Local";
      playerSymbol = "X";
    } else if (mode === "bot-easy") {
      modeTextEl.textContent = "Bot Easy";
      playerSymbol = "X";
    } else if (mode === "bot-medium") {
      modeTextEl.textContent = "Bot Medium";
      playerSymbol = "X";
    } else if (mode === "bot-hard") {
      modeTextEl.textContent = "Bot Hard";
      playerSymbol = "X";
    } else {
      modeTextEl.textContent = isRealtimeGame ? "Online Match" : "Standard";
      playerSymbol = "X";
    }

    playerRoleTextEl.textContent = playerSymbol;
    roomCodeTextEl.textContent = roomCode ? roomCode : "-";

    if (isBotMode) {
      opponentOnline = true;
      opponentStatusTextEl.textContent = `Bot (${botDifficulty})`;
    } else {
      opponentStatusTextEl.textContent = isRealtimeGame ? "Wird geprüft..." : "Nicht relevant";
    }

    if (gameSubtitleEl) {
      if (mode === "random-host" || mode === "random-guest") {
        gameSubtitleEl.textContent = `Random Match gegen einen zufälligen Online-Gegner.`;
      } else if (isBotMode) {
        gameSubtitleEl.textContent = `Offline gegen Bot (${botDifficulty}).`;
      } else if (roomCode) {
        gameSubtitleEl.textContent = `Verbunden mit Room ${roomCode}.`;
      } else {
        gameSubtitleEl.textContent = "Lokales Spiel ohne Realtime-Room.";
      }
    }

    if (copyJoinLinkBtn) {
      copyJoinLinkBtn.style.display = roomCode && !mode?.startsWith("random-") ? "inline-flex" : "none";
    }

    if (copyRoomCodeBtn) {
      copyRoomCodeBtn.style.display = roomCode ? "inline-flex" : "none";
    }

    if (leaveRoomBtn) {
      leaveRoomBtn.style.display = roomCode ? "inline-flex" : "none";
    }
  }

  function createBoard() {
    ultimateBoard.innerHTML = "";

    for (let boardIndex = 0; boardIndex < 9; boardIndex++) {
      const miniBoard = document.createElement("div");
      miniBoard.className = "mini-board";
      miniBoard.dataset.boardIndex = String(boardIndex);

      for (let cellIndex = 0; cellIndex < 9; cellIndex++) {
        const cell = document.createElement("button");
        cell.className = "cell";
        cell.dataset.boardIndex = String(boardIndex);
        cell.dataset.cellIndex = String(cellIndex);
        cell.type = "button";
        cell.addEventListener("click", handleCellClick);
        miniBoard.appendChild(cell);
      }

      ultimateBoard.appendChild(miniBoard);
    }

    render();
  }

  function getAllValidMovesForState(stateCellStates, stateMiniBoardWinners, stateNextBoardIndex) {
    const moves = [];

    for (let boardIndex = 0; boardIndex < 9; boardIndex++) {
      if (stateMiniBoardWinners[boardIndex] !== "") continue;

      const boardAllowed = stateNextBoardIndex === null || stateNextBoardIndex === boardIndex;
      if (!boardAllowed) continue;

      for (let cellIndex = 0; cellIndex < 9; cellIndex++) {
        if (getCellValue(stateCellStates, boardIndex, cellIndex) === "") {
          moves.push({ boardIndex, cellIndex });
        }
      }
    }

    return moves;
  }

  function buildNextStateFrom(player, stateCellStates, stateMiniBoardWinners, stateNextBoardIndex, boardIndex, cellIndex) {
    const newCellStates = [...stateCellStates];
    const newMiniBoardWinners = [...stateMiniBoardWinners];

    setCellValue(newCellStates, boardIndex, cellIndex, player);

    const miniBoard = getMiniBoard(newCellStates, boardIndex);
    const miniWinner = getWinner(miniBoard);

    if (miniWinner) {
      newMiniBoardWinners[boardIndex] = miniWinner;
    } else if (isBoardFull(miniBoard)) {
      newMiniBoardWinners[boardIndex] = "draw";
    }

    const normalizedGlobalBoard = newMiniBoardWinners.map((value) => {
      return value === "draw" ? "" : value;
    });

    const foundGlobalWinner = getWinner(normalizedGlobalBoard);
    const foundWinningLine = findWinningLine(normalizedGlobalBoard);

    let newGameOver = false;
    let newStatusText = "Spiel läuft";
    let newStatus = "playing";
    let newWinner = "";
    let newNextBoardIndex = cellIndex;
    let newCurrentPlayer = player === "X" ? "O" : "X";

    if (foundGlobalWinner) {
      newGameOver = true;
      newWinner = foundGlobalWinner;
      newStatus = "finished";
      newStatusText = `Spieler ${foundGlobalWinner} gewinnt das Spiel!`;
      newNextBoardIndex = null;
      newCurrentPlayer = player;
    } else if (newMiniBoardWinners.every((value) => value !== "")) {
      newGameOver = true;
      newWinner = "draw";
      newStatus = "finished";
      newStatusText = "Unentschieden!";
      newNextBoardIndex = null;
      newCurrentPlayer = player;
    } else {
      if (newMiniBoardWinners[newNextBoardIndex] !== "") {
        newNextBoardIndex = null;
      }
    }

    return {
      cellStates: newCellStates,
      miniBoardWinners: newMiniBoardWinners,
      currentPlayer: newCurrentPlayer,
      nextBoardIndex: newNextBoardIndex,
      winner: newWinner,
      status: newStatus,
      statusText: newStatusText,
      gameOver: newGameOver,
      globalWinningLine: foundWinningLine
    };
  }

  function buildNextState(boardIndex, cellIndex) {
    return buildNextStateFrom(
      currentPlayer,
      cellStates,
      miniBoardWinners,
      nextBoardIndex,
      boardIndex,
      cellIndex
    );
  }

  function evaluateBoardForBot(stateCellStates, stateMiniBoardWinners) {
    let score = 0;
    const normalizedGlobalBoard = stateMiniBoardWinners.map((value) => (value === "draw" ? "" : value));
    const globalWinnerFound = getWinner(normalizedGlobalBoard);

    if (globalWinnerFound === "O") score += 100000;
    if (globalWinnerFound === "X") score -= 100000;

    stateMiniBoardWinners.forEach((winner, index) => {
      const centerBonus = index === 4 ? 18 : [0, 2, 6, 8].includes(index) ? 10 : 6;
      if (winner === "O") score += 60 + centerBonus;
      if (winner === "X") score -= 60 + centerBonus;
    });

    WINNING_COMBINATIONS.forEach(([a, b, c]) => {
      const line = [normalizedGlobalBoard[a], normalizedGlobalBoard[b], normalizedGlobalBoard[c]];
      const oCount = line.filter((v) => v === "O").length;
      const xCount = line.filter((v) => v === "X").length;
      const emptyCount = line.filter((v) => v === "").length;

      if (oCount === 2 && emptyCount === 1) score += 140;
      if (xCount === 2 && emptyCount === 1) score -= 150;
      if (oCount === 1 && emptyCount === 2) score += 18;
      if (xCount === 1 && emptyCount === 2) score -= 18;
    });

    for (let boardIndex = 0; boardIndex < 9; boardIndex++) {
      if (stateMiniBoardWinners[boardIndex] !== "") continue;
      const mini = getMiniBoard(stateCellStates, boardIndex);

      WINNING_COMBINATIONS.forEach(([a, b, c]) => {
        const line = [mini[a], mini[b], mini[c]];
        const oCount = line.filter((v) => v === "O").length;
        const xCount = line.filter((v) => v === "X").length;
        const emptyCount = line.filter((v) => v === "").length;

        if (oCount === 2 && emptyCount === 1) score += 22;
        if (xCount === 2 && emptyCount === 1) score -= 24;
        if (oCount === 1 && emptyCount === 2) score += 4;
        if (xCount === 1 && emptyCount === 2) score -= 4;
      });

      if (mini[4] === "O") score += 5;
      if (mini[4] === "X") score -= 5;
    }

    return score;
  }

  function chooseBotMove() {
    const validMoves = getAllValidMovesForState(cellStates, miniBoardWinners, nextBoardIndex);
    if (validMoves.length === 0) return null;

    if (botDifficulty === "easy") {
      return validMoves[Math.floor(Math.random() * validMoves.length)];
    }

    let bestMove = null;
    let bestScore = -Infinity;

    for (const move of validMoves) {
      const botState = buildNextStateFrom(
        "O",
        cellStates,
        miniBoardWinners,
        nextBoardIndex,
        move.boardIndex,
        move.cellIndex
      );

      let score = evaluateBoardForBot(botState.cellStates, botState.miniBoardWinners);

      if (botState.winner === "O") {
        score += 500000;
      }

      const centerBoardBonus = move.boardIndex === 4 ? 14 : [0, 2, 6, 8].includes(move.boardIndex) ? 8 : 4;
      const centerCellBonus = move.cellIndex === 4 ? 12 : [0, 2, 6, 8].includes(move.cellIndex) ? 6 : 3;
      score += centerBoardBonus + centerCellBonus;

      if (botDifficulty === "hard" && !botState.gameOver) {
        const opponentMoves = getAllValidMovesForState(
          botState.cellStates,
          botState.miniBoardWinners,
          botState.nextBoardIndex
        );

        let opponentBestScore = -Infinity;

        for (const oppMove of opponentMoves) {
          const oppState = buildNextStateFrom(
            "X",
            botState.cellStates,
            botState.miniBoardWinners,
            botState.nextBoardIndex,
            oppMove.boardIndex,
            oppMove.cellIndex
          );

          let oppScore = -evaluateBoardForBot(oppState.cellStates, oppState.miniBoardWinners);

          if (oppState.winner === "X") {
            oppScore += 400000;
          }

          if (oppScore > opponentBestScore) {
            opponentBestScore = oppScore;
          }
        }

        if (opponentBestScore !== -Infinity) {
          score -= opponentBestScore * 0.8;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    return bestMove ?? validMoves[0];
  }

  function maybeTriggerBotMove() {
    if (!isBotMode) return;
    if (gameOver) return;
    if (currentPlayer !== "O") return;
    if (botThinking) return;

    botThinking = true;
    statusTextEl.textContent = `Bot (${botDifficulty}) denkt...`;

    window.setTimeout(() => {
      const move = chooseBotMove();
      if (!move) {
        botThinking = false;
        return;
      }

      const nextState = buildNextStateFrom(
        "O",
        cellStates,
        miniBoardWinners,
        nextBoardIndex,
        move.boardIndex,
        move.cellIndex
      );

      cellStates = nextState.cellStates;
      miniBoardWinners = nextState.miniBoardWinners;
      currentPlayer = nextState.currentPlayer;
      nextBoardIndex = nextState.nextBoardIndex;
      gameOver = nextState.gameOver;
      statusTextEl.textContent = nextState.statusText;
      globalWinner = nextState.winner;
      globalWinningLine = nextState.globalWinningLine;

      botThinking = false;
      render();
    }, botDifficulty === "easy" ? 350 : botDifficulty === "medium" ? 500 : 650);
  }

  function getLineCoordinates(line) {
    const centerMap = {
      0: { x: 16.67, y: 16.67 },
      1: { x: 50, y: 16.67 },
      2: { x: 83.33, y: 16.67 },
      3: { x: 16.67, y: 50 },
      4: { x: 50, y: 50 },
      5: { x: 83.33, y: 50 },
      6: { x: 16.67, y: 83.33 },
      7: { x: 50, y: 83.33 },
      8: { x: 83.33, y: 83.33 }
    };

    const start = centerMap[line[0]];
    const end = centerMap[line[2]];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);

    return {
      left: start.x,
      top: start.y,
      width: length,
      angle
    };
  }

  function getResultOverlayData() {
    if (!gameOver || !globalWinner) {
      if (globalWinner === "draw") {
        return {
          variant: "draw",
          title: "Unentschieden",
          subtitle: "Keiner hat das Match gewonnen."
        };
      }
      return null;
    }

    if (!isRealtimeGame && !isBotMode) {
      return {
        variant: "win",
        title: `Spieler ${globalWinner} gewinnt!`,
        subtitle: "Das Spiel ist entschieden."
      };
    }

    if (isBotMode) {
      if (globalWinner === "X") {
        return {
          variant: "win",
          title: "Du gewinnst!",
          subtitle: `Du hast Bot (${botDifficulty}) besiegt.`
        };
      }
      if (globalWinner === "O") {
        return {
          variant: "loss",
          title: "Du verlierst!",
          subtitle: `Bot (${botDifficulty}) hat gewonnen.`
        };
      }
    }

    if (globalWinner === playerSymbol) {
      return {
        variant: "win",
        title: "Du gewinnst!",
        subtitle: "Starker Zug — das Match gehört dir."
      };
    }

    return {
      variant: "loss",
      title: "Du verlierst!",
      subtitle: `Spieler ${globalWinner} hat das Match gewonnen.`
    };
  }

  function renderGlobalEffects() {
    const existingLine = ultimateBoard.querySelector(".global-win-line");
    if (existingLine) existingLine.remove();

    const existingOverlay = ultimateBoard.querySelector(".game-result-overlay");
    if (existingOverlay) existingOverlay.remove();

    if (globalWinningLine && globalWinner && globalWinner !== "draw") {
      const coords = getLineCoordinates(globalWinningLine);
      const line = document.createElement("div");
      line.className = `global-win-line ${globalWinner.toLowerCase()}`;
      line.style.left = `${coords.left}%`;
      line.style.top = `${coords.top}%`;
      line.style.width = `${coords.width}%`;
      line.style.transform = `translateY(-50%) rotate(${coords.angle}deg) scaleX(1)`;
      ultimateBoard.appendChild(line);
    }

    const overlayData = getResultOverlayData();
    if (!overlayData) return;

    const overlay = document.createElement("div");
    overlay.className = `game-result-overlay ${overlayData.variant}`;

    overlay.innerHTML = `
      <div class="game-result-inner">
        <div class="game-result-title">${overlayData.title}</div>
        <div class="game-result-subtitle">${overlayData.subtitle}</div>
      </div>
    `;

    ultimateBoard.appendChild(overlay);
  }

  async function handleCellClick(event) {
    const target = event.currentTarget;
    const boardIndex = Number(target.dataset.boardIndex);
    const cellIndex = Number(target.dataset.cellIndex);

    if (!isMoveAllowed(boardIndex, cellIndex)) return;

    const nextState = buildNextState(boardIndex, cellIndex);

    if (isRealtimeGame && roomRef) {
      try {
        await updateDoc(roomRef, {
          cellStates: nextState.cellStates,
          miniBoardWinners: nextState.miniBoardWinners,
          currentPlayer: nextState.currentPlayer,
          nextBoardIndex: nextState.nextBoardIndex,
          winner: nextState.winner,
          status: nextState.status,
          updatedAt: nowMs()
        });
      } catch (error) {
        console.error(error);
        statusTextEl.textContent = "Fehler beim Synchronisieren des Zuges.";
      }
      return;
    }

    cellStates = nextState.cellStates;
    miniBoardWinners = nextState.miniBoardWinners;
    currentPlayer = nextState.currentPlayer;
    nextBoardIndex = nextState.nextBoardIndex;
    gameOver = nextState.gameOver;
    statusTextEl.textContent = nextState.statusText;
    globalWinner = nextState.winner;
    globalWinningLine = nextState.globalWinningLine;

    render();
    maybeTriggerBotMove();
  }

  function render() {
    const miniBoards = document.querySelectorAll(".mini-board");

    miniBoards.forEach((miniBoard, boardIndex) => {
      miniBoard.className = "mini-board";

      const boardWinner = miniBoardWinners[boardIndex];

      if (!gameOver) {
        if (nextBoardIndex === null) {
          if (boardWinner === "") {
            miniBoard.classList.add("active");
          }
        } else if (nextBoardIndex === boardIndex && boardWinner === "") {
          miniBoard.classList.add("active");
        }
      }

      if (boardWinner === "X") miniBoard.classList.add("won-x");
      if (boardWinner === "O") miniBoard.classList.add("won-o");
      if (boardWinner === "draw") miniBoard.classList.add("drawn");

      const cells = miniBoard.querySelectorAll(".cell");

      cells.forEach((cell, cellIndex) => {
        const value = getCellValue(cellStates, boardIndex, cellIndex);
        cell.textContent = value;
        cell.classList.remove("x", "o");

        if (value === "X") cell.classList.add("x");
        if (value === "O") cell.classList.add("o");

        cell.disabled = !isMoveAllowed(boardIndex, cellIndex);
      });

      const existingOverlay = miniBoard.querySelector(".board-overlay");
      if (existingOverlay) existingOverlay.remove();

      if (boardWinner === "X" || boardWinner === "O") {
        const overlay = document.createElement("div");
        overlay.className = `board-overlay ${boardWinner.toLowerCase()}`;
        overlay.textContent = boardWinner;
        miniBoard.appendChild(overlay);
      } else if (boardWinner === "draw") {
        const overlay = document.createElement("div");
        overlay.className = "board-overlay draw";
        overlay.textContent = "Draw";
        miniBoard.appendChild(overlay);
      }
    });

    currentPlayerEl.textContent = currentPlayer;
    targetBoardEl.textContent = nextBoardIndex === null ? "Beliebig" : boardName(nextBoardIndex);
    renderGlobalEffects();
  }

  function updateOpponentStatus(game) {
    const hostOnline = isPresenceOnline(game.hostConnected, game.hostLastSeen);
    const guestExists = !!game.guest;
    const guestOnline = guestExists
      ? isPresenceOnline(game.guestConnected, game.guestLastSeen)
      : false;

    if (playerSymbol === "X") {
      if (!guestExists) {
        opponentOnline = false;
        opponentStatusTextEl.textContent = "Noch nicht beigetreten";
        return;
      }

      if (guestOnline) {
        opponentOnline = true;
        opponentStatusTextEl.textContent = "Online";
      } else {
        opponentOnline = false;
        opponentStatusTextEl.textContent = "Offline / getrennt";
      }

      return;
    }

    if (hostOnline) {
      opponentOnline = true;
      opponentStatusTextEl.textContent = "Online";
    } else {
      opponentOnline = false;
      opponentStatusTextEl.textContent = "Offline / getrennt";
    }
  }

  function applySnapshot(game) {
    currentPlayer = game.currentPlayer ?? "X";
    nextBoardIndex = game.nextBoardIndex ?? null;
    cellStates = Array.isArray(game.cellStates) ? game.cellStates : createEmptyCellStates();
    miniBoardWinners = Array.isArray(game.miniBoardWinners) ? game.miniBoardWinners : createEmptyMiniWinners();
    currentGameStatus = game.status ?? "waiting";
    globalWinner = game.winner ?? "";
    roomJoinToken = game.joinToken ?? null;

    const normalizedGlobalBoard = miniBoardWinners.map((value) => (value === "draw" ? "" : value));
    globalWinningLine = findWinningLine(normalizedGlobalBoard);

    updateOpponentStatus(game);

    if (game.winner === "X" || game.winner === "O") {
      gameOver = true;
      statusTextEl.textContent = `Spieler ${game.winner} gewinnt das Spiel!`;
    } else if (game.winner === "draw") {
      gameOver = true;
      statusTextEl.textContent = "Unentschieden!";
    } else {
      gameOver = false;

      if (currentGameStatus === "waiting") {
        statusTextEl.textContent = "Warte auf zweiten Spieler...";
      } else if (!opponentOnline) {
        statusTextEl.textContent = "Der andere Spieler ist aktuell nicht verbunden.";
      } else if (currentGameStatus === "playing") {
        statusTextEl.textContent =
          currentPlayer === playerSymbol
            ? "Du bist am Zug."
            : `Spieler ${currentPlayer} ist am Zug.`;
      } else {
        statusTextEl.textContent = "Spiel läuft";
      }
    }

    render();
  }

  async function updateOwnPresence(isConnected) {
    if (!isRealtimeGame || !roomRef) return;

    const rolePrefix = getRolePrefix();
    const payload = {
      [`${rolePrefix}Connected`]: isConnected,
      [`${rolePrefix}LastSeen`]: nowMs(),
      updatedAt: nowMs()
    };

    try {
      await updateDoc(roomRef, payload);
    } catch (error) {
      console.error("Fehler beim Presence-Update:", error);
    }
  }

  function startHeartbeat() {
    if (!isRealtimeGame) return;

    heartbeatInterval = window.setInterval(() => {
      updateOwnPresence(true);
    }, HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat() {
    if (heartbeatInterval) {
      window.clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }

  async function maybeDeleteRoomIfEmpty() {
    if (!roomRef) return;

    try {
      const snapshot = await getDoc(roomRef);

      if (!snapshot.exists()) return;

      const game = snapshot.data();

      if (bothPlayersOffline(game)) {
        await deleteDoc(roomRef);
      }
    } catch (error) {
      console.error("Fehler beim Prüfen/Löschen eines leeren Rooms:", error);
    }
  }

  async function leaveRoomAndExit() {
    if (!isRealtimeGame || !roomRef || isLeavingRoom) {
      window.location.href = "play.html";
      return;
    }

    isLeavingRoom = true;
    stopHeartbeat();

    try {
      await updateOwnPresence(false);
      await maybeDeleteRoomIfEmpty();
    } catch (error) {
      console.error("Fehler beim Verlassen des Rooms:", error);
    }

    window.location.href = "play.html";
  }

  async function handleBestEffortLeave() {
    if (!isRealtimeGame || !roomRef || isLeavingRoom) return;

    stopHeartbeat();

    try {
      await updateOwnPresence(false);
      await maybeDeleteRoomIfEmpty();
    } catch (error) {
      console.error("Best-effort leave fehlgeschlagen:", error);
    }
  }

  async function resetGame() {
    if (isRealtimeGame && roomRef) {
      try {
        await updateDoc(roomRef, {
          status: "playing",
          currentPlayer: "X",
          nextBoardIndex: null,
          cellStates: createEmptyCellStates(),
          miniBoardWinners: createEmptyMiniWinners(),
          winner: "",
          updatedAt: nowMs()
        });
      } catch (error) {
        console.error(error);
        statusTextEl.textContent = "Fehler beim Zurücksetzen.";
      }
      return;
    }

    currentPlayer = "X";
    nextBoardIndex = null;
    gameOver = false;
    cellStates = createEmptyCellStates();
    miniBoardWinners = createEmptyMiniWinners();
    globalWinner = "";
    globalWinningLine = null;
    statusTextEl.textContent = "Spiel läuft";
    render();
  }

  async function ensureTokenOwnership() {
    if (!roomRef || !roomCode) return false;

    try {
      const snapshot = await getDoc(roomRef);

      if (!snapshot.exists()) {
        statusTextEl.textContent = "Room wurde nicht gefunden.";
        return false;
      }

      const game = snapshot.data();

      roomJoinToken = game.joinToken ?? null;

      if (!authToken) {
        statusTextEl.textContent = "Kein gültiger Room-Zugang gefunden.";
        return false;
      }

      if (authToken === game.hostToken) {
        if (mode === "random-host") {
          playerSymbol = "X";
        } else {
          mode = mode === "random-host" ? "random-host" : "private-host";
          playerSymbol = "X";
        }

        await updateDoc(roomRef, {
          hostConnected: true,
          hostLastSeen: nowMs(),
          updatedAt: nowMs()
        });

        return true;
      }

      if (authToken === game.joinToken) {
        if (mode === "random-guest") {
          playerSymbol = "O";
        } else {
          mode = mode === "random-guest" ? "random-guest" : "private-guest";
          playerSymbol = "O";
        }

        const payload = {
          guestConnected: true,
          guestLastSeen: nowMs(),
          updatedAt: nowMs()
        };

        if (!game.guest) {
          payload.guest = {
            name: "Player 2",
            symbol: "O"
          };
        }

        if (game.status === "waiting") {
          payload.status = "playing";
        }

        await updateDoc(roomRef, payload);
        return true;
      }

      statusTextEl.textContent = "Ungültiger Zugangslink für diesen Room.";
      return false;
    } catch (error) {
      console.error("Fehler bei Token-Ownership:", error);
      statusTextEl.textContent = "Reconnect fehlgeschlagen.";
      return false;
    }
  }

  function setupRealtimeRoom() {
    if (!roomRef || !roomCode) return;

    ensureTokenOwnership().then((allowed) => {
      if (!allowed) return;

      setModeDisplay();
      updateOwnPresence(true);
      startHeartbeat();
    });

    onSnapshot(roomRef, async (snapshot) => {
      if (!snapshot.exists()) {
        statusTextEl.textContent = "Room wurde gelöscht oder nicht gefunden.";
        opponentStatusTextEl.textContent = "-";
        return;
      }

      const game = snapshot.data();

      if (roomShouldBeDeleted(game)) {
        try {
          await deleteDoc(roomRef);
          statusTextEl.textContent = "Room war inaktiv und wurde gelöscht.";
        } catch (error) {
          console.error("Fehler beim Löschen eines inaktiven Rooms:", error);
        }
        return;
      }

      applySnapshot(game);
    });

    window.addEventListener("pagehide", handleBestEffortLeave);
    window.addEventListener("beforeunload", handleBestEffortLeave);
  }

  if (copyRoomCodeBtn) {
    copyRoomCodeBtn.addEventListener("click", async () => {
      if (!roomCode) {
        statusTextEl.textContent = "Kein Room-Code vorhanden.";
        return;
      }

      try {
        await navigator.clipboard.writeText(roomCode);
        statusTextEl.textContent = "Room-Code kopiert.";
      } catch (error) {
        console.error(error);
        statusTextEl.textContent = "Kopieren des Room-Codes fehlgeschlagen.";
      }
    });
  }

  if (copyJoinLinkBtn) {
    copyJoinLinkBtn.addEventListener("click", async () => {
      if (!roomCode || !roomJoinToken) {
        statusTextEl.textContent = "Join-Link noch nicht verfügbar.";
        return;
      }

      try {
        await navigator.clipboard.writeText(buildJoinLink(roomCode, roomJoinToken));
        statusTextEl.textContent = "Join-Link kopiert.";
      } catch (error) {
        console.error(error);
        statusTextEl.textContent = "Kopieren des Join-Links fehlgeschlagen.";
      }
    });
  }

  resetBtn.addEventListener("click", resetGame);

  if (leaveRoomBtn) {
    leaveRoomBtn.addEventListener("click", leaveRoomAndExit);
  }

  setModeDisplay();
  createBoard();

  if (isRealtimeGame) {
    setupRealtimeRoom();
  } else if (isBotMode) {
    maybeTriggerBotMove();
  }
}