// liabilities.js — manually-entered personal debts (loans, credit card
// balances, IOUs), separate from ledger tracking. Same idea as wallet.js's
// balances, but on the "money I owe" side instead of "money I have".
//
// Kept intentionally simple for v1: a flat list of named amounts, no
// interest/due-date tracking yet — that can be layered on later without
// changing this schema.

import { writeUpdate, writeRemove, writePush, listen } from "./firebase.js";
import { S, notify } from "./state.js";

export function listenLiabilities() {
  const uid = S.user.uid;
  return listen(`users/${uid}/liabilities`, (data) => {
    S.liabilities = data || {};
    notify();
  });
}

export async function addLiability(name, amount, currency) {
  const uid = S.user.uid;
  await writePush(`users/${uid}/liabilities`, {
    name: name.trim(), amount: Number(amount), currency, createdAt: Date.now(),
  });
}

export async function updateLiability(id, patch) {
  await writeUpdate(`users/${S.user.uid}/liabilities/${id}`, patch);
}

export async function deleteLiability(id) {
  await writeRemove(`users/${S.user.uid}/liabilities/${id}`);
}
