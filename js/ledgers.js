// ledgers.js — create/join/switch ledgers, and keep the active ledger's
// member list in sync. Matches the old app's schema exactly:
//   ledgers/{lid}              -> ledger details
//   ledgerMembers/{lid}/{uid}  -> per-ledger member info
//   userLedgers/{uid}/{lid}    -> quick lookup of "which ledgers am I in"

import { readOnce, writeSet, writeUpdate, listen, dbRef } from "./firebase.js";
import { get } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { S, notify } from "./state.js";

function genInviteCode(len = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

let unsubMembers = null;
let unsubDetail = null;
let unsubTxs = null; // set by transactions.js via setTxUnsub, so switching ledgers cleans it up too
export function setTxUnsub(fn) { unsubTxs = fn; }

export function listenUserLedgers() {
  return listen(`userLedgers/${S.user.uid}`, (data) => {
    S.ledgers = data || {};
    notify();
  });
}

export async function createLedger(name, icon = "💼", currency = "USD") {
  const lid = crypto.randomUUID();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const inviteCode = genInviteCode();
  await writeSet(`ledgers/${lid}`, {
    id: lid, name, icon, inviteCode, owner: S.user.uid,
    createdAt: Date.now(), members: { [S.user.uid]: true }, currency, timezone,
  });
  await writeSet(`ledgerMembers/${lid}/${S.user.uid}`, {
    displayName: S.profile.displayName, avatar: S.profile.avatar, color: S.profile.color,
    role: "owner", joinedAt: Date.now(),
  });
  await writeSet(`userLedgers/${S.user.uid}/${lid}`, { name, icon, role: "owner" });
  return lid;
}

export async function joinLedgerByCode(code) {
  const snap = await readOnce("ledgers");
  const all = snap.val() || {};
  const entry = Object.entries(all).find(([, l]) => l.inviteCode === code.trim().toUpperCase());
  if (!entry) throw new Error("Invite code not found.");
  const [lid, ledger] = entry;

  const already = await get(dbRef(`ledgerMembers/${lid}/${S.user.uid}`));
  if (!already.exists()) {
    await writeSet(`ledgerMembers/${lid}/${S.user.uid}`, {
      displayName: S.profile.displayName, avatar: S.profile.avatar, color: S.profile.color,
      role: "member", joinedAt: Date.now(),
    });
  }
  await writeUpdate(`ledgers/${lid}/members`, { [S.user.uid]: true });
  await writeSet(`userLedgers/${S.user.uid}/${lid}`, { name: ledger.name, icon: ledger.icon || "💼", role: "member" });
  return lid;
}

export function switchLedger(lid) {
  unsubMembers?.();
  unsubDetail?.();
  unsubTxs?.();
  S.activeLedgerId = lid;
  S.activeLedgerDetail = null;
  S.members = {};
  S.txs = {};
  notify();
  unsubDetail = listen(`ledgers/${lid}`, (data) => { S.activeLedgerDetail = data || {}; notify(); });
  unsubMembers = listen(`ledgerMembers/${lid}`, (data) => { S.members = data || {}; notify(); });
}