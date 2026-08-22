// ============================================================
// APP CONFIGURATION
// Local-first build. Firebase values will be filled in during
// the final integration step (see FIREBASE placeholder below).
// ============================================================

export const APP_NAME = "Nexora";

export const STORAGE_KEYS = {
  swCacheVersion: "nexora-cache-v3",
};

export const DEFAULT_SETTINGS = {
  pomodoro: {
    focusMinutes: 45,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    sessionsBeforeLongBreak: 4,
  },
  notifications: {
    deadline: true,
    habit: true,
    morning: true,
    evening: true,
    risk: true,
  },
  ai: {
    provider: "auto", // "auto" | "heuristic"
    ollamaUrl: "http://127.0.0.1:11434",
    model: "", // empty = first available local model
  },
  autoSchedule: false,
};

// ------------------------------------------------------------
// FIREBASE (placeholder — wired in the final integration step)
// Fill these from your Firebase console when ready. Nothing in
// the app reads these yet; the local store is the active layer.
// ------------------------------------------------------------
export const FIREBASE = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
};
