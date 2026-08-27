// ============================================================
// AUTH SERVICE — Firebase Authentication wrapper
// Uses Google Identity Services renderButton (ID token)
// ============================================================

import {
  auth,
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
  syncFirebaseProfile(user);
});

async function syncFirebaseProfile(user) {
  if (!user) return;
  const { getProfile, saveProfile } = await import("./settingsService.js");
  const profile = await getProfile();
  if (!profile || !profile.email || profile.name === "Alex Rivera") {
    const update = {};
    if (user.displayName) update.name = user.displayName;
    if (user.email) update.email = user.email;
    const photo =
      user.photoURL && (profile && !profile.avatar) ? { avatar: user.photoURL } : {};
    await saveProfile({ ...update, ...photo });
  }
}

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

let googleInitDone = false;

export function initGoogleButton(containerEl, onLoadingChange) {
  function tryInit() {
    if (googleInitDone) return;
    if (!window.google?.accounts?.id) {
      setTimeout(tryInit, 300);
      return;
    }
    googleInitDone = true;

    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: async (response) => {
        if (!response.credential) {
          if (onLoadingChange) onLoadingChange(false, "No credential received from Google.");
          return;
        }
        try {
          const credential = GoogleAuthProvider.credential(response.credential);
          await signInWithCredential(auth, credential);
        } catch (err) {
          console.error("[auth] Firebase Google sign-in failed:", err);
          if (onLoadingChange) onLoadingChange(false, err.message || "Firebase sign-in failed after Google authentication.");
        }
      },
      error_callback: (err) => {
        console.error("[auth] Google GIS error:", err);
        if (onLoadingChange) onLoadingChange(false, err.message || "Google sign-in error.");
      },
    });

    google.accounts.id.renderButton(containerEl, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "continue_with",
      shape: "rectangular",
      width: containerEl.offsetWidth || 320,
    });
  }

  tryInit();
}

export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

export async function logout() {
  await signOut(auth);
  currentUser = null;
  location.reload();
}
