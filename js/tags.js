// tags.js — free-form labels members can attach to transactions (multiple
// per transaction). Anyone can create a new tag on the fly while entering
// a transaction; renaming or deleting a tag (which affects it everywhere
// in the ledger) is permission-gated, same pattern as categories/budget.

import { readOnce, writeSet, writeUpdate, listen } from "./firebase.js";
import { S, notify } from "./state.js";

export function listenTags(lid) {
  return listen(`ledgers/${lid}/tags`, (data) => {
    S.tags = data ? Object.values(data) : [];
    notify();
  });
}

function tagKey(tag) {
  return tag.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "tag_" + Date.now();
}

// Adds a new tag to the ledger's shared tag list, if it doesn't already
// exist (case-insensitive). Open to any member — no permission check here.
export async function ensureTagExists(lid, tag) {
  const clean = tag.trim();
  if (!clean) return;
  if (S.tags?.some((t) => t.toLowerCase() === clean.toLowerCase())) return;
  await writeSet(`ledgers/${lid}/tags/${tagKey(clean)}`, clean);
}

// Renames a tag everywhere: the ledger's tag list AND every transaction
// currently using it. Permission-gated in the UI layer.
export async function renameTag(lid, oldTag, newTag) {
  const clean = newTag.trim();
  if (!clean || clean === oldTag) return;
  const txSnap = await readOnce(`ledgerTransactions/${lid}`);
  const txs = txSnap.exists() ? txSnap.val() : {};
  const updates = { [`ledgers/${lid}/tags/${tagKey(oldTag)}`]: null, [`ledgers/${lid}/tags/${tagKey(clean)}`]: clean };
  Object.entries(txs).forEach(([txId, t]) => {
    if (t.tags?.includes(oldTag)) {
      updates[`ledgerTransactions/${lid}/${txId}/tags`] = t.tags.map((x) => (x === oldTag ? clean : x));
    }
  });
  await writeUpdate("/", updates);
}

// Deletes a tag everywhere: the ledger's tag list AND removes it from
// every transaction currently using it. Permission-gated in the UI layer.
export async function deleteTag(lid, tag) {
  const txSnap = await readOnce(`ledgerTransactions/${lid}`);
  const txs = txSnap.exists() ? txSnap.val() : {};
  const updates = { [`ledgers/${lid}/tags/${tagKey(tag)}`]: null };
  Object.entries(txs).forEach(([txId, t]) => {
    if (t.tags?.includes(tag)) {
      updates[`ledgerTransactions/${lid}/${txId}/tags`] = t.tags.filter((x) => x !== tag);
    }
  });
  await writeUpdate("/", updates);
}

// How many transactions currently use each tag — shown next to each tag
// in the management panel.
export function tagUsageCounts(txs) {
  const counts = {};
  Object.values(txs || {}).forEach((t) => (t.tags || []).forEach((tag) => { counts[tag] = (counts[tag] || 0) + 1; }));
  return counts;
}
