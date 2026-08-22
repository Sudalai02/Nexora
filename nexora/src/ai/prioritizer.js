// ============================================================
// PRIORITY ENGINE
// Combines stored priority + deadline pressure + status into a
// single 0-100 score used for sorting and "What should I do now".
// ============================================================

import { todayISO, diffDays } from "../utils/dates.js";

const PRIORITY_BASE = { Urgent: 40, High: 30, Medium: 18, Low: 8 };

export function computeScore(task) {
  if (task.status === "Completed" || task.status === "Cancelled") return 0;
  let score = PRIORITY_BASE[task.priority] ?? 15;

  if (task.dueDate) {
    const d = diffDays(todayISO(), task.dueDate);
    if (d < 0) score += 35;
    else if (d === 0) score += 30;
    else if (d === 1) score += 22;
    else if (d <= 3) score += 15;
    else if (d <= 7) score += 8;
  }

  if (task.status === "In Progress") score += 6;
  return Math.min(100, Math.round(score));
}

// Visual tier — keeps the existing dot/badge language of the UI.
export function tierOf(task) {
  const s = computeScore(task);
  if (s >= 65) return "now";
  if (s >= 45) return "next";
  if (s >= 25) return "later";
  return "defer";
}

export function reasonsFor(task, projectName) {
  const reasons = [];
  const base = PRIORITY_BASE[task.priority] ?? 15;
  if (task.priority === "Urgent") reasons.push("Marked urgent — highest impact class");
  if (task.priority === "High") reasons.push("High-priority work");

  if (task.dueDate) {
    const d = diffDays(todayISO(), task.dueDate);
    if (d < 0) reasons.push(`Overdue by ${Math.abs(d)} day${Math.abs(d) === 1 ? "" : "s"}`);
    else if (d === 0) reasons.push("Due today");
    else if (d === 1) reasons.push("Deadline approaching tomorrow");
  }

  if (task.status === "In Progress") reasons.push("Already in progress — finishing beats switching");
  if ((task.estimatedMinutes || 0) <= 30) reasons.push("Short task — quick win");
  if (projectName) reasons.push(`Part of active project “${projectName}”`);
  return reasons.slice(0, 4);
}
