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

import { readOnce, writeSet, listen } from "./firebase.js";
import { S, notify } from "./state.js";
import { spendFromWallet } from "./wallet.js";
import { addTransaction } from "./transactions.js";

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

// Any member funds the ledger's shared wallet from their own personal
// wallet. Deducts their personal balance, adds to the ledger's pool, and
// creates a visible entry in that ledger's own activity feed.
export async function fundLedgerWallet(lid, ledgerCurrency, amount, note, funderName) {
  await spendFromWallet(ledgerCurrency, amount); // throws if they don't have enough
  await adjustLedgerWalletBalance(lid, Number(amount));
  await addTransaction({
    type: "income",
    amount, currency: ledgerCurrency,
    category: "Wallet Funding",
    description: `${funderName} funded the ledger wallet${note ? " — " + note : ""}`,
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
