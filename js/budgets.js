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

// ---------- Personal category budgets: your own target per category name,
// combined across every flagged ledger (separate from each ledger's own
// category budgets). Keyed by a sanitized slug of the category label,
// same pattern as ledger categories — Firebase keys can't contain some
// characters a category name might have (., #, $, [, ]).
function slugifyCat(label) {
  return label.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "cat_" + Date.now();
}
export function listenPersonalCategoryBudgets(ym = currentYM()) {
  return listen(`users/${S.user.uid}/personalCategoryBudgets/${ym}`, (data) => {
    S.personalCategoryBudgets = data || {};
    notify();
  });
}
export async function setPersonalCategoryBudget(label, amount, ym = currentYM()) {
  const slug = slugifyCat(label);
  await writeSet(`users/${S.user.uid}/personalCategoryBudgets/${ym}/${slug}`, {
    label, budget: amount ? Number(amount) : null,
  });
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
  const categorySpend = {}; // { label: amountInHomeCurrency }
  let allTx = [];

  for (const lid of includedIds) {
    const [ledgerSnap, txSnap] = await Promise.all([
      readOnce(`ledgers/${lid}`),
      readOnce(`ledgerTransactions/${lid}`),
    ]);
    const ledger = ledgerSnap.exists() ? ledgerSnap.val() : null;
    const txs = txSnap.exists() ? txSnap.val() : {};
    if (!ledger) continue;
    const ledgerCurrency = ledger.currency || "USD";

    let ledgerSpend = 0;
    for (const [txId, t] of Object.entries(txs)) {
      allTx.push({ ...t, txId, ledgerId: lid, ledgerName: ledger.name, ledgerIcon: ledger.icon });
      if (t.type !== "expense" || !t.date?.startsWith(ym)) continue;
      ledgerSpend += t.amount;

      let catAmt = t.amount;
      if (ledgerCurrency !== homeCurrency) {
        const c = await convert(t.amount, ledgerCurrency, homeCurrency);
        if (c != null) catAmt = c;
      }
      categorySpend[t.category] = (categorySpend[t.category] || 0) + catAmt;
    }

    const converted = await convert(ledgerSpend, ledgerCurrency, homeCurrency);
    const spendInHomeCurrency = converted != null ? converted : ledgerSpend;
    perLedger[lid] = { name: ledger.name, spend: ledgerSpend, currency: ledgerCurrency, spendInHomeCurrency };
    total += spendInHomeCurrency;
  }

  allTx.sort((a, b) => b.ts - a.ts);
  S.recentTx = allTx.slice(0, 5);
  S.personalOverview = { ym, total, perLedger, categorySpend, homeCurrency };
  notify();
}
