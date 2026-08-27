// ============================================================
// SEED — first-run initialization.
// Creates the default profile and settings only when they are
// missing (never overwrites existing data, including the profile
// that Firebase auth syncs right after sign-in).
// No demo data — the user builds their own workspace.
// ============================================================

import { get, bulkPut, getMeta, setMeta } from "./db.js";
import { DEFAULT_SETTINGS } from "../config/appConfig.js";

export async function seedIfNeeded() {
  const seeded = await getMeta("seeded");
  if (seeded) return false;

  const [profile, settings] = await Promise.all([
    get("profile", "profile"),
    get("settings", "settings"),
  ]);

  if (!profile) {
    await bulkPut("profile", [
      {
        id: "profile",
        name: "",
        email: "",
        workspace: "My workspace",
      },
    ]);
  }

  if (!settings) {
    await bulkPut("settings", [
      {
        id: "settings",
        ...DEFAULT_SETTINGS,
      },
    ]);
  }

  await setMeta("seeded", true);
  return true;
}