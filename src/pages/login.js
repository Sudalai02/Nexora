// ============================================================
// LOGIN PAGE — Google OAuth gate.
// Shows Google sign-in when Firebase is configured.
// When Firebase is not configured, the app runs local-only.
// ============================================================

import { signInWithGoogle, isFirebaseReady, getUser } from "../services/firebaseService.js";
import { toast } from "../ui/toast.js";

export async function renderLogin(view) {
  if (getUser()) {
    window.location.hash = "#/home";
    return;
  }

  const fbReady = isFirebaseReady();

  view.innerHTML = `
    <div class="login-page">
      <div class="login-card">
        <div class="login-brand">
          <img src="icons/logoimage.PNG" class="login-logo" alt="TaskTrack" />
          <h1>TaskTrack</h1>
          <p class="login-sub">Personal Productivity OS</p>
        </div>

        ${fbReady ? `
        <button class="google-btn" id="google-signin">
          <svg class="google-icon" viewBox="0 0 24 24" width="20" height="20">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Sign in with Google
        </button>
        <div class="login-error" id="login-error"></div>
        ` : ""}

        <div class="login-skip">
          <button class="btn btn-ghost btn-sm" id="skip-login">Continue without account</button>
          <p class="login-hint">${fbReady ? "Sign in to sync data across devices" : "Data stays on this device only"}</p>
        </div>
      </div>
    </div>
  `;

  // Google sign-in
  if (fbReady) {
    const btn = view.querySelector("#google-signin");
    const errEl = view.querySelector("#login-error");

    btn?.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Signing in...";
      errEl.textContent = "";

      try {
        await signInWithGoogle();
        toast("Welcome");
        location.reload();
      } catch (err) {
        console.error("[login] Google sign-in error:", err.code, err.message);
        const msg = friendlyError(err.code);
        errEl.textContent = msg;
        btn.disabled = false;
        btn.innerHTML = `
          <svg class="google-icon" viewBox="0 0 24 24" width="20" height="20">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Sign in with Google
        `;
      }
    });
  }

  // Skip login
  view.querySelector("#skip-login")?.addEventListener("click", () => {
    window.location.hash = "#/home";
  });
}

function friendlyError(code) {
  const map = {
    "auth/popup-closed-by-user": "Sign-in cancelled — you closed the popup",
    "auth/popup-blocked": "Popup was blocked — allow popups for this site",
    "auth/network-request-failed": "Network error — check your connection",
    "auth/too-many-requests": "Too many attempts — try again later",
    "auth/account-exists-with-different-credential": "An account already exists with this email using a different sign-in method",
    "auth/operation-not-allowed": "Google sign-in is not enabled in Firebase Console. Go to: Authentication -> Sign-in method -> Enable Google",
    "auth/unauthorized-domain": "This domain is not authorized. Go to: Firebase Console -> Authentication -> Settings -> Authorized domains -> Add 'localhost'",
    "auth/invalid-api-key": "Invalid API key — check your Firebase config in appConfig.js",
    "auth/api-key-not-valid": "API key is not valid — check your Firebase config in appConfig.js",
  };
  return map[code] || ("Error: " + (code || "unknown") + " — check Firebase Console settings");
}
