import * as db from "../store/db.js";
import { uid } from "../utils/id.js";
import * as recycle from "./recycleService.js";

export async function allSessions() {
  const sessions = await db.getAll("focusSessions");
  return sessions.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

export async function saveSession(session) {
  const record = { id: uid("fs"), ...session };
  await db.put("focusSessions", record);
  return record;
}

export async function updateSession(id, patch) {
  const s = await db.get("focusSessions", id);
  if (!s) throw new Error(`Session ${id} not found`);
  return db.put("focusSessions", { ...s, ...patch });
}

export async function removeSession(id) {
  return recycle.softDelete("focusSessions", id);
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
