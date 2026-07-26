// auth.js — signup/login/logout, and loading the user's profile record.
// Talks to firebase.js for actual reads/writes. Talks to state.js to store results.

import { signUp, logIn, logOut, watchAuth, readOnce, writeSet } from "./firebase.js";
import { S, notify } from "./state.js";

const AVATAR_COLORS = ["#2FBFAE", "#7C8CFF", "#E93D8A", "#8F6FE0", "#4D7FE0", "#F2A65A"];

export async function register(email, password, displayName) {
  const user = await signUp(email, password, displayName);
  const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  await writeSet(`users/${user.uid}`, { displayName, avatar: "🙂", color });
  return user;
}

export async function login(email, password) {
  return logIn(email, password);
}

export async function logout() {
  await logOut();
}

// Call once at app startup. Fires immediately with the current user (or null),
// and again any time login state changes.
export function initAuthWatcher(onReady) {
  watchAuth(async (user) => {
    S.user = user;
    if (user) {
      const snap = await readOnce(`users/${user.uid}`);
      S.profile = snap.exists() ? snap.val() : null;
    } else {
      S.profile = null;
      S.ledgers = {};
      S.activeLedgerId = null;
      S.members = {};
      S.txs = {};
    }
    notify();
    onReady?.(user);
  });
}
