// ============================================================
// AUTH SERVICE — Firebase Authentication wrapper
// ============================================================

import {
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
} from "../config/firebase.js";

let currentUser = null;
let authListeners = [];
let authReady = false;

export function getCurrentUser() {
  return currentUser;
}

export function onAuthChange(callback) {
  authListeners.push(callback);
  if (authReady) callback(currentUser);
  return () => {
    authListeners = authListeners.filter((fn) => fn !== callback);
  };
}

// Process redirect result FIRST, then start listening for auth state.
// This ensures after a Google redirect, the user is set before any
// listener checks currentUser.
getRedirectResult(auth)
  .catch((err) => {
    console.error("[auth] redirect result error:", err);
  })
  .finally(() => {
    onAuthStateChanged(auth, (user) => {
      currentUser = user;
      authReady = true;
      authListeners.forEach((fn) => fn(user));
    });
  });

export async function loginWithEmail(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function registerWithEmail(email, password, displayName) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName) {
    await updateProfile(cred.user, { displayName });
  }
  return cred.user;
}

export async function loginWithGoogle() {
  await signInWithRedirect(auth, googleProvider);
}

export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

export async function logout() {
  await signOut(auth);
  currentUser = null;
  location.reload();
}
