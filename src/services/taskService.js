import * as db from "../store/db.js";
import { uid } from "../utils/id.js";
import { computeScore, tierOf } from "../ai/prioritizer.js";
import * as recycle from "./recycleService.js";

const OPEN = ["Todo", "In Progress", "Blocked"];

export async function allTasks() {
  return db.getAll("tasks");
}

export async function getTask(id) {
  return db.get("tasks", id);
}

export function decorate(tasks) {
  // adds computed fields without mutating the store
  return tasks.map((t) => ({ ...t, _score: computeScore(t), _tier: tierOf(t) }));
}

export async function openTasks() {
  const decorated = decorate(await allTasks());
  return decorated.filter((t) => OPEN.includes(t.status)).sort((a, b) => b._score - a._score);
}

export async function createTask(data) {
  const now = new Date().toISOString();
  const task = {
    id: uid("t"),
    title: data.title.trim(),
    description: data.description || "",
    projectId: data.projectId || null,
    goalId: data.goalId || null,
    status: data.status || "Todo",
    priority: data.priority || "Medium",
    estimatedMinutes: Number(data.estimatedMinutes) || 30,
    actualMinutes: null,
    dueDate: data.dueDate || null,
    startTime: data.startTime || null,
    endTime: data.endTime || null,
    tags: [],
    energy: "Medium",
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
  await db.put("tasks", task);
  return task;
}

export async function updateTask(id, patch) {
  const task = await db.get("tasks", id);
  if (!task) throw new Error(`Task ${id} not found`);
  const next = { ...task, ...patch, updatedAt: new Date().toISOString() };
  if (patch.status === "Completed" && !task.completedAt) {
    next.completedAt = new Date().toISOString();
    next.actualMinutes = next.actualMinutes ?? next.estimatedMinutes;
  }
  if (patch.status && patch.status !== "Completed") next.completedAt = null;
  await db.put("tasks", next);
  return next;
}

export async function removeTask(id) {
  return recycle.softDelete("tasks", id);
}

export async function toggleComplete(id) {
  const task = await db.get("tasks", id);
  if (!task) return null;
  return updateTask(id, {
    status: task.status === "Completed" ? "Todo" : "Completed",
  });
}
