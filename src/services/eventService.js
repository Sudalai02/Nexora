import * as db from "../store/db.js";
import { uid } from "../utils/id.js";
import { emit } from "../utils/bus.js";
import * as recycle from "./recycleService.js";

export async function eventsInRange(startISO, endISO) {
  const events = await db.getAll("events");
  return events
    .filter((e) => e.date >= startISO && e.date <= endISO)
    .sort((a, b) => (a.date === b.date ? a.startHour - b.startHour : a.date < b.date ? -1 : 1));
}

export async function createEvent(data) {
  const event = {
    id: uid("e"),
    title: data.title.trim(),
    type: data.type || "meeting",
    date: data.date,
    startHour: Number(data.startHour),
    endHour: Number(data.endHour),
    notes: data.notes || "",
    createdAt: new Date().toISOString(),
  };
  await db.put("events", event);
  emit("data-changed", { entity: "events" });
  return event;
}

export async function updateEvent(id, patch) {
  const event = await db.get("events", id);
  if (!event) throw new Error(`Event ${id} not found`);
  const next = { ...event, ...patch };
  if (patch.title !== undefined) next.title = String(patch.title).trim();
  next.startHour = Number(next.startHour);
  next.endHour = Number(next.endHour);
  await db.put("events", next);
  emit("data-changed", { entity: "events" });
  return next;
}

export async function allEvents() {
  const events = await db.getAll("events");
  return events.sort((a, b) => (a.date === b.date ? a.startHour - b.startHour : a.date < b.date ? -1 : 1));
}

export async function removeEvent(id) {
  const entry = await recycle.softDelete("events", id);
  emit("data-changed", { entity: "events" });
  return entry;
}
