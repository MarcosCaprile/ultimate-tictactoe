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

const ultimateBoard = document.getElementById("ultimateBoard");
const currentPlayerEl = document.getElementById("currentPlayer");
const targetBoardEl = document.getElementById("targetBoard");
const statusTextEl = document.getElementById("statusText");
const resetBtn = document.getElementById("resetBtn");
const leaveRoomBtn = document.getElementById("leaveRoomBtn");
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

async function createRoom(roomCode) {
  const roomRef = doc(db, "games", roomCode);
  const existingSnapshot = await getDoc(roomRef);

  if (existingSnapshot.exists()) {
    throw new Error("Dieser Room-Code ist bereits belegt.");
  }

  const timestamp = nowMs();

  await setDoc(roomRef, {
    roomCode,
    status: "waiting",
    host: {
      name: "Player 1",
      symbol: "X"
    },
    guest: null,

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

      await createRoom(roomCode);

      createHint.textContent = `Room ${roomCode} erstellt. Weiterleitung als Host...`;
      window.location.href = `game.html?room=${roomCode}&mode=private-host`;
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

      window.location.href = `game.html?room=${roomCode}&mode=private-guest`;
    } catch (error) {
      console.error("Fehler beim Joinen des Rooms:", error);
      joinHint.textContent = `Fehler beim Joinen des Rooms: ${error.message}`;
      joinRoomBtn.disabled = false;
      isJoiningRoom = false;
    }
  });
}

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

  let roomCode = readRoomCode();
  let mode = readGameMode();
  let playerSymbol = "X";
  let isRealtimeGame = Boolean(roomCode);
  let currentGameStatus = "waiting";
  let opponentOnline = false;
  let roomRef = roomCode ? doc(db, "games", roomCode) : null;
  let heartbeatInterval = null;
  let isLeavingRoom = false;

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
    } else if (mode === "local") {
      modeTextEl.textContent = "Local";
      playerSymbol = "X";
    } else {
      modeTextEl.textContent = isRealtimeGame ? "Private Match" : "Standard";
      playerSymbol = "X";
    }

    playerRoleTextEl.textContent = playerSymbol;
    roomCodeTextEl.textContent = roomCode ? roomCode : "-";
    opponentStatusTextEl.textContent = isRealtimeGame ? "Wird geprüft..." : "Nicht relevant";

    if (gameSubtitleEl) {
      gameSubtitleEl.textContent = roomCode
        ? `Verbunden mit Room ${roomCode}. Der Room erkennt jetzt auch, ob Spieler offline gehen.`
        : "Lokales Spiel ohne Realtime-Room.";
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

  function isMoveAllowed(boardIndex, cellIndex) {
    if (getCellValue(cellStates, boardIndex, cellIndex) !== "") return false;
    if (miniBoardWinners[boardIndex] !== "") return false;
    if (gameOver) return false;

    if (isRealtimeGame) {
      if (currentGameStatus !== "playing") return false;
      if (currentPlayer !== playerSymbol) return false;
      if (!opponentOnline) return false;
    }

    if (nextBoardIndex === null) return true;
    return boardIndex === nextBoardIndex;
  }

  function buildNextState(boardIndex, cellIndex) {
    const newCellStates = [...cellStates];
    const newMiniBoardWinners = [...miniBoardWinners];

    setCellValue(newCellStates, boardIndex, cellIndex, currentPlayer);

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

    const globalWinner = getWinner(normalizedGlobalBoard);

    let newGameOver = false;
    let newStatusText = "Spiel läuft";
    let newStatus = "playing";
    let newWinner = "";
    let newNextBoardIndex = cellIndex;
    let newCurrentPlayer = currentPlayer === "X" ? "O" : "X";

    if (globalWinner) {
      newGameOver = true;
      newWinner = globalWinner;
      newStatus = "finished";
      newStatusText = `Spieler ${globalWinner} gewinnt das Spiel!`;
      newNextBoardIndex = null;
      newCurrentPlayer = currentPlayer;
    } else if (newMiniBoardWinners.every((value) => value !== "")) {
      newGameOver = true;
      newWinner = "draw";
      newStatus = "finished";
      newStatusText = "Unentschieden!";
      newNextBoardIndex = null;
      newCurrentPlayer = currentPlayer;
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
      gameOver: newGameOver
    };
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

    render();
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
      window.location.href = "lobby.html";
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

    window.location.href = "lobby.html";
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
    statusTextEl.textContent = "Spiel läuft";
    render();
  }

  function setupRealtimeRoom() {
    if (!roomRef) return;

    updateOwnPresence(true);
    startHeartbeat();

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

  resetBtn.addEventListener("click", resetGame);

  if (leaveRoomBtn) {
    leaveRoomBtn.addEventListener("click", leaveRoomAndExit);
  }

  setModeDisplay();
  createBoard();

  if (isRealtimeGame) {
    setupRealtimeRoom();
  }
}