import { db } from "./firebase.js";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ultimateBoard = document.getElementById("ultimateBoard");
const currentPlayerEl = document.getElementById("currentPlayer");
const targetBoardEl = document.getElementById("targetBoard");
const statusTextEl = document.getElementById("statusText");
const resetBtn = document.getElementById("resetBtn");
const modeTextEl = document.getElementById("modeText");

const generatedCodeEl = document.getElementById("generatedCode");
const generateCodeBtn = document.getElementById("generateCodeBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const roomInput = document.getElementById("roomInput");
const joinHint = document.getElementById("joinHint");

function generateRoomCode() {
  const randomPart = Math.floor(1000 + Math.random() * 9000);
  return `UTTT-${randomPart}`;
}

if (generatedCodeEl && generateCodeBtn) {
  generateCodeBtn.addEventListener("click", async () => {
    const roomCode = generateRoomCode();
    generatedCodeEl.textContent = roomCode;

    try {
      await createRoom(roomCode);
      if (joinHint) {
        joinHint.textContent = `Room ${roomCode} wurde erstellt.`;
      }
    } catch (error) {
      console.error(error);
      if (joinHint) {
        joinHint.textContent = "Fehler beim Erstellen des Rooms.";
      }
    }
  });
}

async function createRoom(roomCode) {
  await setDoc(doc(db, "games", roomCode), {
    roomCode,
    status: "waiting",
    host: {
      name: "Player 1",
      symbol: "X"
    },
    guest: null,
    currentPlayer: "X",
    nextBoardIndex: null,
    cellStates: Array.from({ length: 9 }, () => Array(9).fill("")),
    miniBoardWinners: Array(9).fill(""),
    winner: "",
    createdAt: Date.now()
  });
}

if (joinRoomBtn && roomInput && joinHint) {
  joinRoomBtn.addEventListener("click", async () => {
    const roomCode = roomInput.value.trim().toUpperCase();

    if (!roomCode) {
      joinHint.textContent = "Bitte gib zuerst einen Room-Code ein.";
      return;
    }

    try {
      const gameRef = doc(db, "games", roomCode);
      const snap = await getDoc(gameRef);

      if (!snap.exists()) {
        joinHint.textContent = "Room nicht gefunden.";
        return;
      }

      const game = snap.data();

      if (game.guest) {
        joinHint.textContent = "Room ist bereits voll.";
        return;
      }

      await updateDoc(gameRef, {
        guest: {
          name: "Player 2",
          symbol: "O"
        },
        status: "playing"
      });

      joinHint.textContent = `Room ${roomCode} erfolgreich gejoint.`;
      window.location.href = `game.html?room=${roomCode}&mode=private-guest`;
    } catch (error) {
      console.error(error);
      joinHint.textContent = "Fehler beim Joinen des Rooms.";
    }
  });
}

if (ultimateBoard && currentPlayerEl && targetBoardEl && statusTextEl && resetBtn) {
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

  let currentPlayer = "X";
  let nextBoardIndex = null;
  let gameOver = false;

  let cellStates = Array.from({ length: 9 }, () => Array(9).fill(""));
  let miniBoardWinners = Array(9).fill("");

  if (modeTextEl) {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode");

    if (mode === "private-host") {
      modeTextEl.textContent = "Private Host";
    } else if (mode === "private-guest") {
      modeTextEl.textContent = "Private Guest";
    } else if (mode === "local") {
      modeTextEl.textContent = "Local";
    } else {
      modeTextEl.textContent = "Standard";
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

  function handleCellClick(event) {
    if (gameOver) return;

    const target = event.currentTarget;
    const boardIndex = Number(target.dataset.boardIndex);
    const cellIndex = Number(target.dataset.cellIndex);

    if (!isMoveAllowed(boardIndex, cellIndex)) return;

    cellStates[boardIndex][cellIndex] = currentPlayer;

    const miniWinner = getWinner(cellStates[boardIndex]);

    if (miniWinner) {
      miniBoardWinners[boardIndex] = miniWinner;
    } else if (isBoardFull(cellStates[boardIndex])) {
      miniBoardWinners[boardIndex] = "draw";
    }

    const normalizedGlobalBoard = miniBoardWinners.map((value) => {
      return value === "draw" ? "" : value;
    });

    const globalWinner = getWinner(normalizedGlobalBoard);

    if (globalWinner) {
      gameOver = true;
      statusTextEl.textContent = `Spieler ${globalWinner} gewinnt das Spiel!`;
    } else if (miniBoardWinners.every((value) => value !== "")) {
      gameOver = true;
      statusTextEl.textContent = "Unentschieden!";
    } else {
      nextBoardIndex = cellIndex;

      if (miniBoardWinners[nextBoardIndex] !== "") {
        nextBoardIndex = null;
      }

      currentPlayer = currentPlayer === "X" ? "O" : "X";
      statusTextEl.textContent = "Spiel läuft";
    }

    render();
  }

  function isMoveAllowed(boardIndex, cellIndex) {
    if (cellStates[boardIndex][cellIndex] !== "") return false;
    if (miniBoardWinners[boardIndex] !== "") return false;

    if (nextBoardIndex === null) return true;
    return boardIndex === nextBoardIndex;
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
        const value = cellStates[boardIndex][cellIndex];
        cell.textContent = value;
        cell.classList.remove("x", "o");

        if (value === "X") cell.classList.add("x");
        if (value === "O") cell.classList.add("o");

        cell.disabled = gameOver || !isMoveAllowed(boardIndex, cellIndex);
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

  function boardName(index) {
    const row = Math.floor(index / 3) + 1;
    const col = (index % 3) + 1;
    return `Reihe ${row}, Spalte ${col}`;
  }

  function resetGame() {
    currentPlayer = "X";
    nextBoardIndex = null;
    gameOver = false;
    cellStates = Array.from({ length: 9 }, () => Array(9).fill(""));
    miniBoardWinners = Array(9).fill("");
    statusTextEl.textContent = "Spiel läuft";
    render();
  }

  resetBtn.addEventListener("click", resetGame);

  createBoard();
}
