// ============================================================
// ANALYTICS — every number answers a real question.
// Range stats, per-day series, productive hours, habit consistency.
// ============================================================

import { todayISO, addDays } from "../utils/dates.js";
import * as db from "../store/db.js";

export async function rangeStats(days, offset = 0) {
  const today = todayISO();
  const end = addDays(today, -offset);
  const start = addDays(end, -(days - 1));

  const tasks = await db.getAll("tasks");
  const sessions = await db.getAll("focusSessions");
  const habits = await db.getAll("habits");

  // Tasks completed within the window
  const completedIn = tasks.filter(
    (t) => t.status === "Completed" && t.completedAt && t.completedAt.slice(0, 10) >= start && t.completedAt.slice(0, 10) <= end
  );

  // Completion rate: of tasks that were due inside the window, how many are done?
  const dueInWindow = tasks.filter((t) => t.dueDate && t.dueDate >= start && t.dueDate <= end);
  const doneOfDue = dueInWindow.filter(
    (t) => t.status === "Completed" || t.status === "Cancelled"
  );

  // Focus time
  let focusMinutes = 0;
  let deepMinutes = 0;
  let sessionCount = 0;
  const hourBuckets = new Array(24).fill(0); // minutes per start-hour
  for (const s of sessions) {
    if (s.type !== "focus") continue;
    const day = s.startedAt.slice(0, 10);
    if (day < start || day > end) continue;
    const mins = Math.round((s.durationSeconds || 0) / 60);
    focusMinutes += mins;
    sessionCount += 1;
    if ((s.plannedMinutes || 0) >= 45) deepMinutes += mins;
    const h = new Date(s.startedAt).getHours();
    hourBuckets[h] += mins;
  }

  // Avg task duration from actuals
  const withActual = completedIn.filter((t) => t.actualMinutes);
  const avgTaskMinutes = withActual.length
    ? Math.round(withActual.reduce((a, t) => a + t.actualMinutes, 0) / withActual.length)
    : null;

  // Per-day series
  const perDay = [];
  for (let d = days - 1; d >= 0; d--) {
    const iso = addDays(end, -d);
    const completed = completedIn.filter((t) => t.completedAt.slice(0, 10) === iso).length;
    const focusMin = sessions
      .filter((s) => s.type === "focus" && s.startedAt.slice(0, 10) === iso)
      .reduce((a, s) => a + Math.round((s.durationSeconds || 0) / 60), 0);
    perDay.push({ date: iso, completed, focusMin });
  }

  return {
    days,
    start,
    end,
    tasksCompleted: completedIn.length,
    completionRate: dueInWindow.length ? Math.round((doneOfDue.length / dueInWindow.length) * 100) : null,
    focusMinutes,
    deepMinutes,
    sessionCount,
    avgTaskMinutes,
    perDay,
    hourBuckets,
    habits,
  };
}

// Best working windows — returns top consecutive 3h window label + data
export function bestWindow(hourBuckets) {
  let bestStart = 8;
  let bestSum = -1;
  for (let h = 5; h <= 20; h++) {
    const sum = hourBuckets[h] + hourBuckets[h + 1] + hourBuckets[h + 2];
    if (sum > bestSum) {
      bestSum = sum;
      bestStart = h;
    }
  }
  return { startHour: bestStart, totalMinutes: Math.max(0, bestSum) };
}

export async function habitConsistency(days = 30) {
  const habits = (await db.getAll("habits")).filter((h) => !h.archived);
  const logs = await db.getAll("habitLogs");
  const doneSet = new Set(logs.filter((l) => l.done).map((l) => l.id));
  const today = todayISO();

  const perHabit = habits.map((h) => {
    let scheduled = 0,
      done = 0;
    for (let d = 1; d <= days; d++) {
      const date = new Date(`${today}T00:00:00`);
      date.setDate(date.getDate() - d);
      const wd = date.getDay();
      if (!(h.weekdays || []).includes(wd)) continue;
      scheduled += 1;
      if (doneSet.has(`${h.id}:${date.toISOString().slice(0, 10)}`)) done += 1;
    }
    return { habit: h, scheduled, done, pct: scheduled ? Math.round((done / scheduled) * 100) : null };
  });

  return perHabit.filter((x) => x.scheduled > 0);
}

