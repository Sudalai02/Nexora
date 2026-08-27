// ============================================================
// AUTH SERVICE — Firebase Authentication wrapper
// Uses Google Identity Services OAuth2 popup — no COOP issues
// ============================================================

import {
  auth,
  googleProvider,
  GOOGLE_CLIENT_ID,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithCredential,
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

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  authReady = true;
  authListeners.forEach((fn) => fn(user));
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

let googleClient = null;

function waitForGoogle(callback, retries = 30) {
  if (window.google?.accounts?.oauth2) {
    callback();
  } else if (retries > 0) {
    setTimeout(() => waitForGoogle(callback, retries - 1), 200);
  }
}

export function loginWithGoogle() {
  return new Promise((resolve, reject) => {
    waitForGoogle(() => {
      if (!googleClient) {
        googleClient = google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: "email profile openid",
          callback: async (tokenResponse) => {
            try {
              const credential = GoogleAuthProvider.credential(
                null,
                tokenResponse.access_token
              );
              const cred = await signInWithCredential(auth, credential);
              resolve(cred.user);
            } catch (err) {
              console.error("[auth] Firebase credential sign-in failed:", err);
              reject(err);
            }
          },
          error_callback: (err) => {
            console.error("[auth] Google OAuth error:", err);
            reject(new Error(err.type || "Google sign-in was cancelled or failed"));
          },
        });
      }
      googleClient.requestAccessToken();
    });

    setTimeout(() => {
      reject(new Error("Google Sign-In library failed to load. Check your internet connection."));
    }, 8000);
  });
}

export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

export async function logout() {
  await signOut(auth);
  currentUser = null;
  location.reload();
}
