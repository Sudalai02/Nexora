// ============================================================
// FIREBASE CONFIGURATION
// Replace these with your Firebase project credentials.
// Get them from: Firebase Console → Project Settings → General
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithRedirect,
  getRedirectResult,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDlaypoiUAc_nRu6vq4mEUlRgU3L8drgVc",
  authDomain: "tasktrack-ss003.firebaseapp.com",
  projectId: "tasktrack-ss003",
  storageBucket: "tasktrack-ss003.firebasestorage.app",
  messagingSenderId: "971261797435",
  appId: "1:971261797435:web:647f163f000a0df483e81e",
  measurementId: "G-ZYJ2JQFKL4"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export {
  auth,
  googleProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithRedirect,
  getRedirectResult,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut,
  updateProfile,
};
