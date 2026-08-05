// ledgerWallet.js — a shared, real pooled balance belonging to ONE ledger
// (not a person). Any member can fund it from their own personal Wallet
// (wallet.js). Its balance is the actual money available to spend for
// that ledger's purpose — expenses can optionally be marked as "paid from
// the Ledger Wallet," which draws it down for real.
//
// v1 simplification: the Ledger Wallet operates only in that ledger's own
// currency (no multi-currency, no conversion) — funding in requires having
// that same currency in your personal wallet. Keeps this first version
// simple; multi-currency ledger wallets can come later if needed.

import { readOnce, writeSet, writePush, listen } from "./firebase.js";
import { S, notify } from "./state.js";
import { spendFromWallet } from "./wallet.js";
import { addTransaction } from "./transactions.js";

export async function getLedgerCurrency(lid) {
  const snap = await readOnce(`ledgers/${lid}`);
  return snap.exists() ? (snap.val().currency || "USD") : "USD";
}

export function listenLedgerWallet(lid) {
  return listen(`ledgers/${lid}/wallet/balance`, (data) => {
    S.ledgerWalletBalance = data || 0;
    notify();
  });
}

async function adjustLedgerWalletBalance(lid, delta) {
  const snap = await readOnce(`ledgers/${lid}/wallet/balance`);
  const current = snap.exists() ? snap.val() : 0;
  await writeSet(`ledgers/${lid}/wallet/balance`, Math.round((current + delta) * 100) / 100);
}

// "Transfer" — money moves from the funder's own personal Wallet into
// this ledger's pool. Deducts their personal balance for real, and logs
// the outgoing transfer in the funder's own personal Wallet history too
// (so "where did my money go" is answerable from the Wallet page alone).
export async function fundLedgerWallet(lid, ledgerName, ledgerCurrency, amount, note, funderName) {
  await spendFromWallet(ledgerCurrency, amount); // throws if they don't have enough
  await writePush(`users/${S.user.uid}/wallet/transactions`, {
    type: "transfer", amount: Number(amount), currency: ledgerCurrency, note: note || "",
    toLedgerId: lid, toLedgerName: ledgerName,
    date: new Date().toISOString().slice(0, 10), ts: Date.now(),
  });
  await adjustLedgerWalletBalance(lid, Number(amount));
  await addTransaction({
    type: "income",
    amount, currency: ledgerCurrency,
    category: "Wallet Funding",
    description: `${funderName} transferred from their wallet${note ? " — " + note : ""}`,
  });
}

// "Add" — money goes straight into the ledger's pool without coming out
// of anyone's personal Wallet. For real-world cases like cash collected
// in person, or contributions from people who aren't even using the app
// (e.g. a charity collection). No balance is deducted anywhere else.
export async function addToLedgerWallet(lid, ledgerCurrency, amount, note, addedByName) {
  await adjustLedgerWalletBalance(lid, Number(amount));
  await addTransaction({
    type: "income",
    amount, currency: ledgerCurrency,
    category: "Wallet Funding",
    description: `${addedByName} added funds directly${note ? " — " + note : ""}`,
  });
}

// Called when an expense is marked "paid from the Ledger Wallet" — throws
// if the pool doesn't have enough, so the caller can stop before creating
// the expense transaction at all.
export async function spendFromLedgerWallet(lid, amount) {
  const bal = S.ledgerWalletBalance || 0;
  if (Number(amount) > bal) throw new Error(`The ledger wallet only has ${bal.toFixed(2)} available.`);
  await adjustLedgerWalletBalance(lid, -Number(amount));
}

// If a transaction that was paid from the ledger wallet gets deleted, give
// the money back to the pool rather than losing track of it.
export async function refundToLedgerWallet(lid, amount) {
  await adjustLedgerWalletBalance(lid, Number(amount));
}
