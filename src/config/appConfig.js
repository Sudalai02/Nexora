// ============================================================
// APP CONFIGURATION
// ============================================================

export const APP_NAME = "TaskTrack";

export const STORAGE_KEYS = {
  swCacheVersion: "nexora-cache-v6",
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
    recommendations: true,
    smartPlanning: true,
    autoBreakdown: true,
    provider: "auto",
    ollamaUrl: "http://127.0.0.1:11434",
    model: "",
  },
  autoSchedule: false,
  screens: {
    home: true,
    tasks: true,
    projects: true,
    goals: true,
    calendar: true,
    focus: true,
    notes: true,
    inbox: true,
    insights: true,
    assistant: true,
    recycleBin: true,
  },
  theme: "light",
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

export const FIREBASE_READY = Boolean(
  FIREBASE.apiKey && FIREBASE.projectId
);
