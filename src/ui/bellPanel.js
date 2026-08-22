// ============================================================
// BELL PANEL — the in-app notification center.
//
// Anchored under the topbar bell. Lists real alerts produced by
// notificationService (morning briefing, task times, overdue,
// events, habits, goal deadlines, evening review). Clicking an
// alert jumps to its route. Includes an "Enable notifications"
// CTA when browser permission hasn't been granted yet.
// ============================================================

import { icon } from "../dom.js";
import * as notif from "../services/notificationService.js";

let panel = null;
let isOpen = false;

function ago(iso) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const TYPE_ICON = {
  briefing: "home",
  task: "tasks",
  deadline: "alert",
  event: "calendar",
  habit: "check",
  goal: "flag",
  review: "spark",
};

export async function updateBellBadge() {
  const btn = document.getElementById("notif-btn");
  if (!btn) return;
  const n = await notif.unreadCount();
  const dot = btn.querySelector(".dot");
  if (!dot) return;
  dot.style.display = n ? "" : "none";
}

function itemHTML(a) {
  return `
    <button class="bell-item ${a.read ? "" : "unread"}" data-route="${a.route || ""}" data-alert="${a.id}">
      <span class="bell-item-icon">${icon(TYPE_ICON[a.type] || "alert")}</span>
      <span class="bell-item-body">
        <span class="bell-item-title">${a.title}</span>
        ${a.body ? `<span class="bell-item-text">${a.body}</span>` : ""}
        <span class="bell-item-ago">${ago(a.createdAt)}</span>
      </span>
      ${a.read ? "" : '<span class="bell-unread-dot"></span>'}
    </button>
  `;
}

async function renderPanel() {
  if (!panel) return;
  const [alerts, unread] = await Promise.all([notif.allAlerts(30), notif.unreadCount()]);
  const perm = notif.permissionState();

  panel.innerHTML = `
    <div class="bell-head">
      <div>
        <strong>Notifications</strong>
        <span class="bell-count">${unread ? `${unread} new` : "All caught up"}</span>
      </div>
      <div class="bell-head-actions">
        ${alerts.length ? `<button class="btn btn-ghost btn-sm" id="bell-markread">Mark read</button>
        <button class="btn btn-ghost btn-sm" id="bell-clear">Clear</button>` : ""}
      </div>
    </div>
    ${
      perm === "default"
        ? `<div class="bell-perm">
             <div>Turn on desktop notifications so nothing slips while you're in another tab.</div>
             <button class="btn btn-primary btn-sm" id="bell-enable">Enable notifications</button>
           </div>`
        : ""
    }
    <div class="bell-list">
      ${
        alerts.length
          ? alerts.map(itemHTML).join("")
          : `<div class="bell-empty">Quiet for now.<br /><small>Briefings, reminders and deadline alerts will land here.</small></div>`
      }
    </div>
    <a class="bell-foot" href="#/settings">Notification settings</a>
  `;

  panel.querySelector("#bell-markread")?.addEventListener("click", () => notif.markAllRead());
  panel.querySelector("#bell-clear")?.addEventListener("click", () => notif.clearAlerts());

  panel.querySelector("#bell-enable")?.addEventListener("click", async () => {
    const res = await notif.requestPermission();
    if (res === "granted") {
      await notif.runCheck(); // fire anything already due right now
      renderPanel();
    } else {
      renderPanel();
    }
  });

  panel.querySelectorAll(".bell-item").forEach((item) =>
    item.addEventListener("click", () => {
      notif.markAllRead();
      closeBell();
      const route = item.dataset.route;
      if (route) window.location.hash = route;
    })
  );
}

export function closeBell() {
  if (!panel || !isOpen) return;
  isOpen = false;
  panel.classList.remove("open");
}

export function initBellPanel() {
  const btn = document.getElementById("notif-btn");
  if (!btn || panel) return;

  panel = document.createElement("div");
  panel.className = "bell-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Notifications");
  document.body.appendChild(panel);

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    isOpen ? closeBell() : openBell();
  });

  // click-outside + Esc
  document.addEventListener("click", (e) => {
    if (isOpen && !panel.contains(e.target) && !btn.contains(e.target)) closeBell();
  });
  document.addEventListener("keydown", (e) => e.key === "Escape" && closeBell());

  // live updates from the notification service
  document.addEventListener("nexora:alerts-changed", () => {
    updateBellBadge();
    if (isOpen) renderPanel();
  });

  updateBellBadge();
}

export async function openBell() {
  if (!panel) return;
  isOpen = true;
  panel.classList.add("open");
  await renderPanel();
  position();
}

function position() {
  if (!panel || !isOpen) return;
  const btn = document.getElementById("notif-btn");
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  const width = Math.min(380, window.innerWidth - 24);
  panel.style.width = `${width}px`;
  panel.style.top = `${r.bottom + 10}px`;
  panel.style.right = `${Math.max(12, window.innerWidth - r.right)}px`;
}

window.addEventListener("resize", () => isOpen && position());
