// budgets.js — three related but separate things:
//   1. Personal budget: your own monthly target, not tied to any one ledger.
//   2. Ledger budget: each ledger's own monthly target (permission-gated).
//   3. Included ledgers: which ledgers YOU choose to count toward your
//      personal overview — this is a per-user preference, not shared data,
//      since different members of the same ledger may want different views.

import { readOnce, writeSet, writeUpdate, writeRemove, listen } from "./firebase.js";
import { S, notify } from "./state.js";
import { convert } from "./currency.js";
import { DEFAULT_CATEGORIES } from "./categories.js";

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

// Moves a budget target from an old (now-stale) category name to a
// current one — used when a ledger category got renamed and the personal
// target no longer matches anything live. Keeps the same budget amount.
export async function relinkPersonalCategoryBudget(oldLabel, newLabel, ym = currentYM()) {
  const oldSlug = slugifyCat(oldLabel);
  const current = S.personalCategoryBudgets?.[oldSlug];
  if (!current) return;
  await setPersonalCategoryBudget(newLabel, current.budget, ym);
  await writeRemove(`users/${S.user.uid}/personalCategoryBudgets/${ym}/${oldSlug}`);
}

export async function deletePersonalCategoryBudget(label, ym = currentYM()) {
  await writeRemove(`users/${S.user.uid}/personalCategoryBudgets/${ym}/${slugifyCat(label)}`);
}

// ---------- Personal overview: spending this month across flagged ledgers ----------
// This is computed on demand (not a live listener) since it may span many
// ledgers — call refreshPersonalOverview() when the screen opens or the
// person taps "Refresh".
export async function refreshPersonalOverview(homeCurrency) {
  const ym = currentYM();
  const today = new Date().toISOString().slice(0, 10);
  const includedIds = Object.keys(S.includedLedgers || {}).filter((lid) => S.includedLedgers[lid]);
  let total = 0;
  let spentToday = 0;
  let ledgersBalanceTotal = 0;
  let receivedThisMonth = 0;
  const perLedger = {};
  const categorySpend = {}; // { label: amountInHomeCurrency }
  const availableCatMap = {}; // { label: icon } — deduped across every flagged ledger's category list
  let allTx = [];

  for (const lid of includedIds) {
    const [ledgerSnap, txSnap, catSnap] = await Promise.all([
      readOnce(`ledgers/${lid}`),
      readOnce(`ledgerTransactions/${lid}`),
      readOnce(`ledgers/${lid}/categories`),
    ]);
    const ledger = ledgerSnap.exists() ? ledgerSnap.val() : null;
    const txs = txSnap.exists() ? txSnap.val() : {};
    if (!ledger) continue;
    const ledgerCurrency = ledger.currency || "USD";

    const ledgerCats = catSnap.exists() ? catSnap.val() : DEFAULT_CATEGORIES;
    Object.values(ledgerCats).forEach((c) => { if (!(c.label in availableCatMap)) availableCatMap[c.label] = c.icon; });

    let ledgerSpend = 0;
    let ledgerBalance = 0; // all-time, this ledger's own currency
    for (const [txId, t] of Object.entries(txs)) {
      allTx.push({ ...t, txId, ledgerId: lid, ledgerName: ledger.name, ledgerIcon: ledger.icon });

      ledgerBalance += t.type === "income" ? t.amount : -t.amount;

      if (t.type === "expense" && t.date === today) {
        const c = ledgerCurrency !== homeCurrency ? await convert(t.amount, ledgerCurrency, homeCurrency) : t.amount;
        spentToday += c != null ? c : t.amount;
      }

      if (t.type === "income" && t.date?.startsWith(ym)) {
        const c = ledgerCurrency !== homeCurrency ? await convert(t.amount, ledgerCurrency, homeCurrency) : t.amount;
        receivedThisMonth += c != null ? c : t.amount;
      }

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

    const balanceConverted = await convert(ledgerBalance, ledgerCurrency, homeCurrency);
    ledgersBalanceTotal += balanceConverted != null ? balanceConverted : ledgerBalance;
  }

  // Total Balance = flagged ledgers' all-time balance + your personal Wallet, all converted to home currency.
  let walletTotal = 0;
  for (const [currency, amount] of Object.entries(S.walletBalances || {})) {
    const c = currency !== homeCurrency ? await convert(amount, currency, homeCurrency) : amount;
    walletTotal += c != null ? c : amount;
  }
  const totalBalance = ledgersBalanceTotal + walletTotal;

  allTx.sort((a, b) => b.ts - a.ts);
  // Keep a larger pool than we show at first — Home shows 5 and lets the
  // person tap "Show more" to reveal the rest, up to this cap.
  S.recentTx = allTx.slice(0, 20);
  const availableCategories = Object.entries(availableCatMap).map(([label, icon]) => ({ label, icon })).sort((a, b) => a.label.localeCompare(b.label));
  S.personalOverview = { ym, total, spentToday, totalBalance, receivedThisMonth, perLedger, categorySpend, availableCategories, homeCurrency };
  notify();
}
