// ============================================================
// NOTIFICATION SERVICE — real alerts for tasks, deadlines,
// events, habits and daily reviews.
//
// Two channels:
//   In-app alert center (bell icon) — always works.
//   Native browser notifications (desktop + mobile via the
//     service worker) — used whenever the user granted permission.
//
// A 30s scheduler inspects live data and fires each alert exactly
// once per day using a localStorage ledger, so nothing repeats and
// nothing is missed while the tab stays open. On load it also does
// a catch-up pass for anything that came due earlier today.
// ============================================================

import * as db from "../store/db.js";
import { uid } from "../utils/id.js";
import { todayISO, addDays, weekdayOf } from "../utils/dates.js";
import { getSettings } from "./settingsService.js";

const LEDGER_KEY = "nexora-fired-alerts";
const CHECK_INTERVAL_MS = 30_000;

// ---------- alert store (in-app center) ----------

export async function pushAlert({ type, title, body, route }) {
  const alert = {
    id: uid("al"),
    type,
    title,
    body,
    route: route || null,
    createdAt: new Date().toISOString(),
    read: false,
    native: false,
  };
  await db.put("alerts", alert);
  document.dispatchEvent(new CustomEvent("nexora:alerts-changed"));
  return alert;
}

export async function allAlerts(limit = 40) {
  const alerts = await db.getAll("alerts");
  return alerts.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit);
}

export async function unreadCount() {
  const alerts = await db.getAll("alerts");
  return alerts.filter((a) => !a.read).length;
}

export async function markAllRead() {
  const alerts = await db.getAll("alerts");
  await Promise.all(alerts.filter((a) => !a.read).map((a) => db.put("alerts", { ...a, read: true })));
  document.dispatchEvent(new CustomEvent("nexora:alerts-changed"));
}

export async function clearAlerts() {
  await db.clear("alerts");
  document.dispatchEvent(new CustomEvent("nexora:alerts-changed"));
}

// Swipe-to-clear support: remove a single alert by id.
export async function removeAlert(id) {
  await db.del("alerts", id);
  document.dispatchEvent(new CustomEvent("nexora:alerts-changed"));
}

export async function markRead(id) {
  const alert = await db.get("alerts", id);
  if (alert && !alert.read) {
    await db.put("alerts", { ...alert, read: true });
    document.dispatchEvent(new CustomEvent("nexora:alerts-changed"));
  }
}

// ---------- permission ----------

export function permissionState() {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export async function requestPermission() {
  if (!("Notification" in window)) return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export async function showNative(title, body, route = null) {
  if (permissionState() !== "granted") return;
  try {
    let swReg = null;
    if ("serviceWorker" in navigator) {
      swReg = await navigator.serviceWorker.getRegistration();
    }
    if (swReg?.showNotification) {
      await swReg.showNotification(title, {
        body,
        icon: "icons/icon.svg",
        badge: "icons/icon.svg",
        tag: `nexora-${Date.now()}`,
        data: { route },
      });
    } else {
      const n = new Notification(title, { body, icon: "icons/icon.svg", tag: `nexora-${Date.now()}` });
      n.onclick = () => {
        window.focus();
        if (route) window.location.hash = route;
        n.close();
      };
    }
  } catch (err) {
    console.warn("[notifications] native show failed", err);
  }
}

// ---------- fired-once ledger ----------

function ledger() {
  try {
    return JSON.parse(localStorage.getItem(LEDGER_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveLedger(l) {
  try {
    localStorage.setItem(LEDGER_KEY, JSON.stringify(l));
  } catch {
    /* private mode */
  }
}

function alreadyFired(key) {
  const l = ledger();
  return l.day === todayISO() && Array.isArray(l.keys) && l.keys.includes(key);
}

function markFired(key) {
  const l = ledger();
  const day = todayISO();
  const keys = l.day === day ? [...(l.keys || []), key] : [key];
  saveLedger({ day, keys });
}

// ---------- data gathering ----------

function minutesOf(hhmm) {
  const [h, m] = String(hhmm || "0:0").split(":").map(Number);
  return h * 60 + (m || 0);
}

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

async function gather() {
  const [tasksRaw, events, habits, logsToday] = await Promise.all([
    db.getAll("tasks"),
    db.getAll("events"),
    db.getAll("habits"),
    db.getAll("habitLogs"),
  ]);
  const doneSet = new Set(logsToday.filter((l) => l.done && l.date === todayISO()).map((l) => l.habitId));
  const today = todayISO();
  return {
    today,
    nowMin: nowMinutes(),
    openTasks: tasksRaw.filter((t) => !["Completed", "Cancelled"].includes(t.status)),
    eventsToday: events
      .filter((e) => e.date === today)
      .sort((a, b) => a.startHour - b.startHour),
    habitsDue: habits.filter(
      (h) => !h.archived && (h.weekdays || []).includes(weekdayOf(today)) && !doneSet.has(h.id)
    ),
    goalsAtRisk: (await db.getAll("goals")).filter(
      (g) =>
        g.status !== "Completed" &&
        g.targetDate &&
        g.targetDate >= today &&
        g.targetDate <= addDays(today, 3)
    ),
  };
}

// ---------- the scheduler core ----------

let timerHandle = null;

export async function init() {
  if (timerHandle) return;
  await runCheck();
  timerHandle = setInterval(runCheck, CHECK_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") runCheck();
  });
}

export async function runCheck() {
  let settings;
  try {
    settings = await getSettings();
  } catch {
    return;
  }
  const n = settings.notifications || {};
  const wantNative = permissionState() === "granted";
  const d = await gather();

  const fire = async (key, opts) => {
    if (alreadyFired(key)) return;
    markFired(key);
    await pushAlert(opts);
    if (wantNative && opts.native !== false) {
      await showNative(opts.title, opts.body, opts.route);
    }
  };

  // ---- morning briefing ----
  if (n.morning !== false && d.nowMin >= 6 * 60) {
    const tasksToday = d.openTasks.filter(
      (t) => t.dueDate === d.today || (t.dueDate && t.dueDate < d.today)
    ).length;
    if (tasksToday > 0 || d.eventsToday.length > 0) {
      await fire(`morning-${d.today}`, {
        type: "briefing",
        title: "Good morning",
        body: `${tasksToday} task${tasksToday === 1 ? "" : "s"} to handle${
          d.eventsToday.length ? `, ${d.eventsToday.length} event${d.eventsToday.length === 1 ? "" : "s"} today` : ""
        }.`,
        route: "#/home",
      });
    }
  }

  // ---- task start times (gated by deadline toggle) ----
  if (n.deadline !== false) {
    for (const t of d.openTasks) {
      if (t.dueDate === d.today && t.startTime) {
        const m = minutesOf(t.startTime);
        if (d.nowMin >= m && d.nowMin < m + 60) {
          await fire(`task-time-${t.id}-${d.today}`, {
            type: "task",
            title: "Task starts now",
            body: `${t.title}${t.endTime ? ` (until ${t.endTime})` : ""}`,
            route: "#/tasks",
          });
        }
      }
    }

    // ---- overdue tasks (batched into a single alert) ----
    const overdueTasks = d.openTasks.filter((t) => t.dueDate && t.dueDate < d.today);
    if (overdueTasks.length) {
      const key = `overdue-batch-${d.today}`;
      if (!alreadyFired(key)) {
        markFired(key);
        const count = overdueTasks.length;
        const body = count === 1
          ? `${overdueTasks[0].title} is overdue.`
          : `${count} tasks are overdue.`;
        await pushAlert({ type: "deadline", title: "Overdue tasks", body, route: "#/tasks" });
        if (wantNative) await showNative("Overdue tasks", body, "#/tasks");
      }
    }

    // ---- tasks due tomorrow (batched into a single alert) ----
    const tomorrow = addDays(d.today, 1);
    const tmrwTasks = d.openTasks.filter((t) => t.dueDate === tomorrow);
    if (tmrwTasks.length) {
      const key = `duetmrw-batch-${d.today}`;
      if (!alreadyFired(key)) {
        markFired(key);
        const count = tmrwTasks.length;
        const body = count === 1
          ? `${tmrwTasks[0].title} is due tomorrow.`
          : `${count} tasks are due tomorrow.`;
        await pushAlert({ type: "deadline", title: "Deadline tomorrow", body, route: "#/tasks" });
        if (wantNative) await showNative("Deadline tomorrow", body, "#/tasks");
      }
    }
  }

  // ---- events: reminder 15 min before + start ----
  for (const e of d.eventsToday) {
    const startMin = Math.round(e.startHour * 60);
    if (d.nowMin >= startMin - 15 && d.nowMin < startMin) {
      await fire(`event-soon-${e.id}-${d.today}`, {
        type: "event",
        title: "Upcoming event",
        body: `${e.title} starts at ${fmtClock(e.startHour)}.`,
        route: "#/calendar",
      });
    } else if (d.nowMin >= startMin && d.nowMin < startMin + 30) {
      await fire(`event-now-${e.id}-${d.today}`, {
        type: "event",
        title: "Event starting",
        body: `${e.title} is starting now.`,
        route: "#/calendar",
      });
    }
  }

  // ---- habits at their scheduled time ----
  for (const h of d.habitsDue) {
    const m = minutesOf(h.timeOfDay);
    if (n.habit !== false && d.nowMin >= m && d.nowMin < m + 90) {
      await fire(`habit-${h.id}-${d.today}`, {
        type: "habit",
        title: "Habit reminder",
        body: `Time for "${h.title}" (${h.durationMinutes} min).`,
        route: "#/goals",
      });
    }
  }

  // ---- goals nearing target date (gated by risk toggle) ----
  if (n.risk !== false) {
    const tomorrow = addDays(d.today, 1);
    for (const g of d.goalsAtRisk) {
      if (g.targetDate === d.today || g.targetDate === tomorrow || g.targetDate === addDays(d.today, 2)) {
        await fire(`goal-risk-${g.id}-${g.targetDate}`, {
          type: "goal",
          title: "Goal deadline close",
          body: `"${g.title}" targets ${g.targetDate}.`,
          route: "#/goals",
        });
      }
    }
  }

  // ---- evening review ----
  if (n.evening !== false && d.nowMin >= 20 * 60) {
    const completedToday = (await db.getAll("tasks")).filter(
      (t) => t.completedAt && t.completedAt.slice(0, 10) === d.today
    ).length;
    await fire(`evening-${d.today}`, {
      type: "review",
      title: "Evening review ready",
      body: `You completed ${completedToday} task${completedToday === 1 ? "" : "s"} today. Wrap up and plan tomorrow.`,
      route: "#/assistant",
    });
  }
}

function fmtClock(hourFloat) {
  const h = Math.floor(hourFloat);
  const m = Math.round((hourFloat - h) * 60);
  const ampm = h >= 12 ? "PM" : "AM";
  const disp = h % 12 === 0 ? 12 : h % 12;
  return `${disp}:${String(m).padStart(2, "0")} ${ampm}`;
}
