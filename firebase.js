
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";

import {
  getAuth
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";

import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

import {
  getStorage
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-storage.js";

import {
  getDatabase
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-database.js";

// ======================================================
// ZORAAPP FIREBASE CONFIGURATION
// ======================================================

const firebaseConfig = {
  apiKey: "AIzaSyDqbDck7AmVs3_C13Wua23hse9byknRVK4",
  authDomain: "zora-dev-bf770.firebaseapp.com",
  projectId: "zora-dev-bf770",
  storageBucket: "zora-dev-bf770.firebasestorage.app",
  messagingSenderId: "66039479322",
  appId: "1:66039479322:web:06d87e986d26b6acf365a3",
  measurementId: "G-KSTG1PJ6YT",
  databaseURL: "https://zora-dev-bf770-default-rtdb.asia-southeast1.firebasedatabase.app/"
};

// ======================================================
// INITIALIZE FIREBASE
// ======================================================

export const app = initializeApp(firebaseConfig);

// Authentication
export const auth = getAuth(app);

// Cloud Firestore
export const db = getFirestore(app);

// Firebase Storage
export const storage = getStorage(app);

// Realtime Database
export const rtdb = getDatabase(app);

// ======================================================
// EXPORT CONFIGURATION
// ======================================================

export default app;

console.log("ZORAAPP Firebase initialized.");
