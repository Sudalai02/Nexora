import * as db from "../store/db.js";
import { uid } from "../utils/id.js";

export async function allGoals() {
  return db.getAll("goals");
}

export async function createGoal(data) {
  const goal = {
    id: uid("g"),
    title: data.title.trim(),
    description: data.description || "",
    category: data.category || "Personal",
    priority: data.priority || "Medium",
    status: "Active",
    startDate: data.startDate || new Date().toISOString().slice(0, 10),
    targetDate: data.targetDate || null,
    milestones: [],
    createdAt: new Date().toISOString(),
  };
  await db.put("goals", goal);
  return goal;
}

export async function updateGoal(id, patch) {
  const goal = await db.get("goals", id);
  if (!goal) throw new Error(`Goal ${id} not found`);
  const next = { ...goal, ...patch };
  await db.put("goals", next);
  return next;
}

export async function removeGoal(id) {
  const projects = await db.getAll("projects");
  await Promise.all(
    projects.filter((p) => p.goalId === id).map((p) => db.put("projects", { ...p, goalId: null }))
  );
  return db.del("goals", id);
}

// Progress = milestone completion ratio blended with linked-project
// task progress when projects exist (real-world growth signal).
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
    const msTotal = g.milestones?.length || 0;
    const msDone = (g.milestones || []).filter((m) => m.done).length;
    const linked = projects.filter((p) => p.goalId === g.id);

    let taskPct = null;
    if (linked.length) {
      let done = 0,
        total = 0;
      for (const p of linked) {
        done += projProg[p.id].done;
        total += projProg[p.id].total;
      }
      if (total > 0) taskPct = Math.round((done / total) * 100);
    }

    let pct = null;
    if (msTotal && taskPct !== null) pct = Math.round(msDone * 0.4 + taskPct * 0.6);
    else if (msTotal) pct = Math.round((msDone / msTotal) * 100);
    else if (taskPct !== null) pct = taskPct;

    map[g.id] = { pct, msDone, msTotal, taskPct };
  }
  return map;
}
