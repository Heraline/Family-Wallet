// transactions.js — add / list / delete spending & income entries for the
// active ledger. Field names match the old app's schema so existing entries
// display correctly (extra old fields like splitWith/tags are simply
// ignored here for now — they'll be reintroduced in a later phase).

import { writePush, writeRemove, listen } from "./firebase.js";
import { S, notify } from "./state.js";
import { setTxUnsub } from "./ledgers.js";
import { convert } from "./currency.js";

export function listenTransactions(lid) {
  const unsub = listen(`ledgerTransactions/${lid}`, (data) => {
    S.txs = data || {};
    notify();
  });
  setTxUnsub(unsub);
  return unsub;
}

export async function addTransaction({ type, amount, category, description, currency, payers, splitWith, splitAmounts, tags, account }) {
  if (!S.activeLedgerId) throw new Error("No active ledger.");
  const now = new Date();
  const ledgerCurrency = S.activeLedgerDetail?.currency || "USD";
  const origCurrency = currency || ledgerCurrency;
  const origAmount = Number(amount);

  // If entered in a different currency than the ledger's default, convert
  // it live so the ledger balance stays calculable — but we ALWAYS keep the
  // original amount/currency too, so the real recorded value is never lost.
  let amountInLedgerCurrency = origAmount;
  let fxRate = 1;
  if (origCurrency !== ledgerCurrency) {
    const converted = await convert(origAmount, origCurrency, ledgerCurrency);
    if (converted != null) {
      amountInLedgerCurrency = converted;
      fxRate = converted / origAmount;
    } else {
      // Offline / rate unavailable — fall back to recording only the original
      // currency so numbers are never silently wrong. Flagged via fxRate: null.
      amountInLedgerCurrency = origAmount;
      fxRate = null;
    }
  }

  const scaleToLedgerCurrency = (map) => {
    if (!map) return undefined;
    const rate = fxRate ?? 1; // if conversion was unavailable, treat 1:1 rather than lose the split entirely
    return Object.fromEntries(Object.entries(map).map(([uid, amt]) => [uid, Number(amt) * rate]));
  };

  const data = {
    type,                                   // "expense" | "income"
    amount: amountInLedgerCurrency,         // used for ledger balance/budget math
    currency: ledgerCurrency,
    origAmount,                             // what was actually entered/recorded
    origCurrency,
    fxRate,                                 // rate used at entry time (null = conversion unavailable)
    category: type === "income" ? "income" : category,
    description: description?.trim() || category,
    date: now.toISOString().slice(0, 10),
    time: now.toTimeString().slice(0, 5),
    ts: Date.now(),
    addedBy: S.user.uid,
    ...(payers ? { payers: scaleToLedgerCurrency(payers) } : {}),
    ...(splitWith?.length ? { splitWith } : {}),
    ...(splitAmounts ? { splitAmounts: scaleToLedgerCurrency(splitAmounts) } : {}),
    ...(tags?.length ? { tags } : {}),
    ...(account ? { account } : {}),
  };
  await writePush(`ledgerTransactions/${S.activeLedgerId}`, data);
}

export async function deleteTransaction(txId) {
  await writeRemove(`ledgerTransactions/${S.activeLedgerId}/${txId}`);
}
