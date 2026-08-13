// wallet.js — a real personal balance the user tops up themselves (manually
// or on a recurring schedule, e.g. fixed pocket money for kids), separate
// from ledger tracking. Sending money into a specific ledger's own wallet
// is handled by ledgerWallet.js's fundLedgerWallet() — used from both the
// Wallet page and from inside the ledger itself, so it's one consistent
// path either way.
//
// Multi-currency: the wallet holds a separate balance per currency
// (e.g. USD 500 + MYR 200 at the same time), not one blended number.

import { readOnce, writeSet, writeUpdate, writeRemove, writePush, listen } from "./firebase.js";
import { S, notify } from "./state.js";
import { convert } from "./currency.js";

export function listenWallet() {
  const uid = S.user.uid;
  const unsubBal = listen(`users/${uid}/wallet/balances`, (data) => { S.walletBalances = data || {}; notify(); });
  const unsubTx = listen(`users/${uid}/wallet/transactions`, (data) => { S.walletTx = data || {}; notify(); });
  const unsubRec = listen(`users/${uid}/wallet/recurring`, (data) => { S.walletRecurring = data || {}; notify(); });
  return () => { unsubBal(); unsubTx(); unsubRec(); };
}

// Converts wallet balances (assets) and manually-entered liabilities into
// one home-currency summary for the Home Wallet card — same "standardize
// to one currency, detail on tap" treatment as the Budget card. Computed
// on demand (not a live listener) since it needs async currency conversion;
// call whenever Home loads or wallet/liabilities data changes.
export async function refreshWalletNetWorth(homeCurrency) {
  let assets = 0;
  for (const [currency, amount] of Object.entries(S.walletBalances || {})) {
    const c = currency !== homeCurrency ? await convert(amount, currency, homeCurrency) : amount;
    assets += c != null ? c : amount;
  }
  let liabilities = 0;
  for (const l of Object.values(S.liabilities || {})) {
    const cur = l.currency || homeCurrency;
    const c = cur !== homeCurrency ? await convert(l.amount, cur, homeCurrency) : l.amount;
    liabilities += c != null ? c : l.amount;
  }
  S.walletNetWorth = { assets, liabilities, net: assets - liabilities, homeCurrency };
  notify();
}

async function adjustBalance(currency, delta) {
  const uid = S.user.uid;
  const snap = await readOnce(`users/${uid}/wallet/balances/${currency}`);
  const current = snap.exists() ? snap.val() : 0;
  await writeSet(`users/${uid}/wallet/balances/${currency}`, Math.round((current + delta) * 100) / 100);
}

// Validated withdrawal from the personal wallet — throws if insufficient
// funds. Exported so other flows (like funding a ledger's own wallet) can
// reuse the same check instead of duplicating it.
export async function spendFromWallet(currency, amount) {
  const bal = S.walletBalances?.[currency] || 0;
  if (Number(amount) > bal) throw new Error(`You only have ${currency} ${bal.toFixed(2)} in your wallet.`);
  await adjustBalance(currency, -Number(amount));
}

export async function addFunds(amount, currency, note) {
  const uid = S.user.uid;
  await adjustBalance(currency, Number(amount));
  await writePush(`users/${uid}/wallet/transactions`, {
    type: "topup", amount: Number(amount), currency, note: note || "",
    date: new Date().toISOString().slice(0, 10), ts: Date.now(),
  });
}

// ---------- Transferring into a ledger now lives in ledgerWallet.js's
// fundLedgerWallet() — used from both the Wallet page and from inside a
// ledger's own Ledger Wallet panel, so there's exactly one code path
// instead of two inconsistent ones. ----------

// ---------- Recurring top-ups (e.g. fixed weekly pocket money) ----------
// Uses UTC throughout (construction, math, and the final ISO string) so
// this can never drift relative to `today` (also computed via toISOString,
// which is UTC-based). Mixing local-time date math with UTC-based date
// strings was the original bug — in timezones ahead of UTC, "+1 day" in
// local time could round-trip to the SAME UTC calendar date, making the
// due-date never actually advance and looping forever.
function addInterval(dateStr, freq) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (freq === "daily") date.setUTCDate(date.getUTCDate() + 1);
  else if (freq === "weekly") date.setUTCDate(date.getUTCDate() + 7);
  else if (freq === "yearly") date.setUTCFullYear(date.getUTCFullYear() + 1);
  else date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}

export async function addWalletRecurring({ name, amount, currency, freq, nextDate, endDate, maxOccurrences }) {
  const uid = S.user.uid;
  await writePush(`users/${uid}/wallet/recurring`, {
    name, amount: Number(amount), currency, freq, nextDate,
    endDate: endDate || null, maxOccurrences: maxOccurrences ? Number(maxOccurrences) : null,
    occurrenceCount: 0, createdAt: Date.now(),
  });
}

export async function deleteWalletRecurring(id) {
  await writeRemove(`users/${S.user.uid}/wallet/recurring/${id}`);
}

// Catch-up model, same approach as ledger recurring transactions — call
// when the Wallet screen opens.
export async function processDueWalletRecurring() {
  const uid = S.user.uid;
  const snap = await readOnce(`users/${uid}/wallet/recurring`);
  const recurring = snap.exists() ? snap.val() : {};
  const today = new Date().toISOString().slice(0, 10);
  let postedCount = 0;

  for (const [id, r] of Object.entries(recurring)) {
    let nextDate = r.nextDate;
    let occurrenceCount = r.occurrenceCount || 0;
    let stopped = false;
    let postsThisPass = 0;

    // Hard safety cap: no single recurring template should ever post more
    // than this many times in one catch-up pass, no matter what — this is
    // a backstop against any future date-math bug, not just the one just
    // fixed above.
    const MAX_CATCHUP_POSTS = 366;
    while (nextDate && nextDate <= today && !stopped && postsThisPass < MAX_CATCHUP_POSTS) {
      if (r.endDate && nextDate > r.endDate) { stopped = true; break; }
      if (r.maxOccurrences && occurrenceCount >= r.maxOccurrences) { stopped = true; break; }

      await adjustBalance(r.currency, r.amount);
      await writePush(`users/${uid}/wallet/transactions`, {
        type: "topup", amount: r.amount, currency: r.currency,
        note: `${r.name} (auto)`, date: nextDate, ts: Date.now(), fromRecurringId: id,
      });

      occurrenceCount++;
      postsThisPass++;
      nextDate = addInterval(nextDate, r.freq);
      postedCount++;
    }

    await writeUpdate(`users/${uid}/wallet/recurring/${id}`, { nextDate, occurrenceCount, stopped });
  }

  return postedCount;
}
