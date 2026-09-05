// transactions.js — add / list / delete spending & income entries for the
// active ledger. Field names match the old app's schema so existing entries
// display correctly (extra old fields like splitWith/tags are simply
// ignored here for now — they'll be reintroduced in a later phase).

import { writePush, writeRemove, writeUpdate, readOnce, listen } from "./firebase.js";
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

export async function addTransaction({ type, amount, category, description, currency, payers, splitWith, splitAmounts, tags, account, reimburse, ledgerId, date, time }) {
  // Defaults to the currently active ledger (the normal case, when you're
  // inside a ledger's own page). The quick-add flow can instead pass an
  // explicit ledgerId to post directly to any ledger without navigating
  // into it first — in that case we look its currency up fresh rather than
  // trusting S.activeLedgerDetail, which may belong to a different ledger.
  const targetLedgerId = ledgerId || S.activeLedgerId;
  if (!targetLedgerId) throw new Error("No active ledger.");
  const now = new Date();
  let ledgerCurrency;
  if (targetLedgerId === S.activeLedgerId) {
    ledgerCurrency = S.activeLedgerDetail?.currency || "USD";
  } else {
    const snap = await readOnce(`ledgers/${targetLedgerId}`);
    ledgerCurrency = snap.exists() ? (snap.val().currency || "USD") : "USD";
  }
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
    date: date || now.toISOString().slice(0, 10),
    time: time || now.toTimeString().slice(0, 5),
    ts: Date.now(),
    addedBy: S.user.uid,
    ...(payers ? { payers: scaleToLedgerCurrency(payers) } : {}),
    ...(splitWith?.length ? { splitWith } : {}),
    ...(splitAmounts ? { splitAmounts: scaleToLedgerCurrency(splitAmounts) } : {}),
    ...(tags?.length ? { tags } : {}),
    ...(account ? { account } : {}),
    ...(reimburse ? { reimburse: true } : {}),
  };
  await writePush(`ledgerTransactions/${targetLedgerId}`, data);
}

export async function deleteTransaction(txId) {
  await writeRemove(`ledgerTransactions/${S.activeLedgerId}/${txId}`);
}

// Shared, not personal — any member can star/unstar, everyone sees it.
export async function toggleBookmark(txId, currentlyBookmarked) {
  await writeUpdate(`ledgerTransactions/${S.activeLedgerId}/${txId}`, { bookmarked: !currentlyBookmarked });
}

// Home-screen overview: gathers bookmarked transactions across multiple
// ledgers onto one page. Read-only, same as computeHomeSplitsOverview —
// to unstar or delete one, open that ledger's own Bookmarked screen.
export async function computeHomeBookmarksOverview(ledgerIds) {
  const perLedger = [];
  const combined = [];

  for (const lid of ledgerIds) {
    const [txSnap, ledgerSnap] = await Promise.all([
      readOnce(`ledgerTransactions/${lid}`),
      readOnce(`ledgers/${lid}`),
    ]);
    const txs = txSnap.exists() ? txSnap.val() : {};
    const ledger = ledgerSnap.exists() ? ledgerSnap.val() : {};
    const currency = ledger.currency || "USD";
    const bookmarked = Object.entries(txs)
      .filter(([, t]) => t.bookmarked)
      .map(([id, t]) => ({ id, lid, ledgerName: ledger.name, ledgerIcon: ledger.icon, currency, ...t }))
      .sort((a, b) => b.ts - a.ts);
    if (!bookmarked.length) continue;

    perLedger.push({ lid, name: ledger.name, icon: ledger.icon, currency, txs: bookmarked });
    combined.push(...bookmarked);
  }

  combined.sort((a, b) => b.ts - a.ts);
  return { combined, perLedger, ledgersWithBookmarksCount: perLedger.length, totalLedgersChecked: ledgerIds.length };
}
