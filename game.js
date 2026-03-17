import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  onSnapshot,
  updateDoc,
  runTransaction
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

const ELO_K = 32;

let currentUser = null;
let currentPlayer = "X";
let nextBoardIndex = null;
let gameOver = false;
let cellStates = Array(81).fill("");
let miniBoardWinners = Array(9).fill("");
let playerSymbol = "X";
let isOnlineGame = false;
let isBotGame = false;
let botDifficulty = null;
let currentGameId = null;
let currentGameData = null;
let botThinking = false;
let resultOverlay = null;
let ratingApplyInProgress = false;

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

function updateGameActionButtons() {
  if (!resetBtn || !leaveGameBtn) return;

  if (isOnlineGame) {
    resetBtn.style.display = "none";
    leaveGameBtn.style.display = "inline-flex";
    return;
  }

  resetBtn.style.display = "inline-flex";
  leaveGameBtn.style.display = "none";

  if (isBotGame) {
    resetBtn.textContent = "Bot-Spiel neu starten";
  } else {
    resetBtn.textContent = "Lokales Spiel neu starten";
  }
}

function expectedScore(playerRating, opponentRating) {
  return 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
}

function calculateNewRatings(hostRating, guestRating, hostScore, guestScore) {
  const expectedHost = expectedScore(hostRating, guestRating);
  const expectedGuest = expectedScore(guestRating, hostRating);

  const newHostRating = Math.round(hostRating + ELO_K * (hostScore - expectedHost));
  const newGuestRating = Math.round(guestRating + ELO_K * (guestScore - expectedGuest));

  return {
    newHostRating,
    newGuestRating
  };
}

function getOwnRatingDeltaText(game) {
  if (!isOnlineGame || !game) return "";

  if (game.ratingError) {
    return "Rating konnte nicht aktualisiert werden.";
  }

  if (!game.ratingApplied) {
    return "Rating wird berechnet...";
  }

  const delta = playerSymbol === "X" ? game.hostRatingDelta : game.guestRatingDelta;

  if (typeof delta !== "number") return "Rating aktualisiert.";

  if (delta > 0) return `Rating: +${delta}`;
  if (delta < 0) return `Rating: ${delta}`;
  return "Rating: ±0";
}

function getOnlineResultText(game) {
  if (!game) {
    return {
      type: "draw",
      title: "Spiel beendet",
      subtitle: "Ergebnis wird geladen..."
    };
  }

  if (game.winner === playerSymbol) {
    return {
      type: "win",
      title: "Du gewinnst!",
      subtitle: game.ratingApplied ? getOwnRatingDeltaText(game) : "Rating wird berechnet..."
    };
  }

  if (game.winner === "draw") {
    return {
      type: "draw",
      title: "Unentschieden",
      subtitle: game.ratingApplied ? getOwnRatingDeltaText(game) : "Rating wird berechnet..."
    };
  }

  return {
    type: "loss",
    title: "Du verlierst",
    subtitle: game.ratingApplied ? getOwnRatingDeltaText(game) : "Rating wird berechnet..."
  };
}

async function applyOnlineGameResultIfNeeded(game) {
  if (!isOnlineGame || !currentGameId) return;
  if (!game) return;
  if (game.status !== "finished") return;
  if (!(game.winner === "X" || game.winner === "O" || game.winner === "draw")) return;
  if (game.ratingApplied) return;
  if (ratingApplyInProgress) return;

  ratingApplyInProgress = true;

  const gameRef = doc(db, "games", currentGameId);
  const hostRef = doc(db, "users", game.hostUid);
  const guestRef = doc(db, "users", game.guestUid);

  try {
    await runTransaction(db, async (transaction) => {
      const freshGameSnap = await transaction.get(gameRef);
      const hostSnap = await transaction.get(hostRef);
      const guestSnap = await transaction.get(guestRef);

      if (!freshGameSnap.exists()) throw new Error("Spiel nicht gefunden.");
      if (!hostSnap.exists() || !guestSnap.exists()) throw new Error("Spielerprofil fehlt.");

      const freshGame = freshGameSnap.data();
      const host = hostSnap.data();
      const guest = guestSnap.data();

      if (freshGame.ratingApplied) {
        return;
      }

      const hostRating = host.rating ?? 1000;
      const guestRating = guest.rating ?? 1000;

      let hostScore = 0;
      let guestScore = 0;

      if (freshGame.winner === "X") {
        hostScore = 1;
        guestScore = 0;
      } else if (freshGame.winner === "O") {
        hostScore = 0;
        guestScore = 1;
      } else {
        hostScore = 0.5;
        guestScore = 0.5;
      }

      const { newHostRating, newGuestRating } = calculateNewRatings(
        hostRating,
        guestRating,
        hostScore,
        guestScore
      );

      const hostDelta = newHostRating - hostRating;
      const guestDelta = newGuestRating - guestRating;

      const hostPatch = {
        rating: newHostRating,
        currentGameId: null,
        status: "online",
        updatedAt: nowMs(),
        lastSeen: nowMs()
      };

      const guestPatch = {
        rating: newGuestRating,
        currentGameId: null,
        status: "online",
        updatedAt: nowMs(),
        lastSeen: nowMs()
      };

      if (freshGame.winner === "X") {
        hostPatch.wins = (host.wins ?? 0) + 1;
        hostPatch.losses = host.losses ?? 0;
        hostPatch.draws = host.draws ?? 0;

        guestPatch.wins = guest.wins ?? 0;
        guestPatch.losses = (guest.losses ?? 0) + 1;
        guestPatch.draws = guest.draws ?? 0;
      } else if (freshGame.winner === "O") {
        hostPatch.wins = host.wins ?? 0;
        hostPatch.losses = (host.losses ?? 0) + 1;
        hostPatch.draws = host.draws ?? 0;

        guestPatch.wins = (guest.wins ?? 0) + 1;
        guestPatch.losses = guest.losses ?? 0;
        guestPatch.draws = guest.draws ?? 0;
      } else {
        hostPatch.wins = host.wins ?? 0;
        hostPatch.losses = host.losses ?? 0;
        hostPatch.draws = (host.draws ?? 0) + 1;

        guestPatch.wins = guest.wins ?? 0;
        guestPatch.losses = guest.losses ?? 0;
        guestPatch.draws = (guest.draws ?? 0) + 1;
      }

      transaction.update(hostRef, hostPatch);
      transaction.update(guestRef, guestPatch);

      transaction.update(gameRef, {
        ratingApplied: true,
        ratingAppliedAt: nowMs(),
        hostRatingBefore: hostRating,
        guestRatingBefore: guestRating,
        hostRatingAfter: newHostRating,
        guestRatingAfter: newGuestRating,
        hostRatingDelta: hostDelta,
        guestRatingDelta: guestDelta,
        updatedAt: nowMs()
      });
    });
  } catch (error) {
    console.error("Fehler beim Anwenden des ELO-Ergebnisses:", error);

    try {
      await updateDoc(gameRef, {
        ratingApplied: true,
        ratingAppliedAt: nowMs(),
        ratingError: true,
        updatedAt: nowMs()
      });
    } catch (secondError) {
      console.error("Fehler beim Fallback-Update:", secondError);
    }
  } finally {
    ratingApplyInProgress = false;
  }
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

  const normalizedGlobalBoard = newMiniBoardWinners.map((value) => (value === "draw" ? "" : value));
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

function getAllValidMovesForState(stateCellStates, stateMiniBoardWinners, stateNextBoardIndex) {
  const moves = [];

  for (let boardIndex = 0; boardIndex < 9; boardIndex++) {
    if (stateMiniBoardWinners[boardIndex] !== "") continue;
    if (stateNextBoardIndex !== null && stateNextBoardIndex !== boardIndex) continue;

    for (let cellIndex = 0; cellIndex < 9; cellIndex++) {
      if (getCellValue(stateCellStates, boardIndex, cellIndex) === "") {
        moves.push({ boardIndex, cellIndex });
      }
    }
  }

  return moves;
}

function countLinePotential(line, player) {
  const opponent = player === "X" ? "O" : "X";
  const own = line.filter((x) => x === player).length;
  const opp = line.filter((x) => x === opponent).length;
  const empty = line.filter((x) => x === "").length;

  if (opp > 0 && own > 0) return 0;
  if (own === 3) return 500;
  if (own === 2 && empty === 1) return 35;
  if (own === 1 && empty === 2) return 6;
  if (opp === 2 && empty === 1) return -30;
  if (opp === 3) return -500;
  return 0;
}

function evaluateMiniBoard(board, player) {
  const opponent = player === "X" ? "O" : "X";
  let score = 0;

  const winner = getWinner(board);
  if (winner === player) return 120;
  if (winner === opponent) return -120;

  if (board[4] === player) score += 4;
  if (board[4] === opponent) score -= 4;

  [0, 2, 6, 8].forEach((i) => {
    if (board[i] === player) score += 2;
    if (board[i] === opponent) score -= 2;
  });

  for (const [a, b, c] of WINNING_COMBINATIONS) {
    score += countLinePotential([board[a], board[b], board[c]], player);
  }

  return score;
}

function evaluateGlobalBoard(stateMiniBoardWinners, player) {
  const normalized = stateMiniBoardWinners.map((v) => (v === "draw" ? "" : v));
  const opponent = player === "X" ? "O" : "X";
  let score = 0;

  const winner = getWinner(normalized);
  if (winner === player) return 1000000;
  if (winner === opponent) return -1000000;

  if (normalized[4] === player) score += 40;
  if (normalized[4] === opponent) score -= 40;

  [0, 2, 6, 8].forEach((i) => {
    if (normalized[i] === player) score += 18;
    if (normalized[i] === opponent) score -= 18;
  });

  for (const [a, b, c] of WINNING_COMBINATIONS) {
    score += countLinePotential([normalized[a], normalized[b], normalized[c]], player) * 8;
  }

  return score;
}

function countImmediateWinningMovesFor(state, player) {
  const moves = getAllValidMovesForState(state.cellStates, state.miniBoardWinners, state.nextBoardIndex);
  let count = 0;

  for (const move of moves) {
    const nextState = buildNextStateFrom(
      player,
      state.cellStates,
      state.miniBoardWinners,
      state.nextBoardIndex,
      move.boardIndex,
      move.cellIndex
    );
    if (nextState.winner === player) count++;
  }

  return count;
}

function evaluateState(state, perspectivePlayer) {
  const opponent = perspectivePlayer === "X" ? "O" : "X";

  if (state.winner === perspectivePlayer) return 10000000;
  if (state.winner === opponent) return -10000000;
  if (state.winner === "draw") return 0;

  let score = 0;

  score += evaluateGlobalBoard(state.miniBoardWinners, perspectivePlayer);

  for (let boardIndex = 0; boardIndex < 9; boardIndex++) {
    const winnerMark = state.miniBoardWinners[boardIndex];
    if (winnerMark === "") {
      score += evaluateMiniBoard(getMiniBoard(state.cellStates, boardIndex), perspectivePlayer);
    } else if (winnerMark === perspectivePlayer) {
      score += boardIndex === 4 ? 30 : [0, 2, 6, 8].includes(boardIndex) ? 20 : 14;
    } else if (winnerMark === opponent) {
      score -= boardIndex === 4 ? 30 : [0, 2, 6, 8].includes(boardIndex) ? 20 : 14;
    }
  }

  const ownThreats = countImmediateWinningMovesFor(state, perspectivePlayer);
  const oppThreats = countImmediateWinningMovesFor(state, opponent);

  score += ownThreats * 220;
  score -= oppThreats * 260;

  if (state.nextBoardIndex === null) {
    score += 6;
  } else {
    const target = state.nextBoardIndex;
    if (state.miniBoardWinners[target] === perspectivePlayer) score += 12;
    if (state.miniBoardWinners[target] === opponent) score += 16;
  }

  return score;
}

function scoreMoveHeuristic(state, move, player) {
  const nextState = buildNextStateFrom(
    player,
    state.cellStates,
    state.miniBoardWinners,
    state.nextBoardIndex,
    move.boardIndex,
    move.cellIndex
  );

  let score = evaluateState(nextState, player);
  const opponent = player === "X" ? "O" : "X";

  if (nextState.winner === player) score += 5000000;
  if (nextState.winner === opponent) score -= 5000000;

  const boardWeight = move.boardIndex === 4 ? 20 : [0, 2, 6, 8].includes(move.boardIndex) ? 10 : 6;
  const cellWeight = move.cellIndex === 4 ? 16 : [0, 2, 6, 8].includes(move.cellIndex) ? 9 : 5;
  score += boardWeight + cellWeight;

  return score;
}

function getCandidateMoves(state, player, limit = 8) {
  const moves = getAllValidMovesForState(state.cellStates, state.miniBoardWinners, state.nextBoardIndex);

  return moves
    .map((move) => ({
      ...move,
      heuristic: scoreMoveHeuristic(state, move, player)
    }))
    .sort((a, b) => b.heuristic - a.heuristic)
    .slice(0, limit);
}

function minimax(state, depth, alpha, beta, maximizingPlayer, perspectivePlayer, candidateLimit) {
  const opponent = perspectivePlayer === "X" ? "O" : "X";

  if (depth === 0 || state.gameOver) {
    return {
      score: evaluateState(state, perspectivePlayer),
      move: null
    };
  }

  const playerToMove = maximizingPlayer ? perspectivePlayer : opponent;
  const candidates = getCandidateMoves(state, playerToMove, candidateLimit);

  if (candidates.length === 0) {
    return {
      score: evaluateState(state, perspectivePlayer),
      move: null
    };
  }

  if (maximizingPlayer) {
    let bestScore = -Infinity;
    let bestMove = candidates[0];

    for (const move of candidates) {
      const nextState = buildNextStateFrom(
        playerToMove,
        state.cellStates,
        state.miniBoardWinners,
        state.nextBoardIndex,
        move.boardIndex,
        move.cellIndex
      );

      const result = minimax(nextState, depth - 1, alpha, beta, false, perspectivePlayer, candidateLimit);
      const score = result.score;

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }

      alpha = Math.max(alpha, bestScore);
      if (beta <= alpha) break;
    }

    return { score: bestScore, move: bestMove };
  }

  let bestScore = Infinity;
  let bestMove = candidates[0];

  for (const move of candidates) {
    const nextState = buildNextStateFrom(
      playerToMove,
      state.cellStates,
      state.miniBoardWinners,
      state.nextBoardIndex,
      move.boardIndex,
      move.cellIndex
    );

    const result = minimax(nextState, depth - 1, alpha, beta, true, perspectivePlayer, candidateLimit);
    const score = result.score;

    if (score < bestScore) {
      bestScore = score;
      bestMove = move;
    }

    beta = Math.min(beta, bestScore);
    if (beta <= alpha) break;
  }

  return { score: bestScore, move: bestMove };
}

function findImmediateWinningMove(state, player) {
  const moves = getAllValidMovesForState(state.cellStates, state.miniBoardWinners, state.nextBoardIndex);

  for (const move of moves) {
    const nextState = buildNextStateFrom(
      player,
      state.cellStates,
      state.miniBoardWinners,
      state.nextBoardIndex,
      move.boardIndex,
      move.cellIndex
    );

    if (nextState.winner === player) {
      return move;
    }
  }

  return null;
}

function chooseBotMove() {
  const state = {
    cellStates: [...cellStates],
    miniBoardWinners: [...miniBoardWinners],
    currentPlayer,
    nextBoardIndex,
    winner: "",
    status: gameOver ? "finished" : "playing",
    gameOver
  };

  const validMoves = getAllValidMovesForState(state.cellStates, state.miniBoardWinners, state.nextBoardIndex);
  if (validMoves.length === 0) return null;

  const immediateWin = findImmediateWinningMove(state, "O");
  if (immediateWin) return immediateWin;

  if (botDifficulty === "easy") {
    const candidates = getCandidateMoves(state, "O", Math.min(6, validMoves.length));
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  const depth = botDifficulty === "hard" ? 3 : 2;
  const limit = botDifficulty === "hard" ? 6 : 5;
  const result = minimax(state, depth, -Infinity, Infinity, true, "O", limit);
  if (result.move) return result.move;

  const fallbackCandidates = getCandidateMoves(state, "O", Math.min(5, validMoves.length));
  return fallbackCandidates[0] || validMoves[0];
}

function clearResultOverlay() {
  if (resultOverlay) {
    resultOverlay.remove();
    resultOverlay = null;
  }
}

function showResultOverlay(type, title, subtitle) {
  clearResultOverlay();

  resultOverlay = document.createElement("div");
  resultOverlay.className = `game-result-overlay ${type}`;

  const inner = document.createElement("div");
  inner.className = "game-result-inner";

  const titleEl = document.createElement("div");
  titleEl.className = "game-result-title";
  titleEl.textContent = title;

  const subtitleEl = document.createElement("div");
  subtitleEl.className = "game-result-subtitle";
  subtitleEl.textContent = subtitle;

  inner.appendChild(titleEl);
  inner.appendChild(subtitleEl);
  resultOverlay.appendChild(inner);
  ultimateBoard.appendChild(resultOverlay);
}

function updateResultOverlay() {
  if (!gameOver) {
    clearResultOverlay();
    return;
  }

  const normalizedGlobalBoard = miniBoardWinners.map((value) => (value === "draw" ? "" : value));
  const globalWinner = getWinner(normalizedGlobalBoard);

  if (isOnlineGame) {
    const result = getOnlineResultText(currentGameData);
    showResultOverlay(result.type, result.title, result.subtitle);
    return;
  }

  if (!globalWinner && miniBoardWinners.every((value) => value !== "")) {
    showResultOverlay("draw", "Unentschieden", "Keiner konnte das große Feld für sich entscheiden.");
    return;
  }

  if (isBotGame) {
    if (globalWinner === "X") {
      showResultOverlay("win", "Du gewinnst!", "Du hast den Bot geschlagen.");
    } else if (globalWinner === "O") {
      showResultOverlay("loss", "Bot gewinnt", "Der Bot war dieses Mal stärker.");
    } else {
      showResultOverlay("draw", "Unentschieden", "Niemand gewinnt diese Runde.");
    }
    return;
  }

  if (globalWinner === "X" || globalWinner === "O") {
    showResultOverlay("draw", `Spieler ${globalWinner} gewinnt`, "Das Spiel ist beendet.");
  } else {
    showResultOverlay("draw", "Unentschieden", "Das Spiel ist beendet.");
  }
}

function maybeTriggerBotMove() {
  if (!isBotGame || gameOver || currentPlayer !== "O" || botThinking) return;

  botThinking = true;
  statusTextEl.textContent = `Bot (${botDifficulty}) denkt...`;

  setTimeout(() => {
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

    if (nextState.winner === "O") {
      statusTextEl.textContent = "Bot gewinnt das Spiel!";
    } else if (nextState.winner === "draw") {
      statusTextEl.textContent = "Unentschieden!";
    } else {
      statusTextEl.textContent = "Du bist am Zug.";
    }

    botThinking = false;
    render();
  }, botDifficulty === "easy" ? 350 : botDifficulty === "medium" ? 550 : 750);
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

  if (isBotGame) {
    if (currentPlayer !== "X") return false;
    if (botThinking) return false;
  }

  return true;
}

function createBoard() {
  ultimateBoard.innerHTML = "";
  clearResultOverlay();

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

    const overlay = document.createElement("div");
    overlay.className = "mini-board-winner";
    overlay.dataset.overlayBoardIndex = String(boardIndex);
    miniBoard.appendChild(overlay);

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

  if (nextState.winner === "X") {
    statusTextEl.textContent = isBotGame ? "Du gewinnst das Spiel!" : "Spieler X gewinnt das Spiel!";
  } else if (nextState.winner === "O") {
    statusTextEl.textContent = isBotGame ? "Bot gewinnt das Spiel!" : "Spieler O gewinnt das Spiel!";
  } else if (nextState.winner === "draw") {
    statusTextEl.textContent = "Unentschieden!";
  } else {
    statusTextEl.textContent = isBotGame ? `Bot (${botDifficulty}) ist am Zug.` : `Spieler ${currentPlayer} ist am Zug.`;
  }

  render();
  maybeTriggerBotMove();
}

function renderMiniBoardOverlays() {
  const miniBoards = ultimateBoard.querySelectorAll(".mini-board");

  miniBoards.forEach((miniBoardEl, boardIndex) => {
    const overlay = miniBoardEl.querySelector(".mini-board-winner");
    if (!overlay) return;

    const winner = miniBoardWinners[boardIndex];
    overlay.classList.remove("show", "winner-x", "winner-o", "winner-draw");
    overlay.textContent = "";

    if (winner === "X") {
      overlay.textContent = "X";
      overlay.classList.add("show", "winner-x");
    } else if (winner === "O") {
      overlay.textContent = "O";
      overlay.classList.add("show", "winner-o");
    } else if (winner === "draw") {
      overlay.textContent = "—";
      overlay.classList.add("show", "winner-draw");
    }
  });
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

  renderMiniBoardOverlays();
  updateResultOverlay();

  currentPlayerEl.textContent = currentPlayer;
  targetBoardEl.textContent = nextBoardIndex === null ? "Beliebig" : boardName(nextBoardIndex);
}

async function applyGameSnapshot(game) {
  currentGameData = game;
  currentPlayer = game.currentPlayer ?? "X";
  nextBoardIndex = game.nextBoardIndex ?? null;
  cellStates = Array.isArray(game.cellStates) ? game.cellStates : Array(81).fill("");
  miniBoardWinners = Array.isArray(game.miniBoardWinners) ? game.miniBoardWinners : Array(9).fill("");

  if (game.winner === "X" || game.winner === "O" || game.winner === "draw") {
    gameOver = true;

    if (isOnlineGame) {
      const result = getOnlineResultText(game);
      statusTextEl.textContent = `${result.title} ${result.subtitle}`;
    } else if (game.winner === "X" || game.winner === "O") {
      statusTextEl.textContent = `Spieler ${game.winner} gewinnt das Spiel!`;
    } else {
      statusTextEl.textContent = "Unentschieden!";
    }
  } else {
    gameOver = false;
    statusTextEl.textContent =
      currentPlayer === playerSymbol
        ? "Du bist am Zug."
        : `Spieler ${currentPlayer} ist am Zug.`;
  }

  render();

  if (isOnlineGame && gameOver && !game.ratingApplied) {
    applyOnlineGameResultIfNeeded(game);
  }
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
    clearResultOverlay();

    if (isBotGame) {
      statusTextEl.textContent = "Du bist am Zug.";
    } else {
      statusTextEl.textContent = "Spiel läuft";
    }

    render();
  });
}

function initLocalGame() {
  isOnlineGame = false;
  isBotGame = false;
  currentPlayer = "X";
  nextBoardIndex = null;
  gameOver = false;
  cellStates = Array(81).fill("");
  miniBoardWinners = Array(9).fill("");
  clearResultOverlay();

  modeTextEl.textContent = "Local";
  playerRoleTextEl.textContent = "X / O lokal";
  gameIdTextEl.textContent = "-";
  gameSubtitleEl.textContent = "Lokales Spiel auf einem Gerät.";
  statusTextEl.textContent = "Spiel läuft";

  updateGameActionButtons();
  createBoard();
  render();
}

function initBotGame(mode) {
  isOnlineGame = false;
  isBotGame = true;
  botDifficulty = mode.replace("bot-", "");
  playerSymbol = "X";

  currentPlayer = "X";
  nextBoardIndex = null;
  gameOver = false;
  cellStates = Array(81).fill("");
  miniBoardWinners = Array(9).fill("");
  clearResultOverlay();

  modeTextEl.textContent = `Bot ${botDifficulty[0].toUpperCase()}${botDifficulty.slice(1)}`;
  playerRoleTextEl.textContent = "Du bist X";
  gameIdTextEl.textContent = "-";
  gameSubtitleEl.textContent = `Offline gegen einen smarteren Bot (${botDifficulty}).`;
  statusTextEl.textContent = "Du bist am Zug.";

  updateGameActionButtons();
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
  isBotGame = false;
  clearResultOverlay();

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

  updateGameActionButtons();
  createBoard();

  onSnapshot(gameRef, async (snapshot) => {
    if (!snapshot.exists()) {
      statusTextEl.textContent = "Dieses Spiel wurde entfernt.";
      return;
    }

    await applyGameSnapshot(snapshot.data());
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

  if (mode === "bot-easy" || mode === "bot-medium" || mode === "bot-hard") {
    initBotGame(mode);
    return;
  }

  initLocalGame();
});