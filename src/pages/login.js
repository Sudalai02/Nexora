// ============================================================
// LOGIN PAGE — Email/password + Google OAuth2 popup
// ============================================================

import {
  loginWithEmail,
  registerWithEmail,
  loginWithGoogle,
  resetPassword,
} from "../services/authService.js";

let isSignUp = false;

export function renderLoginScreen() {
  const screen = document.getElementById("auth-screen");
  if (!screen) return;
  if (screen.querySelector(".auth-card")) return;

  isSignUp = false;

  screen.innerHTML = `
    <div class="auth-card">
      <div class="auth-brand">
        <img src="icons/logoimage.PNG" alt="TaskTrack" />
        <h1>TaskTrack</h1>
        <p id="auth-subtitle">Welcome back — sign in to your account</p>
      </div>

      <div class="auth-error" id="auth-error"></div>

      <form class="auth-form" id="auth-form" autocomplete="on">
        <div class="auth-field">
          <label for="auth-email">Email</label>
          <input type="email" id="auth-email" placeholder="you@example.com" required autocomplete="email" />
        </div>

        <div class="auth-field">
          <label for="auth-password">Password</label>
          <input type="password" id="auth-password" placeholder="••••••••" required autocomplete="current-password" minlength="6" />
        </div>

        <div class="auth-register-fields" id="auth-register-fields">
          <div class="auth-field">
            <label for="auth-name">Full name</label>
            <input type="text" id="auth-name" placeholder="Alex Rivera" autocomplete="name" />
          </div>
        </div>

        <button type="button" class="auth-forgot" id="auth-forgot-btn">Forgot password?</button>

        <button type="submit" class="auth-submit" id="auth-submit-btn">Sign In</button>
      </form>

      <div class="auth-divider">OR</div>

      <button class="auth-google-btn" id="auth-google-btn">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
        Continue with Google
      </button>

      <div class="auth-switch" id="auth-switch">
        Don't have an account? <button type="button" id="auth-toggle-btn">Create account</button>
      </div>
    </div>
  `;

  const form = document.getElementById("auth-form");
  const emailInput = document.getElementById("auth-email");
  const passwordInput = document.getElementById("auth-password");
  const nameInput = document.getElementById("auth-name");
  const errorEl = document.getElementById("auth-error");
  const submitBtn = document.getElementById("auth-submit-btn");
  const toggleBtn = document.getElementById("auth-toggle-btn");
  const forgotBtn = document.getElementById("auth-forgot-btn");
  const googleBtn = document.getElementById("auth-google-btn");
  const registerFields = document.getElementById("auth-register-fields");
  const subtitle = document.getElementById("auth-subtitle");
  const switchEl = document.getElementById("auth-switch");

  function showError(msg, type) {
    errorEl.textContent = msg;
    errorEl.classList.add("visible");
    if (type === "success") {
      errorEl.style.background = "var(--good-soft)";
      errorEl.style.color = "var(--good)";
    } else {
      errorEl.style.background = "";
      errorEl.style.color = "";
    }
  }
  function clearError() {
    errorEl.classList.remove("visible");
    errorEl.textContent = "";
    errorEl.style.background = "";
    errorEl.style.color = "";
  }
  function setLoading(loading) {
    submitBtn.disabled = loading;
    googleBtn.disabled = loading;
    submitBtn.textContent = loading ? "Please wait…" : (isSignUp ? "Create Account" : "Sign In");
  }

  function handleToggle() {
    isSignUp = !isSignUp;
    clearError();
    submitBtn.textContent = isSignUp ? "Create Account" : "Sign In";
    subtitle.textContent = isSignUp ? "Create your account to get started" : "Welcome back — sign in to your account";
    registerFields.classList.toggle("visible", isSignUp);
    forgotBtn.style.display = isSignUp ? "none" : "";
    switchEl.innerHTML = isSignUp
      ? 'Already have an account? <button type="button" id="auth-toggle-btn">Sign in</button>'
      : 'Don\'t have an account? <button type="button" id="auth-toggle-btn">Create account</button>';
    switchEl.querySelector("#auth-toggle-btn").addEventListener("click", handleToggle);
  }
  toggleBtn.addEventListener("click", handleToggle);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError();
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) { showError("Please fill in all fields."); return; }
    if (password.length < 6) { showError("Password must be at least 6 characters."); return; }

    setLoading(true);
    try {
      if (isSignUp) {
        const name = nameInput.value.trim();
        await registerWithEmail(email, password, name || undefined);
      } else {
        await loginWithEmail(email, password);
      }
    } catch (err) {
      const code = err.code || "";
      const messages = {
        "auth/user-not-found": "No account found with this email.",
        "auth/wrong-password": "Incorrect password.",
        "auth/invalid-email": "Invalid email address.",
        "auth/email-already-in-use": "An account with this email already exists.",
        "auth/weak-password": "Password should be at least 6 characters.",
        "auth/too-many-requests": "Too many attempts. Please try again later.",
        "auth/invalid-credential": "Invalid email or password.",
      };
      showError(messages[code] || err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  });

  forgotBtn.addEventListener("click", async () => {
    const email = emailInput.value.trim();
    if (!email) { showError("Enter your email above, then click Forgot password."); return; }
    setLoading(true);
    try {
      await resetPassword(email);
      showError("Password reset email sent. Check your inbox.", "success");
    } catch (err) {
      showError(err.code === "auth/user-not-found" ? "No account found with this email." : "Could not send reset email.");
    } finally {
      setLoading(false);
    }
  });

  googleBtn.addEventListener("click", async () => {
    clearError();
    setLoading(true);
    try {
      await loginWithGoogle();
    } catch (err) {
      setLoading(false);
      const msg = err.message || "";
      if (msg.includes("cancelled") || msg.includes("closed") || msg.includes("Canceled")) {
        showError("Sign-in cancelled. Please try again.");
      } else if (msg.includes("failed to load")) {
        showError("Google Sign-In failed to load. Check your internet connection.");
      } else {
        showError("Google sign-in failed: " + msg);
      }
    }
  });
}
