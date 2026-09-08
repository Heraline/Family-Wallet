// ledgers.js — create/join/switch ledgers, and keep the active ledger's
// member list in sync. Matches the old app's schema exactly:
//   ledgers/{lid}              -> ledger details
//   ledgerMembers/{lid}/{uid}  -> per-ledger member info
//   userLedgers/{uid}/{lid}    -> quick lookup of "which ledgers am I in"

import { readOnce, writeSet, writeUpdate, writeRemove, listen, dbRef } from "./firebase.js";
import { get } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { S, notify } from "./state.js";

function genInviteCode(len = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

let unsubMembers = null;
let unsubDetail = null;
let unsubBudget = null;
let unsubTxs = null; // set by transactions.js via setTxUnsub, so switching ledgers cleans it up too
export function setTxUnsub(fn) { unsubTxs = fn; }
export function setBudgetUnsub(fn) { unsubBudget = fn; }

export function listenUserLedgers() {
  return listen(`userLedgers/${S.user.uid}`, (data) => {
    S.ledgers = data || {};
    S.ledgersReady = true;
    notify();
  });
}

// One-time (non-live) fetch of just what quick-add needs to work inside a
// ledger's context — its currency, categories, members, and tags — without
// setting up the full set of live listeners that switchLedger() does.
// Categories fall back to null here (not DEFAULT_CATEGORIES) so the caller
// can tell "this ledger has no custom categories yet" apart from "still
// loading"; ui.js already falls back to the shared defaults when rendering.
export async function fetchLedgerContext(lid) {
  const [ledgerSnap, catSnap, memberSnap, tagSnap] = await Promise.all([
    readOnce(`ledgers/${lid}`),
    readOnce(`ledgers/${lid}/categories`),
    readOnce(`ledgerMembers/${lid}`),
    readOnce(`ledgers/${lid}/tags`),
  ]);
  const ledger = ledgerSnap.exists() ? ledgerSnap.val() : {};
  return {
    currency: ledger.currency || "USD",
    categories: catSnap.exists() ? catSnap.val() : {},
    members: memberSnap.exists() ? memberSnap.val() : {},
    tags: tagSnap.exists() ? Object.values(tagSnap.val()) : [],
  };
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
  unsubBudget?.();
  unsubTxs?.();
  S.activeLedgerId = lid;
  S.activeLedgerDetail = null;
  S.members = {};
  S.txs = {};
  S.ledgerBudget = {};
  notify();
  unsubDetail = listen(`ledgers/${lid}`, (data) => { S.activeLedgerDetail = data || {}; notify(); });
  unsubMembers = listen(`ledgerMembers/${lid}`, (data) => { S.members = data || {}; notify(); });
}

// ---------- Ledger settings (gated by permissions.js in the UI layer) ----------
export async function renameLedger(lid, name, icon) {
  await writeUpdate(`ledgers/${lid}`, { name, icon });
  // keep every member's lightweight userLedgers copy in sync too
  const membersSnap = await readOnce(`ledgerMembers/${lid}`);
  const members = membersSnap.val() || {};
  const updates = {};
  Object.keys(members).forEach((uid) => {
    if (!members[uid].guest) updates[`userLedgers/${uid}/${lid}/name`] = name;
    if (!members[uid].guest) updates[`userLedgers/${uid}/${lid}/icon`] = icon;
  });
  await writeUpdate("/", updates);
}

// Changes the ledger's currency label going forward (budgets, wallet, new
// transactions). Existing transactions keep their recorded amount/currency
// as-is — this does NOT retroactively convert historical data.
export async function updateLedgerCurrency(lid, currency) {
  await writeUpdate(`ledgers/${lid}`, { currency });
}

export async function regenerateInviteCode(lid) {
  const inviteCode = genInviteCode();
  await writeUpdate(`ledgers/${lid}`, { inviteCode });
  return inviteCode;
}

// ---------- Guests (no login — placeholder people for splitting bills) ----------
export async function addGuest(lid, name, avatar = "🙂") {
  const gid = "guest_" + crypto.randomUUID();
  await writeSet(`ledgerMembers/${lid}/${gid}`, {
    displayName: name, avatar, role: "guest", guest: true, joinedAt: Date.now(),
  });
  return gid;
}
export async function removeGuest(lid, gid) {
  await writeRemove(`ledgerMembers/${lid}/${gid}`);
}

// ---------- Roles & permissions (Owner only) ----------
export async function setMemberRole(lid, uid, role, permissions = null) {
  const update = { role };
  if (role === "moderator") update.permissions = permissions || {};
  else update.permissions = null;
  await writeUpdate(`ledgerMembers/${lid}/${uid}`, update);
  await writeUpdate(`userLedgers/${uid}/${lid}`, { role });
}

export async function setModeratorPermissions(lid, uid, permissions) {
  await writeUpdate(`ledgerMembers/${lid}/${uid}`, { permissions });
}

// ---------- Removing / leaving / deleting ----------
export async function removeMember(lid, uid) {
  await writeRemove(`ledgerMembers/${lid}/${uid}`);
  await writeUpdate(`ledgers/${lid}/members`, { [uid]: null });
  await writeRemove(`userLedgers/${uid}/${lid}`);
}

export async function leaveLedger(lid, uid) {
  return removeMember(lid, uid);
}

export async function deleteLedger(lid) {
  const membersSnap = await readOnce(`ledgerMembers/${lid}`);
  const members = membersSnap.val() || {};
  const updates = {
    [`ledgers/${lid}`]: null,
    [`ledgerMembers/${lid}`]: null,
    [`ledgerTransactions/${lid}`]: null,
  };
  Object.keys(members).forEach((uid) => {
    if (!members[uid].guest) updates[`userLedgers/${uid}/${lid}`] = null;
  });
  await writeUpdate("/", updates);
}
