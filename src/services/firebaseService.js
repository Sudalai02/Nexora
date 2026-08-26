// ============================================================
// FIREBASE SERVICE — auth + Firestore sync.
//
// If FIREBASE config is empty, the app runs local-only (IndexedDB).
// When config is filled, users must sign in and data syncs to
// Firestore under users/{uid}/collections.
// ============================================================

import { FIREBASE, FIREBASE_READY } from "../config/appConfig.js";

let app = null;
let auth = null;
let db = null;
let currentUser = null;
let onAuthCallbacks = [];

// ---- initialization ----

export function isFirebaseReady() {
  return FIREBASE_READY;
}

export function initFirebase() {
  if (!FIREBASE_READY || app) return;
  if (typeof firebase === "undefined") {
    console.warn("[firebase] SDK not loaded — running local-only");
    return;
  }
  app = firebase.initializeApp(FIREBASE);
  auth = firebase.auth();
  db = firebase.firestore();

  // Enable offline persistence
  db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
    if (err.code === "failed-precondition") {
      console.warn("[firebase] persistence unavailable (multiple tabs)");
    } else if (err.code === "unimplemented") {
      console.warn("[firebase] persistence not supported by browser");
    }
  });

  // Listen for auth state changes
  auth.onAuthStateChanged((user) => {
    currentUser = user;
    onAuthCallbacks.forEach((cb) => cb(user));
  });
}

export function onAuthChange(cb) {
  onAuthCallbacks.push(cb);
  if (currentUser !== null) cb(currentUser);
  return () => {
    onAuthCallbacks = onAuthCallbacks.filter((x) => x !== cb);
  };
}

export function getUser() {
  return currentUser;
}

export function getUserId() {
  return currentUser?.uid || null;
}

// ---- auth ----

export async function signInWithGoogle() {
  if (!auth) throw new Error("Firebase not initialized");
  const provider = new firebase.auth.GoogleAuthProvider();
  const cred = await auth.signInWithPopup(provider);
  return cred.user;
}

export async function signOut() {
  if (!auth) return;
  await auth.signOut();
}

// ---- Firestore CRUD (mirrors db.js interface) ----

function userCol(collection) {
  if (!db || !currentUser) return null;
  return db.collection("users").doc(currentUser.uid).collection(collection);
}

export async function fsGetAll(collection) {
  const col = userCol(collection);
  if (!col) return [];
  const snap = await col.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function fsGet(collection, id) {
  const col = userCol(collection);
  if (!col) return null;
  const doc = await col.doc(id).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

export async function fsPut(collection, obj) {
  const col = userCol(collection);
  if (!col) return;
  const id = obj.id || crypto.randomUUID();
  await col.doc(id).set(obj, { merge: true });
  return { ...obj, id };
}

export async function fsDel(collection, id) {
  const col = userCol(collection);
  if (!col) return;
  await col.doc(id).delete();
}

export async function fsClear(collection) {
  const col = userCol(collection);
  if (!col) return;
  const snap = await col.get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

export async function fsBulkPut(collection, items) {
  const col = userCol(collection);
  if (!col) return;
  const batch = db.batch();
  for (const item of items) {
    const id = item.id || crypto.randomUUID();
    batch.set(col.doc(id), item, { merge: true });
  }
  await batch.commit();
}

// ---- full sync: IndexedDB → Firestore ----

export async function syncToFirestore(localDb) {
  if (!currentUser) return;
  const STORES = ["tasks", "projects", "goals", "habits", "habitLogs",
    "events", "focusSessions", "notes", "folders", "inbox",
    "alerts", "recycleBin", "profile", "settings"];
  for (const store of STORES) {
    const items = await localDb.getAll(store);
    if (items.length) {
      await fsBulkPut(store, items);
    }
  }
}

// ---- full sync: Firestore → IndexedDB ----

export async function syncFromFirestore(localDb) {
  if (!currentUser) return;
  const STORES = ["tasks", "projects", "goals", "habits", "habitLogs",
    "events", "focusSessions", "notes", "folders", "inbox",
    "alerts", "recycleBin", "profile", "settings"];
  for (const store of STORES) {
    const items = await fsGetAll(store);
    if (items.length) {
      await localDb.bulkPut(store, items);
    }
  }
}
