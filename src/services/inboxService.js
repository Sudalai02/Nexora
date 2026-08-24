import * as db from "../store/db.js";
import { uid } from "../utils/id.js";
import * as recycle from "./recycleService.js";
import { emit } from "../utils/bus.js";

export async function allItems() {
  const items = await db.getAll("inbox");
  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function pendingItems() {
  const items = await allItems();
  return items.filter((i) => !i.processed);
}

export async function addItem(type, content) {
  const item = {
    id: uid("i"),
    type,
    content,
    processed: false,
    createdAt: new Date().toISOString(),
  };
  await db.put("inbox", item);
  emit("data-changed", { entity: "inbox" });
  return item;
}

export async function markProcessed(id) {
  const item = await db.get("inbox", id);
  if (!item) return null;
  const next = await db.put("inbox", { ...item, processed: true });
  emit("data-changed", { entity: "inbox" });
  return next;
}

export async function updateItem(id, patch) {
  const item = await db.get("inbox", id);
  if (!item) throw new Error(`Inbox item ${id} not found`);
  const next = await db.put("inbox", { ...item, ...patch });
  emit("data-changed", { entity: "inbox" });
  return next;
}

export async function removeItem(id) {
  const entry = await recycle.softDelete("inbox", id);
  emit("data-changed", { entity: "inbox" });
  return entry;
}
