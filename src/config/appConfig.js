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
// FIREBASE -- paste your Firebase config below.
// Go to Firebase Console -> Project Settings -> General -> Your apps -> Web app -> Config.
//
// Required Firebase services:
//   1. Authentication -> Enable Google sign-in provider
//   2. Firestore Database -> Create in production mode
//
// After pasting your config, the app will:
//   - Show a Google sign-in screen
//   - Sync all data to Firestore under users/{uid}/
//   - Work offline with IndexedDB as cache
// ------------------------------------------------------------
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDlaypoiUAc_nRu6vq4mEUlRgU3L8drgVc",
  authDomain: "tasktrack-ss003.firebaseapp.com",
  projectId: "tasktrack-ss003",
  storageBucket: "tasktrack-ss003.firebasestorage.app",
  messagingSenderId: "971261797435",
  appId: "1:971261797435:web:647f163f000a0df483e81e",
  measurementId: "G-ZYJ2JQFKL4"
};

export const FIREBASE_READY = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId
);

export { firebaseConfig as FIREBASE };
