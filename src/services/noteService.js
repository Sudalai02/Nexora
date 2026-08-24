import * as db from "../store/db.js";
import { uid } from "../utils/id.js";
import * as recycle from "./recycleService.js";
import { emit } from "../utils/bus.js";

// ---------- Notes ----------
export async function allNotes() {
  const notes = await db.getAll("notes");
  return notes.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getNote(id) {
  return db.get("notes", id);
}

export async function createNote(data = {}) {
  const now = new Date().toISOString();
  const note = {
    id: uid("n"),
    folderId: data.folderId || null,
    title: data.title || "Untitled note",
    body: data.body || "",
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
  await db.put("notes", note);
  emit("data-changed", { entity: "notes" });
  return note;
}

export async function updateNote(id, patch) {
  const note = await db.get("notes", id);
  if (!note) throw new Error(`Note ${id} not found`);
  const next = await db.put("notes", { ...note, ...patch, updatedAt: new Date().toISOString() });
  // Debounced editors fire often — refresh silently, no toast noise.
  emit("data-changed", { entity: "notes" });
  return next;
}

export async function removeNote(id) {
  const entry = await recycle.softDelete("notes", id);
  emit("data-changed", { entity: "notes" });
  return entry;
}

// ---------- Folders ----------
export async function allFolders() {
  const folders = await db.getAll("folders");
  return folders.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createFolder(name) {
  const folder = { id: uid("f"), name: name.trim(), createdAt: new Date().toISOString() };
  await db.put("folders", folder);
  emit("data-changed", { entity: "folders" });
  return folder;
}

export async function renameFolder(id, name) {
  const folder = await db.get("folders", id);
  if (!folder) throw new Error(`Folder ${id} not found`);
  const next = await db.put("folders", { ...folder, name: name.trim() });
  emit("data-changed", { entity: "folders" });
  return next;
}

export async function removeFolder(id) {
  // Notes keep their folderId so restoring the folder restores the
  // whole structure. Notes only become unfiled if the folder is
  // permanently purged (handled by recycleService).
  const entry = await recycle.softDelete("folders", id);
  emit("data-changed", { entity: "folders" });
  return entry;
}
