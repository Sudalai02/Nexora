// ============================================================
// LOGIN PAGE — Email/password + Google Identity Services button
// ============================================================

import {
  loginWithEmail,
  registerWithEmail,
  resetPassword,
  initGoogleButton,
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

      <div class="auth-google-wrap" id="auth-google-wrap"></div>

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
  const googleWrap = document.getElementById("auth-google-wrap");
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

  initGoogleButton(googleWrap, (loading, errorMsg) => {
    if (errorMsg) {
      showError("Google sign-in failed: " + errorMsg);
    }
  });
}
