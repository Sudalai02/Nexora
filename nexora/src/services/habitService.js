import * as db from "../store/db.js";
import { uid } from "../utils/id.js";
import { todayISO, weekdayOf, fromISO } from "../utils/dates.js";

const WD_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export async function allHabits() {
  const habits = await db.getAll("habits");
  return habits.filter((h) => !h.archived);
}

export async function createHabit(data) {
  const habit = {
    id: uid("h"),
    title: data.title.trim(),
    timeOfDay: data.timeOfDay || "08:00",
    durationMinutes: Number(data.durationMinutes) || 30,
    weekdays: (data.weekdays && data.weekdays.length ? data.weekdays : [1, 2, 3, 4, 5]).slice().sort(),
    color: data.color || "#3D5A80",
    archived: false,
    createdAt: new Date().toISOString(),
  };
  await db.put("habits", habit);
  return habit;
}

export async function updateHabit(id, patch) {
  const h = await db.get("habits", id);
  if (!h) throw new Error(`Habit ${id} not found`);
  return db.put("habits", { ...h, ...patch });
}

export async function removeHabit(id) {
  const logs = await db.getAll("habitLogs");
  await Promise.all(logs.filter((l) => l.habitId === id).map((l) => db.del("habitLogs", l.id)));
  return db.del("habits", id);
}

export function weekdayLabel(wd) {
  return WD_NAMES[wd];
}

// ---------- Logs ----------
export async function logsForDate(iso) {
  const logs = await db.getAll("habitLogs");
  return new Set(logs.filter((l) => l.date === iso && l.done).map((l) => l.habitId));
}

export function scheduledOn(habit, iso) {
  return (habit.weekdays || []).includes(weekdayOf(iso));
}

export async function toggleLog(habitId, iso = todayISO()) {
  const id = `${habitId}:${iso}`;
  const existing = await db.get("habitLogs", id);
  if (existing?.done) {
    await db.del("habitLogs", id);
    return false;
  }
  await db.put("habitLogs", { id, habitId, date: iso, done: true });
  return true;
}

export async function isDone(habitId, iso = todayISO()) {
  const row = await db.get("habitLogs", `${habitId}:${iso}`);
  return Boolean(row?.done);
}

// Current streak: consecutive *scheduled* days completed, walking back
// from today (today counts only if already done).
export async function streak(habit) {
  let count = 0;
  for (let d = 0; d < 365; d++) {
    const iso = addDaysISO(d === 0 ? todayISO() : undefined, -d);
    if (!scheduledOn(habit, iso)) continue;
    if (await isDone(habit.id, iso)) {
      count += 1;
    } else {
      break;
    }
  }
  return count;
}

function addDaysISO(baseIso, days) {
  const d = baseIso ? fromISO(baseIso) : new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// done/scheduled ratio over the last N days
export async function consistency(habits, days = 30) {
  const logs = await db.getAll("habitLogs");
  const doneSet = new Set(logs.filter((l) => l.done).map((l) => l.id));
  const perHabit = {};
  for (const h of habits) {
    let sched = 0,
      done = 0;
    for (let d = 1; d <= days; d++) {
      const iso = addDaysISO(undefined, -d);
      if (!scheduledOn(h, iso)) continue;
      sched += 1;
      if (doneSet.has(`${h.id}:${iso}`)) done += 1;
    }
    perHabit[h.id] = { scheduled: sched, done, pct: sched ? Math.round((done / sched) * 100) : null };
  }
  return perHabit;
}
