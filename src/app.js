import { initRouter, registerRoute, rerender } from "./router.js";
import { renderHome } from "./pages/home.js";
import { renderTasks } from "./pages/tasks.js";
import { renderProjects } from "./pages/projects.js";
import { renderGoals } from "./pages/goals.js";
import { renderCalendar } from "./pages/calendar.js";
import { renderFocus } from "./pages/focus.js";
import { renderNotes } from "./pages/notes.js";
import { renderInbox } from "./pages/inbox.js";
import { renderInsights } from "./pages/insights.js";
import { renderAssistant } from "./pages/assistant.js";
import { renderSettings } from "./pages/settings.js";
import { renderRecycleBin } from "./pages/recycleBin.js";
import { renderMore } from "./pages/more.js";
import { seedIfNeeded } from "./store/seed.js";
import * as db from "./store/db.js";
import { getProfile, getSettings } from "./services/settingsService.js";
import { addItem } from "./services/inboxService.js";
import * as recycleSvc from "./services/recycleService.js";
import * as notificationSvc from "./services/notificationService.js";
import { openSearch } from "./ui/searchOverlay.js";
import { initBellPanel } from "./ui/bellPanel.js";
import { toast } from "./ui/toast.js";
import { applyTheme } from "./pages/settings.js";
import { onAuthChange, logout } from "./services/authService.js";
import { renderLoginScreen } from "./pages/login.js";

// ===================== ROUTES =====================
registerRoute("home", renderHome);
registerRoute("tasks", renderTasks);
registerRoute("projects", renderProjects);
registerRoute("goals", renderGoals);
registerRoute("calendar", renderCalendar);
registerRoute("focus", renderFocus);
registerRoute("notes", renderNotes);
registerRoute("inbox", renderInbox);
registerRoute("insights", renderInsights);
registerRoute("assistant", renderAssistant);
registerRoute("settings", renderSettings);
registerRoute("recycleBin", renderRecycleBin);
registerRoute("more", renderMore);

// ===================== BOOT =====================
async function boot() {
  await seedIfNeeded();

  await updateUserChip();
  initRouter();
  initBellPanel();

  // Apply theme from settings
  const settings = await getSettings();
  applyTheme(settings.theme || "light");
  applyScreenVisibility(settings.screens || {});

  // Listen for system theme changes when using "system" mode
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", async () => {
    const s = await getSettings();
    if (s.theme === "system") applyTheme("system");
  });

  // Listen for screen visibility changes from settings page
  window.addEventListener("screens-changed", async () => {
    const s = await getSettings();
    applyScreenVisibility(s.screens || {});
  });

  // 15-day retention sweep
  recycleSvc.purgeExpired().catch((err) => console.warn("[recycle] purge failed", err));

  // Notifications scheduler
  notificationSvc.init().catch((err) => console.warn("[notifications] init failed", err));

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((err) =>
      console.warn("[pwa] service worker registration failed", err)
    );
    navigator.serviceWorker.addEventListener("message", (e) => {
      const { type, route } = e.data || {};
      if (type === "nexora:navigate" && route && window.location.hash !== route) {
        window.location.hash = route;
      }
    });
  }
}

async function updateUserChip() {
  const profile = await getProfile();
  if (!profile) return;
  const chip = document.getElementById("user-chip");
  if (!chip) return;
  const initial = (profile.name || "?").trim().charAt(0).toUpperCase();
  chip.querySelector(".avatar").textContent = initial;
  chip.querySelector(".user-chip-name").textContent = profile.name || "You";
  chip.querySelector(".user-chip-meta").textContent = profile.workspace || "My workspace";
}

function applyScreenVisibility(screens) {
  document.querySelectorAll(".sidebar-nav .nav-item").forEach((el) => {
    const route = el.dataset.route;
    if (route && route in screens) {
      el.style.display = screens[route] ? "" : "none";
    }
  });
  document.querySelectorAll(".sheet-grid .sheet-item").forEach((el) => {
    const href = el.getAttribute("href") || "";
    const route = href.replace("#/", "");
    if (route && route in screens) {
      el.style.display = screens[route] ? "" : "none";
    }
  });
}

// ===================== QUICK ADD MODAL =====================
const quickAddBackdrop = document.getElementById("quick-add-backdrop");
const quickAddInput = document.getElementById("quick-add-input");

function openQuickAdd() {
  quickAddBackdrop.classList.add("open");
  setTimeout(() => quickAddInput?.focus(), 30);
}
function closeQuickAdd() {
  quickAddBackdrop.classList.remove("open");
  quickAddInput.value = "";
}

document.getElementById("quick-add-btn")?.addEventListener("click", openQuickAdd);
document.getElementById("fab-add")?.addEventListener("click", openQuickAdd);

quickAddBackdrop.addEventListener("click", (e) => {
  if (e.target === quickAddBackdrop) closeQuickAdd();
});

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    openSearch();
  }
  if (e.key === "Escape") {
    closeQuickAdd();
    closeMoreSheet();
  }
});

// The topbar search field is a launcher for the full search overlay.
const globalSearch = document.getElementById("global-search");
function launchSearch(e) {
  e?.preventDefault();
  globalSearch?.blur();
  openSearch();
}
globalSearch?.addEventListener("click", launchSearch);
globalSearch?.addEventListener("focus", launchSearch);
globalSearch?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === "ArrowDown") launchSearch(e);
});

// Quick add captures straight into the Inbox
quickAddInput?.addEventListener("keydown", async (e) => {
  if (e.key === "Enter" && quickAddInput.value.trim()) {
    const content = quickAddInput.value.trim();
    closeQuickAdd();
    await addItem("text", content);
    toast("Captured to Inbox");
    updateInboxBadge();
    if (window.location.hash.startsWith("#/inbox")) rerender();
  }
});

async function updateInboxBadge() {
  const items = await db.getAll("inbox");
  const pending = items.filter((i) => !i.processed).length;
  const badge = document.getElementById("inbox-badge");
  if (!badge) return;
  badge.textContent = String(pending);
  badge.style.display = pending ? "" : "none";
}

// ===================== AUTH GUARD =====================
const authScreen = document.getElementById("auth-screen");
const appEl = document.getElementById("app");
let booted = false;

function showLogin() {
  authScreen.classList.add("active");
  appEl.style.display = "none";
  renderLoginScreen();
}

function showApp() {
  if (booted) return;
  booted = true;
  authScreen.classList.remove("active");
  authScreen.innerHTML = "";
  appEl.style.display = "";
  boot()
    .then(updateInboxBadge)
    .catch((err) => {
      console.error("[nexora] boot failed:", err);
      const root = document.getElementById("page-root");
      if (root) {
        root.innerHTML = `
          <div class="card error-card">
            <h3>TaskTrack couldn't start</h3>
            <p>${String(err?.message || err)}</p>
            <div style="display:flex; gap:10px; justify-content:center; margin-top:14px;">
              <button class="btn btn-primary btn-sm" onclick="location.reload()">Reload</button>
              <button class="btn btn-danger btn-sm" id="boot-reset-btn">Reset local data</button>
            </div>
          </div>
        `;
        root.querySelector("#boot-reset-btn")?.addEventListener("click", async () => {
          try {
            const names = await (await indexedDB.databases()).map((d) => d.name);
            for (const n of names) indexedDB.deleteDatabase(n);
          } catch {
            indexedDB.deleteDatabase("nexora-db");
            indexedDB.deleteDatabase("nexora");
          }
          if ("caches" in window) {
            const keys = await caches.keys();
            for (const k of keys) await caches.delete(k);
          }
          location.reload();
        });
      }
    });
}

// Show login immediately while Firebase resolves
showLogin();

// When Firebase auth state is known, switch view
onAuthChange((user) => {
  if (user) {
    showApp();
  } else {
    showLogin();
  }
});

// ===================== MOBILE "MORE" SHEET =====================
const moreSheetBackdrop = document.getElementById("more-sheet-backdrop");

function openMoreSheet() {
  moreSheetBackdrop.classList.add("open");
}
function closeMoreSheet() {
  moreSheetBackdrop.classList.remove("open");
}

document.querySelector('.bn-item[data-route="more"]')?.addEventListener("click", (e) => {
  e.preventDefault();
  openMoreSheet();
});

moreSheetBackdrop.addEventListener("click", (e) => {
  if (e.target === moreSheetBackdrop) closeMoreSheet();
});

moreSheetBackdrop.querySelectorAll("a").forEach((a) => {
  a.addEventListener("click", closeMoreSheet);
});

// ===================== MOBILE SIDEBAR MENU TOGGLE =====================
document.getElementById("menu-toggle")?.addEventListener("click", openMoreSheet);

export { updateUserChip };
