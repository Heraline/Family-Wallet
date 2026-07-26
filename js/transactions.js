// transactions.js — add / list / delete spending & income entries for the
// active ledger. Field names match the old app's schema so existing entries
// display correctly (extra old fields like splitWith/tags are simply
// ignored here for now — they'll be reintroduced in a later phase).

import { writePush, writeRemove, listen } from "./firebase.js";
import { S, notify } from "./state.js";
import { setTxUnsub } from "./ledgers.js";

export function listenTransactions(lid) {
  const unsub = listen(`ledgerTransactions/${lid}`, (data) => {
    S.txs = data || {};
    notify();
  });
  setTxUnsub(unsub);
  return unsub;
}

export async function addTransaction({ type, amount, category, description, currency }) {
  if (!S.activeLedgerId) throw new Error("No active ledger.");
  const now = new Date();
  const data = {
    type,                                   // "expense" | "income"
    amount: Number(amount),
    origAmount: Number(amount),
    currency: currency || S.ledgers[S.activeLedgerId]?.currency || "USD",
    category: type === "income" ? "income" : category,
    description: description?.trim() || category,
    date: now.toISOString().slice(0, 10),
    time: now.toTimeString().slice(0, 5),
    ts: Date.now(),
    addedBy: S.user.uid,
  };
  await writePush(`ledgerTransactions/${S.activeLedgerId}`, data);
}

export async function deleteTransaction(txId) {
  await writeRemove(`ledgerTransactions/${S.activeLedgerId}/${txId}`);
}
