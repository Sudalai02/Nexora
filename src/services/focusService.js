import * as db from "../store/db.js";
import { uid } from "../utils/id.js";
import { emit } from "../utils/bus.js";
import { todayISO, startOfWeekISO } from "../utils/dates.js";
import * as recycle from "./recycleService.js";

export async function allSessions() {
  const sessions = await db.getAll("focusSessions");
  return sessions.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

export async function saveSession(session) {
  const record = { id: uid("fs"), ...session };
  await db.put("focusSessions", record);
  emit("data-changed", { entity: "focusSessions" });
  return record;
}

export async function updateSession(id, patch) {
  const s = await db.get("focusSessions", id);
  if (!s) throw new Error(`Session ${id} not found`);
  return db.put("focusSessions", { ...s, ...patch });
}

export async function removeSession(id) {
  const entry = await recycle.softDelete("focusSessions", id);
  emit("data-changed", { entity: "focusSessions" });
  return entry;
}

export function minutesInRange(sessions, startISO, endISO) {
  let focus = 0;
  let deep = 0;
  for (const s of sessions) {
    if (s.type !== "focus") continue;
    const day = s.startedAt.slice(0, 10);
    if (day >= startISO && day <= endISO) {
      focus += Math.round((s.durationSeconds || 0) / 60);
      if ((s.plannedMinutes || 0) >= 45) deep += Math.round((s.durationSeconds || 0) / 60);
    }
  }
  return { focus, deep };
}

// Headline stats for the Focus screen cards: today, this week, sessions.
export async function quickStats() {
  const today = todayISO();
  const weekStart = startOfWeekISO(today);
  let todayMin = 0;
  let weekMin = 0;
  let weekSessions = 0;
  let todaySessions = 0;
  for (const s of await db.getAll("focusSessions")) {
    if (s.type !== "focus") continue;
    const day = (s.startedAt || "").slice(0, 10);
    if (day === today) {
      todayMin += Math.round((s.durationSeconds || 0) / 60);
      todaySessions += 1;
    }
    if (day >= weekStart && day <= today) {
      weekMin += Math.round((s.durationSeconds || 0) / 60);
      weekSessions += 1;
    }
  }
  return { todayMin, weekMin, todaySessions, weekSessions };
}
