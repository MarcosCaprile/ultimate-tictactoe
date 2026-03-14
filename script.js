const ultimateBoard = document.getElementById("ultimateBoard");
const currentPlayerEl = document.getElementById("currentPlayer");
const targetBoardEl = document.getElementById("targetBoard");
const statusTextEl = document.getElementById("statusText");
const resetBtn = document.getElementById("resetBtn");

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
let nextBoardIndex = null; // null = beliebig
let gameOver = false;

let cellStates = Array.from({ length: 9 }, () => Array(9).fill(""));
let miniBoardWinners = Array(9).fill(""); // "", "X", "O", "draw"

function createBoard() {
  ultimateBoard.innerHTML = "";

  for (let boardIndex = 0; boardIndex < 9; boardIndex++) {
    const miniBoard = document.createElement("div");
    miniBoard.className = "mini-board";
    miniBoard.dataset.boardIndex = boardIndex;

    for (let cellIndex = 0; cellIndex < 9; cellIndex++) {
      const cell = document.createElement("button");
      cell.className = "cell";
      cell.dataset.boardIndex = boardIndex;
      cell.dataset.cellIndex = cellIndex;
      cell.addEventListener("click", handleCellClick);
      miniBoard.appendChild(cell);
    }

    ultimateBoard.appendChild(miniBoard);
  }

  render();
}

function handleCellClick(event) {
  if (gameOver) return;

  const boardIndex = Number(event.target.dataset.boardIndex);
  const cellIndex = Number(event.target.dataset.cellIndex);

  if (!isMoveAllowed(boardIndex, cellIndex)) return;

  cellStates[boardIndex][cellIndex] = currentPlayer;

  const miniWinner = getWinner(cellStates[boardIndex]);

  if (miniWinner) {
    miniBoardWinners[boardIndex] = miniWinner;
  } else if (isBoardFull(cellStates[boardIndex])) {
    miniBoardWinners[boardIndex] = "draw";
  }

  const globalWinner = getWinner(miniBoardWinners.map(value => (value === "draw" ? "" : value)));

  if (globalWinner) {
    gameOver = true;
    statusTextEl.textContent = `Spieler ${globalWinner} gewinnt das Spiel!`;
  } else if (miniBoardWinners.every(value => value !== "")) {
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
  return board.every(cell => cell !== "");
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

    const oldOverlay = miniBoard.querySelector(".board-overlay");
    if (oldOverlay) oldOverlay.remove();

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
