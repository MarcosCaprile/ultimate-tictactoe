import { db } from "./firebase.js";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot
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
const modeTextEl = document.getElementById("modeText");
const roomCodeTextEl = document.getElementById("roomCodeText");
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

function createEmptyCellStates() {
  return Array.from({ length: 9 }, () => Array(9).fill(""));
}

function createEmptyMiniWinners() {
  return Array(9).fill("");
}

function generateRoomCode() {
  const randomPart = Math.floor(1000 + Math.random() * 9000);
  return `UTTT-${randomPart}`;
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
    cellStates: createEmptyCellStates(),
    miniBoardWinners: createEmptyMiniWinners(),
    winner: "",
    createdAt: Date.now()
  });
}

if (generateCodeBtn && generatedCodeEl && createHint) {
  generateCodeBtn.addEventListener("click", async () => {
    const roomCode = generateRoomCode();
    generatedCodeEl.textContent = roomCode;
    createHint.textContent = "Room wird erstellt...";

    try {
      await createRoom(roomCode);
      createHint.textContent = `Room ${roomCode} erstellt. Weiterleitung als Host...`;
      window.location.href = `game.html?room=${roomCode}&mode=private-host`;
    } catch (error) {
      console.error("Fehler beim Erstellen des Rooms:", error);
      createHint.textContent = `Fehler beim Erstellen des Rooms: ${error.message}`;
    }
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

      window.location.href = `game.html?room=${roomCode}&mode=private-guest`;
    } catch (error) {
      console.error("Fehler beim Joinen des Rooms:", error);
      joinHint.textContent = `Fehler beim Joinen des Rooms: ${error.message}`;
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
  playerRoleTextEl
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

    if (gameSubtitleEl) {
      gameSubtitleEl.textContent = roomCode
        ? `Verbunden mit Room ${roomCode}. Änderungen werden live synchronisiert.`
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
    if (cellStates[boardIndex][cellIndex] !== "") return false;
    if (miniBoardWinners[boardIndex] !== "") return false;
    if (gameOver) return false;

    if (isRealtimeGame) {
      if (currentGameStatus !== "playing") return false;
      if (currentPlayer !== playerSymbol) return false;
    }

    if (nextBoardIndex === null) return true;
    return boardIndex === nextBoardIndex;
  }

  function buildNextState(boardIndex, cellIndex) {
    const newCellStates = cellStates.map((board) => [...board]);
    const newMiniBoardWinners = [...miniBoardWinners];

    newCellStates[boardIndex][cellIndex] = currentPlayer;

    const miniWinner = getWinner(newCellStates[boardIndex]);

    if (miniWinner) {
      newMiniBoardWinners[boardIndex] = miniWinner;
    } else if (isBoardFull(newCellStates[boardIndex])) {
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

    if (isRealtimeGame && roomCode) {
      try {
        const gameRef = doc(db, "games", roomCode);
        await updateDoc(gameRef, {
          cellStates: nextState.cellStates,
          miniBoardWinners: nextState.miniBoardWinners,
          currentPlayer: nextState.currentPlayer,
          nextBoardIndex: nextState.nextBoardIndex,
          winner: nextState.winner,
          status: nextState.status
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
        const value = cellStates[boardIndex][cellIndex];
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

  function applySnapshot(game) {
    currentPlayer = game.currentPlayer ?? "X";
    nextBoardIndex = game.nextBoardIndex ?? null;
    cellStates = game.cellStates ?? createEmptyCellStates();
    miniBoardWinners = game.miniBoardWinners ?? createEmptyMiniWinners();
    currentGameStatus = game.status ?? "waiting";

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

  async function resetGame() {
    if (isRealtimeGame && roomCode) {
      try {
        const gameRef = doc(db, "games", roomCode);
        await updateDoc(gameRef, {
          status: "playing",
          currentPlayer: "X",
          nextBoardIndex: null,
          cellStates: createEmptyCellStates(),
          miniBoardWinners: createEmptyMiniWinners(),
          winner: ""
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
    if (!roomCode) return;

    const gameRef = doc(db, "games", roomCode);

    onSnapshot(gameRef, async (snapshot) => {
      if (!snapshot.exists()) {
        statusTextEl.textContent = "Room wurde nicht gefunden.";
        return;
      }

      const game = snapshot.data();

      if (mode === "private-host" && game.status === "waiting" && !game.guest) {
        statusTextEl.textContent = "Warte auf zweiten Spieler...";
      }

      if (mode === "private-host" && game.status === "waiting" && game.guest) {
        try {
          await updateDoc(gameRef, {
            status: "playing"
          });
        } catch (error) {
          console.error(error);
        }
      }

      applySnapshot(game);
    });
  }

  resetBtn.addEventListener("click", resetGame);

  setModeDisplay();
  createBoard();

  if (isRealtimeGame) {
    setupRealtimeRoom();
  }
}
