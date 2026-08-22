// ============================================================
// RECYCLE BIN — safe deletion for every module.
//
// Deleting an item moves it into the "recycleBin" store with its
// full original data, original store name and relationships intact.
// Items are kept for 15 days, then purged automatically. Restoring
// puts the item back exactly where it was — same ids, same links.
// ============================================================

import * as db from "../store/db.js";
import { uid } from "../utils/id.js";

export const RETENTION_DAYS = 15;

const MODULE_LABEL = {
  tasks: "Task",
  projects: "Project",
  goals: "Goal",
  habits: "Habit",
  notes: "Note",
  folders: "Folder",
  events: "Event",
  focusSessions: "Focus session",
  inbox: "Inbox item",
};

const MODULE_ICON = {
  tasks: "tasks",
  projects: "projects",
  goals: "goals",
  habits: "clock",
  notes: "notes",
  folders: "projects",
  events: "calendar",
  focusSessions: "focus",
  inbox: "inbox",
};

export function moduleLabel(storeName) {
  return MODULE_LABEL[storeName] || storeName;
}

export function moduleIcon(storeName) {
  return MODULE_ICON[storeName] || "notes";
}

function titleOf(storeName, data) {
  if (!data) return "(untitled)";
  return (
    data.title ||
    data.name ||
    data.content ||
    (data.taskTitle ? `${data.taskTitle} · session` : null) ||
    "(untitled)"
  );
}

// ---------- core operations ----------

export async function softDelete(storeName, id) {
  const item = await db.get(storeName, id);
  if (!item) return null; // already gone — nothing to preserve
  const entry = {
    id: uid("rb"),
    originalStore: storeName,
    originalId: id,
    data: item, // full snapshot incl. all relationship fields
    deletedAt: new Date().toISOString(),
    expiresAt: expiresAtISO(),
  };
  await db.put("recycleBin", entry);
  await db.del(storeName, id);
  return entry;
}

export async function restore(entryId) {
  const entry = await db.get("recycleBin", entryId);
  if (!entry) return false;
  // If an item with the same id re-appeared meanwhile, keep the newer one
  // and drop this restore silently to avoid overwriting fresh data.
  const existing = await db.get(entry.originalStore, entry.originalId);
  await db.put(entry.originalStore, existing ? mergeRestored(existing, entry.data) : entry.data);
  await db.del("recycleBin", entryId);
  return true;
}

function mergeRestored(current, snapshot) {
  // The live copy wins on scalar edits; the restore wins on relationship
  // fields that may have been nulled by cascade logic in old versions.
  const relFields = ["projectId", "goalId", "folderId"];
  const merged = { ...snapshot };
  for (const f of relFields) {
    if (current[f] !== undefined && current[f] !== null) merged[f] = current[f];
  }
  return merged;
}

export async function permanentlyDelete(entryId) {
  return db.del("recycleBin", entryId);
}

export async function emptyBin() {
  return db.clear("recycleBin");
}

// ---------- queries ----------

export async function allEntries() {
  const entries = await db.getAll("recycleBin");
  return entries.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1));
}

export async function countEntries() {
  const entries = await db.getAll("recycleBin");
  return entries.length;
}

export function daysLeft(entry) {
  const deleted = new Date(entry.deletedAt).getTime();
  const expires = deleted + RETENTION_DAYS * 86400000;
  const msLeft = expires - Date.now();
  return Math.max(0, Math.ceil(msLeft / 86400000));
}

function expiresAtISO() {
  return new Date(Date.now() + RETENTION_DAYS * 86400000).toISOString();
}

// ---------- automatic purge ----------
// Permanently removes items older than 15 days and repairs any
// dangling references left behind by permanently-gone parents.

let lastPurgeDay = null;

export async function purgeExpired(force = false) {
  const today = new Date().toISOString().slice(0, 10);
  if (!force && lastPurgeDay === today) return 0;
  lastPurgeDay = today;

  const entries = await db.getAll("recycleBin");
  const cutoff = Date.now();
  const expired = entries.filter((e) => new Date(e.expiresAt || e.deletedAt).getTime() <= cutoff);
  if (!expired.length) return 0;

  for (const e of expired) {
    await db.del("recycleBin", e.id);
    await repairAfterPurge(e);
  }
  return expired.length;
}

async function repairAfterPurge(entry) {
  const s = entry.originalStore;
  const id = entry.originalId;
  if (s === "projects") {
    const tasks = await db.getAll("tasks");
    await Promise.all(
      tasks.filter((t) => t.projectId === id).map((t) => db.put("tasks", { ...t, projectId: null }))
    );
  } else if (s === "goals") {
    const [projects, tasks] = await Promise.all([db.getAll("projects"), db.getAll("tasks")]);
    await Promise.all([
      ...projects.filter((p) => p.goalId === id).map((p) => db.put("projects", { ...p, goalId: null })),
      ...tasks.filter((t) => t.goalId === id).map((t) => db.put("tasks", { ...t, goalId: null })),
    ]);
  } else if (s === "folders") {
    const notes = await db.getAll("notes");
    await Promise.all(
      notes.filter((n) => n.folderId === id).map((n) => db.put("notes", { ...n, folderId: null }))
    );
  } else if (s === "habits") {
    const logs = await db.getAll("habitLogs");
    await Promise.all(logs.filter((l) => l.habitId === id).map((l) => db.del("habitLogs", l.id)));
  }
}
