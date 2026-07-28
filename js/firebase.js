// firebase.js — the ONLY file that talks to Firebase directly.
// Every other file asks THIS file to read/write data. If Firebase's API
// ever changes, this is the only file that needs to change.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getDatabase, ref, set, get, push, update, remove, onValue, off
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

if (!window.__FIREBASE_CONFIG__) {
  throw new Error("Missing firebase-config.js — see firebase-config.template.js for setup instructions.");
}

const app = initializeApp(window.__FIREBASE_CONFIG__);
export const auth = getAuth(app);
export const db = getDatabase(app);

// ---------- Auth ----------
export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}
export async function signUp(email, password, displayName) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName });
  return cred.user;
}
export async function logIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}
export function logOut() {
  return signOut(auth);
}

// ---------- Generic data helpers (compatible with the old app's schema) ----------
export function dbRef(path) { return ref(db, path); }
export function readOnce(path) { return get(ref(db, path)); }
export function writeSet(path, value) { return set(ref(db, path), value); }
export function writeUpdate(path, value) { return update(ref(db, path), value); }
export function writePush(path, value) { return push(ref(db, path), value); }
export function writeRemove(path) { return remove(ref(db, path)); }

// listen(path, cb) returns an unsubscribe function — always clean up old
// listeners before attaching new ones (e.g. when switching ledgers).
export function listen(path, cb) {
  const r = ref(db, path);
  const handler = (snap) => cb(snap.exists() ? snap.val() : null);
  onValue(r, handler);
  return () => off(r, "value", handler);
}