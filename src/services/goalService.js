import * as db from "../store/db.js";
import { uid } from "../utils/id.js";
import * as recycle from "./recycleService.js";
import { emit } from "../utils/bus.js";

export const GOAL_STATUSES = ["Active", "In Progress", "Completed", "On Hold"];

// Normalize any legacy statuses ("Paused") into the current set.
function normalizeStatus(status) {
  if (status === "Paused" || status === "OnHold") return "On Hold";
  return GOAL_STATUSES.includes(status) ? status : "Active";
}

export async function allGoals() {
  const goals = await db.getAll("goals");
  return goals.map((g) => ({ ...g, status: normalizeStatus(g.status) }));
}

export async function createGoal(data) {
  const goal = {
    id: uid("g"),
    title: data.title.trim(),
    description: data.description || "",
    category: data.category || "Personal",
    priority: data.priority || "Medium",
    status: normalizeStatus(data.status) || "Active",
    startDate: data.startDate || new Date().toISOString().slice(0, 10),
    targetDate: data.targetDate || null,
    milestones: [],
    createdAt: new Date().toISOString(),
  };
  await db.put("goals", goal);
  emit("data-changed", { entity: "goals" });
  return goal;
}

export async function updateGoal(id, patch) {
  const goal = await db.get("goals", id);
  if (!goal) throw new Error(`Goal ${id} not found`);
  const next = { ...goal, ...patch };
  await db.put("goals", next);
  emit("data-changed", { entity: "goals" });
  return next;
}

export async function removeGoal(id) {
  // Projects & tasks keep their goalId — restoring the goal
  // restores every relationship untouched.
  const entry = await recycle.softDelete("goals", id);
  emit("data-changed", { entity: "goals" });
  return entry;
}

// Progress = driven purely by linked work.
// "Linked work" covers BOTH projects assigned to the goal AND tasks
// linked directly to it, so completing/reopening a task instantly
// moves the percentage up or down.
export async function progressMap(goals, projects, tasks) {
  const doneSet = ["Completed", "Cancelled"];
  const projProg = {};
  for (const p of projects) projProg[p.id] = { done: 0, total: 0 };
  for (const t of tasks) {
    if (t.projectId && projProg[t.projectId]) {
      projProg[t.projectId].total += 1;
      if (doneSet.includes(t.status)) projProg[t.projectId].done += 1;
    }
  }

  const map = {};
  for (const g of goals) {
    const status = normalizeStatus(g.status);
    const linked = projects.filter((p) => p.goalId === g.id);
    const directTasks = tasks.filter((t) => t.goalId === g.id);

    let done = 0,
      total = 0;
    for (const p of linked) {
      done += projProg[p.id].done;
      total += projProg[p.id].total;
    }
    for (const t of directTasks) {
      total += 1;
      if (doneSet.includes(t.status)) done += 1;
    }
    const pct = total > 0 ? Math.round((done / total) * 100) : null;

    map[g.id] = {
      pct: status === "Completed" ? 100 : pct,
      taskPct: pct,
      taskDone: done,
      taskTotal: total,
    };
  }
  return map;
}
