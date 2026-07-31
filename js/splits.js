// splits.js — computes simple pairwise "who owes who" balances from split
// transactions and recorded settlements. Deliberately NOT doing global
// settlement-minimization (e.g. netting a 3-person cycle down to fewer
// payments) — just straightforward per-transaction + settlement netting,
// as agreed for v1.

import { listen, readOnce, writePush, writeRemove } from "./firebase.js";
import { S, notify } from "./state.js";
import { convert } from "./currency.js";

export function listenSettlements(lid) {
  return listen(`ledgers/${lid}/settlements`, (data) => {
    S.settlements = data || {};
    notify();
  });
}

export async function addSettlement(lid, { from, to, amount, note }) {
  await writePush(`ledgers/${lid}/settlements`, {
    from, to, amount: Number(amount), note: note?.trim() || "",
    date: new Date().toISOString().slice(0, 10), ts: Date.now(), recordedBy: S.user.uid,
  });
}

export async function deleteSettlement(lid, id) {
  await writeRemove(`ledgers/${lid}/settlements/${id}`);
}

function addPairwise(map, debtor, creditor, amount) {
  if (amount <= 0.005) return;
  map[debtor] = map[debtor] || {};
  map[debtor][creditor] = (map[debtor][creditor] || 0) + amount;
}

// Returns [{from, to, amount}] — `from` owes `to` `amount`, net of everything.
export function computeBalances(txs, settlements) {
  const pairwise = {};

  for (const t of Object.values(txs || {})) {
    if (t.type !== "expense") continue;
    const hasSplit = t.splitWith?.length || (t.splitAmounts && Object.keys(t.splitAmounts).length);
    if (!hasSplit) continue;

    const total = t.amount;
    const payers = t.payers && Object.keys(t.payers).length ? t.payers : { [t.addedBy]: total };
    const owed = (t.splitAmounts && Object.keys(t.splitAmounts).length)
      ? t.splitAmounts
      : Object.fromEntries(t.splitWith.map((uid) => [uid, total / t.splitWith.length]));

    // Net contribution per person for just this transaction (paid minus owed).
    const people = new Set([...Object.keys(payers), ...Object.keys(owed)]);
    const net = {};
    people.forEach((uid) => { net[uid] = (payers[uid] || 0) - (owed[uid] || 0); });

    const debtors = Object.entries(net).filter(([, v]) => v < -0.005)
      .map(([uid, v]) => ({ uid, amt: -v })).sort((a, b) => b.amt - a.amt);
    const creditors = Object.entries(net).filter(([, v]) => v > 0.005)
      .map(([uid, v]) => ({ uid, amt: v })).sort((a, b) => b.amt - a.amt);

    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
      const pay = Math.min(debtors[i].amt, creditors[j].amt);
      addPairwise(pairwise, debtors[i].uid, creditors[j].uid, pay);
      debtors[i].amt -= pay; creditors[j].amt -= pay;
      if (debtors[i].amt < 0.005) i++;
      if (creditors[j].amt < 0.005) j++;
    }
  }

  // A settlement from->to reduces what `from` owes `to` — modeled as a debt
  // in the reverse direction so it nets out cleanly below.
  Object.values(settlements || {}).forEach((s) => addPairwise(pairwise, s.to, s.from, s.amount));

  const seen = new Set();
  const result = [];
  Object.keys(pairwise).forEach((a) => {
    Object.keys(pairwise[a]).forEach((b) => {
      const key = [a, b].sort().join("|");
      if (seen.has(key)) return;
      seen.add(key);
      const net = (pairwise[a]?.[b] || 0) - (pairwise[b]?.[a] || 0);
      if (Math.abs(net) < 0.01) return;
      if (net > 0) result.push({ from: a, to: b, amount: net });
      else result.push({ from: b, to: a, amount: -net });
    });
  });
  return result;
}

// Home-screen overview: gathers each ledger's own split balances (each in
// its own currency — no conversion needed for the per-ledger list) onto
// one page, PLUS a combined net total across every ledger (which does
// need currency conversion into `homeCurrency`, since a real member's
// account is the same person everywhere — guests are per-ledger only and
// don't net across ledgers). Read-only — recording a settlement still
// happens inside the relevant ledger.
export async function computeHomeSplitsOverview(ledgerIds, homeCurrency) {
  const namesMap = {};
  const perLedger = [];
  const netGlobal = {};

  for (const lid of ledgerIds) {
    const [txSnap, settleSnap, memberSnap, ledgerSnap] = await Promise.all([
      readOnce(`ledgerTransactions/${lid}`),
      readOnce(`ledgers/${lid}/settlements`),
      readOnce(`ledgerMembers/${lid}`),
      readOnce(`ledgers/${lid}`),
    ]);
    const txs = txSnap.exists() ? txSnap.val() : {};
    const settlements = settleSnap.exists() ? settleSnap.val() : {};
    const members = memberSnap.exists() ? memberSnap.val() : {};
    const ledger = ledgerSnap.exists() ? ledgerSnap.val() : {};
    Object.entries(members).forEach(([uid, m]) => { namesMap[uid] = m; });

    const balances = computeBalances(txs, settlements);
    if (!balances.length) continue;

    const ledgerCurrency = ledger.currency || "USD";
    perLedger.push({ lid, name: ledger.name, icon: ledger.icon, currency: ledgerCurrency, balances });

    for (const b of balances) {
      let amt = b.amount;
      if (ledgerCurrency !== homeCurrency) {
        const c = await convert(b.amount, ledgerCurrency, homeCurrency);
        if (c != null) amt = c; // if conversion unavailable, still net using the raw number rather than dropping it
      }
      netGlobal[b.from] = (netGlobal[b.from] || 0) - amt;
      netGlobal[b.to] = (netGlobal[b.to] || 0) + amt;
    }
  }

  const EPS = 0.01;
  const creditors = Object.entries(netGlobal).filter(([, v]) => v > EPS).map(([uid, v]) => ({ uid, amt: v })).sort((a, b) => b.amt - a.amt);
  const debtors = Object.entries(netGlobal).filter(([, v]) => v < -EPS).map(([uid, v]) => ({ uid, amt: -v })).sort((a, b) => b.amt - a.amt);
  const combined = [];
  let ci = 0, di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const pay = Math.min(creditors[ci].amt, debtors[di].amt);
    combined.push({ from: debtors[di].uid, to: creditors[ci].uid, amount: pay });
    creditors[ci].amt -= pay; debtors[di].amt -= pay;
    if (creditors[ci].amt < EPS) ci++;
    if (debtors[di].amt < EPS) di++;
  }

  return { combined, perLedger, namesMap, homeCurrency, ledgersWithSplitsCount: perLedger.length, totalLedgersChecked: ledgerIds.length };
}
