import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const registerUsernameEl = document.getElementById("registerUsername");
const registerEmailEl = document.getElementById("registerEmail");
const registerPasswordEl = document.getElementById("registerPassword");
const registerBtn = document.getElementById("registerBtn");
const registerHint = document.getElementById("registerHint");

const loginEmailEl = document.getElementById("loginEmail");
const loginPasswordEl = document.getElementById("loginPassword");
const loginBtn = document.getElementById("loginBtn");
const loginHint = document.getElementById("loginHint");

function nowMs() {
  return Date.now();
}

function normalizeUsername(username) {
  return username.trim().replace(/\s+/g, " ");
}

async function ensureUserProfile(user, usernameOverride = null) {
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);
  const timestamp = nowMs();

  if (!snap.exists()) {
    const username = usernameOverride || user.email?.split("@")[0] || "Player";
    await setDoc(userRef, {
      uid: user.uid,
      username,
      email: user.email ?? "",
      status: "online",
      lastSeen: timestamp,
      rating: 1000,
      wins: 0,
      losses: 0,
      draws: 0,
      currentGameId: null,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    return;
  }

  await updateDoc(userRef, {
    status: "online",
    lastSeen: timestamp,
    updatedAt: timestamp
  });
}

if (registerBtn && registerUsernameEl && registerEmailEl && registerPasswordEl && registerHint) {
  registerBtn.addEventListener("click", async () => {
    const username = normalizeUsername(registerUsernameEl.value);
    const email = registerEmailEl.value.trim();
    const password = registerPasswordEl.value;

    if (!username || username.length < 3) {
      registerHint.textContent = "Der Username muss mindestens 3 Zeichen lang sein.";
      return;
    }

    if (!email) {
      registerHint.textContent = "Bitte gib eine E-Mail ein.";
      return;
    }

    if (!password || password.length < 6) {
      registerHint.textContent = "Das Passwort muss mindestens 6 Zeichen lang sein.";
      return;
    }

    registerBtn.disabled = true;
    registerHint.textContent = "Account wird erstellt...";

    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await ensureUserProfile(credential.user, username);
      registerHint.textContent = "Registrierung erfolgreich. Weiterleitung...";
      window.location.href = "online.html";
    } catch (error) {
      console.error(error);
      registerHint.textContent = `Fehler: ${error.message}`;
      registerBtn.disabled = false;
    }
  });
}

if (loginBtn && loginEmailEl && loginPasswordEl && loginHint) {
  loginBtn.addEventListener("click", async () => {
    const email = loginEmailEl.value.trim();
    const password = loginPasswordEl.value;

    if (!email || !password) {
      loginHint.textContent = "Bitte gib E-Mail und Passwort ein.";
      return;
    }

    loginBtn.disabled = true;
    loginHint.textContent = "Anmeldung läuft...";

    try {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      await ensureUserProfile(credential.user);
      loginHint.textContent = "Login erfolgreich. Weiterleitung...";
      window.location.href = "online.html";
    } catch (error) {
      console.error(error);
      loginHint.textContent = `Fehler: ${error.message}`;
      loginBtn.disabled = false;
    }
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  if (!window.location.pathname.endsWith("login.html")) return;

  try {
    await ensureUserProfile(user);
    window.location.href = "online.html";
  } catch (error) {
    console.error("Fehler beim automatischen Weiterleiten:", error);
  }
});