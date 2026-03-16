import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  onSnapshot,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ultimateBoard = document.getElementById("ultimateBoard");
const currentPlayerEl = document.getElementById("currentPlayer");
const targetBoardEl = document.getElementById("targetBoard");
const statusTextEl = document.getElementById("statusText");
const resetBtn = document.getElementById("resetBtn");
const leaveGameBtn = document.getElementById("leaveGameBtn");
const modeTextEl = document.getElementById("modeText");
const gameIdTextEl = document.getElementById("gameIdText");
const playerRoleTextEl = document.getElementById("playerRoleText");
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

let currentUser = null;
let currentPlayer = "X";
let nextBoardIndex = null;
let gameOver = false;
let cellStates = Array(81).fill("");
let miniBoardWinners = Array(9).fill("");
let playerSymbol = "X";
let isOnlineGame = false;
let currentGameId = null;
let currentGameData = null;

function nowMs() {
  return Date.now();
}

function readGameId() {
  return new URLSearchParams(window.location.search).get("gameId");
}

function readMode() {
  return new URLSearchParams(window.location.search).get("mode") || "local";
}

function getFlatIndex(boardIndex, cellIndex) {
  return boardIndex * 9 + cellIndex;
}

function getCellValue(state, boardIndex, cellIndex) {
  return state[getFlatIndex(boardIndex, cellIndex)];
}

function setCellValue(state, boardIndex, cellIndex, value) {
  state[getFlatIndex(boardIndex, cellIndex)] = value;
}

function getMiniBoard(state, boardIndex) {
  const start = boardIndex * 9;
  return state.slice(start, start + 9);
}

function getWinner(board) {
  for (const [a, b, c] of WINNING_COMBINATIONS) {
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

  const normalizedGlobalBoard = newMiniBoardWinners.map((value) => value === "draw" ? "" : value);
  const globalWinner = getWinner(normalizedGlobalBoard);

  let newGameOver = false;
  let newStatus = "playing";
  let newWinner = "";
  let newCurrentPlayer = player === "X" ? "O" : "X";
  let newNextBoardIndex = cellIndex;

  if (globalWinner) {
    newGameOver = true;
    newWinner = globalWinner;
    newStatus = "finished";
    newCurrentPlayer = player;
    newNextBoardIndex = null;
  } else if (newMiniBoardWinners.every((value) => value !== "")) {
    newGameOver = true;
    newWinner = "draw";
    newStatus = "finished";
    newCurrentPlayer = player;
    newNextBoardIndex = null;
  } else if (newMiniBoardWinners[newNextBoardIndex] !== "") {
    newNextBoardIndex = null;
  }

  return {
    cellStates: newCellStates,
    miniBoardWinners: newMiniBoardWinners,
    currentPlayer: newCurrentPlayer,
    nextBoardIndex: newNextBoardIndex,
    winner: newWinner,
    status: newStatus,
    gameOver: newGameOver
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

function isMoveAllowed(boardIndex, cellIndex) {
  if (gameOver) return false;
  if (getCellValue(cellStates, boardIndex, cellIndex) !== "") return false;
  if (miniBoardWinners[boardIndex] !== "") return false;

  if (nextBoardIndex !== null && nextBoardIndex !== boardIndex) return false;

  if (isOnlineGame) {
    if (!currentGameData) return false;
    if (currentGameData.status !== "playing") return false;
    if (currentPlayer !== playerSymbol) return false;
  }

  return true;
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
      cell.type = "button";
      cell.dataset.boardIndex = String(boardIndex);
      cell.dataset.cellIndex = String(cellIndex);
      cell.addEventListener("click", handleCellClick);
      miniBoard.appendChild(cell);
    }

    ultimateBoard.appendChild(miniBoard);
  }
}

async function handleCellClick(event) {
  const target = event.currentTarget;
  const boardIndex = Number(target.dataset.boardIndex);
  const cellIndex = Number(target.dataset.cellIndex);

  if (!isMoveAllowed(boardIndex, cellIndex)) return;

  const nextState = buildNextState(boardIndex, cellIndex);

  if (isOnlineGame && currentGameId) {
    const gameRef = doc(db, "games", currentGameId);
    try {
      await updateDoc(gameRef, {
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
      statusTextEl.textContent = "Fehler beim Synchronisieren.";
    }
    return;
  }

  cellStates = nextState.cellStates;
  miniBoardWinners = nextState.miniBoardWinners;
  currentPlayer = nextState.currentPlayer;
  nextBoardIndex = nextState.nextBoardIndex;
  gameOver = nextState.gameOver;

  if (nextState.winner === "X" || nextState.winner === "O") {
    statusTextEl.textContent = `Spieler ${nextState.winner} gewinnt das Spiel!`;
  } else if (nextState.winner === "draw") {
    statusTextEl.textContent = "Unentschieden!";
  } else {
    statusTextEl.textContent = `Spieler ${currentPlayer} ist am Zug.`;
  }

  render();
}

function render() {
  const miniBoards = ultimateBoard.querySelectorAll(".mini-board");

  miniBoards.forEach((miniBoardEl, boardIndex) => {
    const miniWinner = miniBoardWinners[boardIndex];
    miniBoardEl.classList.remove("active-board", "won-x", "won-o", "draw-board");

    if (miniWinner === "X") miniBoardEl.classList.add("won-x");
    if (miniWinner === "O") miniBoardEl.classList.add("won-o");
    if (miniWinner === "draw") miniBoardEl.classList.add("draw-board");

    const isActiveBoard =
      !gameOver &&
      miniWinner === "" &&
      (nextBoardIndex === null || nextBoardIndex === boardIndex);

    if (isActiveBoard) {
      miniBoardEl.classList.add("active-board");
    }

    const cells = miniBoardEl.querySelectorAll(".cell");

    cells.forEach((cellEl, cellIndex) => {
      const value = getCellValue(cellStates, boardIndex, cellIndex);
      cellEl.textContent = value;
      cellEl.classList.remove("x", "o", "playable-cell");

      if (value === "X") cellEl.classList.add("x");
      if (value === "O") cellEl.classList.add("o");

      if (isMoveAllowed(boardIndex, cellIndex)) {
        cellEl.classList.add("playable-cell");
      }
    });
  });

  currentPlayerEl.textContent = currentPlayer;
  targetBoardEl.textContent = nextBoardIndex === null ? "Beliebig" : boardName(nextBoardIndex);
}

function applyGameSnapshot(game) {
  currentGameData = game;
  currentPlayer = game.currentPlayer ?? "X";
  nextBoardIndex = game.nextBoardIndex ?? null;
  cellStates = Array.isArray(game.cellStates) ? game.cellStates : Array(81).fill("");
  miniBoardWinners = Array.isArray(game.miniBoardWinners) ? game.miniBoardWinners : Array(9).fill("");

  if (game.winner === "X" || game.winner === "O") {
    gameOver = true;
    statusTextEl.textContent = `Spieler ${game.winner} gewinnt das Spiel!`;
  } else if (game.winner === "draw") {
    gameOver = true;
    statusTextEl.textContent = "Unentschieden!";
  } else {
    gameOver = false;
    statusTextEl.textContent =
      currentPlayer === playerSymbol
        ? "Du bist am Zug."
        : `Spieler ${currentPlayer} ist am Zug.`;
  }

  render();
}

async function leaveGame() {
  if (!isOnlineGame || !currentGameId || !currentUser) {
    window.location.href = "play.html";
    return;
  }

  try {
    const ownRef = doc(db, "users", currentUser.uid);
    await updateDoc(ownRef, {
      status: "online",
      currentGameId: null,
      updatedAt: nowMs(),
      lastSeen: nowMs()
    });
  } catch (error) {
    console.error(error);
  }

  window.location.href = "online.html";
}

if (leaveGameBtn) {
  leaveGameBtn.addEventListener("click", leaveGame);
}

if (resetBtn) {
  resetBtn.addEventListener("click", () => {
    if (isOnlineGame) {
      statusTextEl.textContent = "Online-Spiel kann nicht lokal zurückgesetzt werden.";
      return;
    }

    currentPlayer = "X";
    nextBoardIndex = null;
    gameOver = false;
    cellStates = Array(81).fill("");
    miniBoardWinners = Array(9).fill("");
    statusTextEl.textContent = "Spiel läuft";
    render();
  });
}

function initLocalGame() {
  isOnlineGame = false;
  modeTextEl.textContent = "Local";
  playerRoleTextEl.textContent = "X / O lokal";
  gameIdTextEl.textContent = "-";
  gameSubtitleEl.textContent = "Lokales Spiel auf einem Gerät.";
  createBoard();
  render();
}

async function initOnlineGame(user) {
  currentGameId = readGameId();

  if (!currentGameId) {
    statusTextEl.textContent = "Keine gameId gefunden.";
    return;
  }

  const gameRef = doc(db, "games", currentGameId);
  const snap = await getDoc(gameRef);

  if (!snap.exists()) {
    statusTextEl.textContent = "Spiel nicht gefunden.";
    return;
  }

  const game = snap.data();
  isOnlineGame = true;

  if (game.hostUid === user.uid) {
    playerSymbol = "X";
  } else if (game.guestUid === user.uid) {
    playerSymbol = "O";
  } else {
    statusTextEl.textContent = "Du gehörst nicht zu diesem Spiel.";
    return;
  }

  modeTextEl.textContent = "Online";
  playerRoleTextEl.textContent = playerSymbol;
  gameIdTextEl.textContent = currentGameId;
  gameSubtitleEl.textContent = `${game.hostUsername} vs. ${game.guestUsername}`;

  createBoard();

  onSnapshot(gameRef, (snapshot) => {
    if (!snapshot.exists()) {
      statusTextEl.textContent = "Dieses Spiel wurde entfernt.";
      return;
    }

    applyGameSnapshot(snapshot.data());
  });
}

onAuthStateChanged(auth, async (user) => {
  const gameId = readGameId();
  const mode = readMode();

  if (gameId) {
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    currentUser = user;
    await initOnlineGame(user);
    return;
  }

  if (mode === "local" || !gameId) {
    initLocalGame();
  }
});