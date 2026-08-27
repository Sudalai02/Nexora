// ============================================================
// FIREBASE CONFIGURATION
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithCredential,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDlaypoiUAc_nRu6vq4mEUlRgU3L8drgVc",
  authDomain: "tasktrack-ss003.firebaseapp.com",
  projectId: "tasktrack-ss003",
  storageBucket: "tasktrack-ss003.firebasestorage.app",
  messagingSenderId: "971261797435",
  appId: "1:971261797435:web:647f163f000a0df483e81e",
  measurementId: "G-ZYJ2JQFKL4"
};

// Paste your Google OAuth Client ID here from:
// Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs (type: Web application)
const GOOGLE_CLIENT_ID = "971261797435-5vmnjhothmdjd16eos912frf6t9ip80v.apps.googleusercontent.com";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export {
  app,
  auth,
  auth as firebaseAuth,
  GoogleAuthProvider,
  googleProvider,
  GOOGLE_CLIENT_ID,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithCredential,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut,
  updateProfile,
};
