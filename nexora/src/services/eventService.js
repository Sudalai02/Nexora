import * as db from "../store/db.js";
import { uid } from "../utils/id.js";

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
  };
  await db.put("events", event);
  return event;
}

export async function removeEvent(id) {
  return db.del("events", id);
}
