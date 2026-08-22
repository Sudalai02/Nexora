import * as db from "../store/db.js";
import { DEFAULT_SETTINGS } from "../config/appConfig.js";

export { DEFAULT_SETTINGS };

export async function getProfile() {
  return db.get("profile", "profile");
}

export async function saveProfile(patch) {
  const profile = await getProfile();
  const next = { ...(profile || { id: "profile" }), ...patch };
  await db.put("profile", next);
  return next;
}

export async function getSettings() {
  const row = await db.get("settings", "settings");
  return { ...DEFAULT_SETTINGS, ...row };
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const merged = { ...current, ...patch, id: "settings" };
  await db.put("settings", merged);
  return merged;
}
