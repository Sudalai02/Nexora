// ============================================================
// SEED — first-run initialization.
// Creates only the default profile and settings.
// No demo data — the user builds their own workspace.
// ============================================================

import { bulkPut, getMeta, setMeta } from "./db.js";
import { DEFAULT_SETTINGS } from "../config/appConfig.js";

export async function seedIfNeeded() {
  const seeded = await getMeta("seeded");
  if (seeded) return false;

  await bulkPut("profile", [
    {
      id: "profile",
      name: "",
      email: "",
      workspace: "My workspace",
    },
  ]);

  await bulkPut("settings", [
    {
      id: "settings",
      ...DEFAULT_SETTINGS,
    },
  ]);

  await setMeta("seeded", true);
  return true;
}
