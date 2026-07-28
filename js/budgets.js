// budgets.js — three related but separate things:
//   1. Personal budget: your own monthly target, not tied to any one ledger.
//   2. Ledger budget: each ledger's own monthly target (permission-gated).
//   3. Included ledgers: which ledgers YOU choose to count toward your
//      personal overview — this is a per-user preference, not shared data,
//      since different members of the same ledger may want different views.

import { readOnce, writeSet, writeUpdate, listen } from "./firebase.js";
import { S, notify } from "./state.js";
import { convert } from "./currency.js";

export function currentYM() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

// ---------- Personal budget ----------
export function listenPersonalBudget(ym = currentYM()) {
  return listen(`users/${S.user.uid}/personalBudget/${ym}`, (data) => {
    S.personalBudget = data || {};
    notify();
  });
}
export async function setPersonalBudget(total, homeCurrency, ym = currentYM()) {
  await writeSet(`users/${S.user.uid}/personalBudget/${ym}`, { total: Number(total), homeCurrency });
}

// ---------- Which ledgers count toward the personal overview (per-user) ----------
export function listenIncludedLedgers() {
  return listen(`users/${S.user.uid}/includedInPersonal`, (data) => {
    S.includedLedgers = data || {};
    notify();
  });
}
export async function setLedgerIncluded(lid, included) {
  await writeUpdate(`users/${S.user.uid}/includedInPersonal`, { [lid]: included ? true : null });
}

// ---------- Per-ledger budget target ----------
export function listenLedgerBudget(lid, ym = currentYM()) {
  return listen(`ledgers/${lid}/budgets/${ym}`, (data) => {
    S.ledgerBudget = data || {};
    notify();
  });
}
export async function setLedgerBudget(lid, total, ym = currentYM()) {
  await writeSet(`ledgers/${lid}/budgets/${ym}`, { total: Number(total) });
}

// ---------- Personal overview: spending this month across flagged ledgers ----------
// This is computed on demand (not a live listener) since it may span many
// ledgers — call refreshPersonalOverview() when the screen opens or the
// person taps "Refresh".
export async function refreshPersonalOverview(homeCurrency) {
  const ym = currentYM();
  const includedIds = Object.keys(S.includedLedgers || {}).filter((lid) => S.includedLedgers[lid]);
  let total = 0;
  const perLedger = {};

  for (const lid of includedIds) {
    const [ledgerSnap, txSnap] = await Promise.all([
      readOnce(`ledgers/${lid}`),
      readOnce(`ledgerTransactions/${lid}`),
    ]);
    const ledger = ledgerSnap.exists() ? ledgerSnap.val() : null;
    const txs = txSnap.exists() ? txSnap.val() : {};
    if (!ledger) continue;

    let ledgerSpend = 0;
    Object.values(txs).forEach((t) => {
      if (t.type === "expense" && t.date?.startsWith(ym)) ledgerSpend += t.amount;
    });

    const converted = await convert(ledgerSpend, ledger.currency || "USD", homeCurrency);
    const spendInHomeCurrency = converted != null ? converted : ledgerSpend;
    perLedger[lid] = { name: ledger.name, spend: ledgerSpend, currency: ledger.currency, spendInHomeCurrency };
    total += spendInHomeCurrency;
  }

  S.personalOverview = { ym, total, perLedger, homeCurrency };
  notify();
}
