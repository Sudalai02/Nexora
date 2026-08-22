import * as db from "../store/db.js";
import { uid } from "../utils/id.js";

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
  return note;
}

export async function updateNote(id, patch) {
  const note = await db.get("notes", id);
  if (!note) throw new Error(`Note ${id} not found`);
  return db.put("notes", { ...note, ...patch, updatedAt: new Date().toISOString() });
}

export async function removeNote(id) {
  return db.del("notes", id);
}

// ---------- Folders ----------
export async function allFolders() {
  const folders = await db.getAll("folders");
  return folders.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createFolder(name) {
  const folder = { id: uid("f"), name: name.trim(), createdAt: new Date().toISOString() };
  await db.put("folders", folder);
  return folder;
}

export async function renameFolder(id, name) {
  const folder = await db.get("folders", id);
  if (!folder) throw new Error(`Folder ${id} not found`);
  return db.put("folders", { ...folder, name: name.trim() });
}

export async function removeFolder(id) {
  // notes in the folder fall back to "Unfiled"
  const notes = await db.getAll("notes");
  await Promise.all(
    notes.filter((n) => n.folderId === id).map((n) => db.put("notes", { ...n, folderId: null }))
  );
  return db.del("folders", id);
}
