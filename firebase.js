import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAzDjpdElxJOZh7Vs0ceo4lZVkAg6yCbXM",
  authDomain: "ultimate-tictactoe-9ccfe.firebaseapp.com",
  projectId: "ultimate-tictactoe-9ccfe",
  storageBucket: "ultimate-tictactoe-9ccfe.firebasestorage.app",
  messagingSenderId: "165552516047",
  appId: "1:165552516047:web:e8e575b7e57db0143a40ba",
  measurementId: "G-QH71CQNTQ1"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
export { app };