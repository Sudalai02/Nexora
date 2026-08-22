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
import { renderMore } from "./pages/more.js";
import { seedIfNeeded } from "./store/seed.js";
import * as db from "./store/db.js";
import { getProfile } from "./services/settingsService.js";
import { addItem } from "./services/inboxService.js";
import { toast } from "./ui/toast.js";

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
registerRoute("more", renderMore);

// ===================== BOOT =====================
async function boot() {
  await seedIfNeeded();
  await updateUserChip();
  initRouter();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((err) =>
      console.warn("[pwa] service worker registration failed", err)
    );
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
  chip.querySelector(".user-chip-meta").textContent = profile.workspace || "Personal workspace";
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
    openQuickAdd();
  }
  if (e.key === "Escape") {
    closeQuickAdd();
    closeMoreSheet();
  }
});

// Quick add captures straight into the Inbox — triage happens there.
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

boot()
  .then(updateInboxBadge)
  .catch((err) => {
    console.error("[nexora] boot failed:", err);
    const root = document.getElementById("page-root");
    if (root) {
      root.innerHTML = `
        <div class="card error-card">
          <h3>Nexora couldn't start</h3>
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
// (menu-toggle currently opens the "more" sheet on mobile as a simple pattern)
document.getElementById("menu-toggle")?.addEventListener("click", openMoreSheet);

export { updateUserChip };
