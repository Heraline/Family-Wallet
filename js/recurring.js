// recurring.js — saved transaction templates that auto-post on a schedule.
//
// IMPORTANT REALITY CHECK: this app has no backend server, so nothing runs
// while the app is closed. Instead, every time a ledger is opened, we check
// "is anything overdue since I was last here?" and post it then — a
// catch-up model, same approach the old app used. Not true real-time, but
// accurate as of whenever you next open the app.

import { readOnce, writeSet, writeUpdate, writeRemove, writePush, listen } from "./firebase.js";
import { S, notify } from "./state.js";
import { convert } from "./currency.js";

export const FREQUENCIES = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "yearly", label: "Yearly" },
];

function addInterval(dateStr, freq) {
  const d = new Date(dateStr + "T00:00:00");
  if (freq === "daily") d.setDate(d.getDate() + 1);
  else if (freq === "weekly") d.setDate(d.getDate() + 7);
  else if (freq === "yearly") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1); // monthly default
  return d.toISOString().slice(0, 10);
}

let unsubRecurring = null;
export function listenRecurring(lid) {
  unsubRecurring?.();
  unsubRecurring = listen(`ledgers/${lid}/recurring`, (data) => {
    S.recurring = data || {};
    notify();
  });
  return unsubRecurring;
}

export async function addRecurring(lid, { name, amount, currency, category, type, freq, nextDate, endDate, maxOccurrences }) {
  const data = {
    name, amount: Number(amount), currency, category, type: type || "expense", freq,
    nextDate, endDate: endDate || null, maxOccurrences: maxOccurrences ? Number(maxOccurrences) : null,
    occurrenceCount: 0, createdBy: S.user.uid, createdAt: Date.now(),
  };
  await writePush(`ledgers/${lid}/recurring`, data);
}

export async function updateRecurring(lid, id, patch) {
  await writeUpdate(`ledgers/${lid}/recurring/${id}`, patch);
}

export async function deleteRecurring(lid, id) {
  await writeRemove(`ledgers/${lid}/recurring/${id}`);
}

// Called whenever a ledger is opened. Silently posts any due transactions
// (matching the old app's behavior), respecting end date / occurrence cap.
export async function processDueRecurring(lid) {
  const [recurringSnap, ledgerSnap] = await Promise.all([
    readOnce(`ledgers/${lid}/recurring`),
    readOnce(`ledgers/${lid}`),
  ]);
  const recurring = recurringSnap.exists() ? recurringSnap.val() : {};
  const ledgerCurrency = ledgerSnap.exists() ? (ledgerSnap.val().currency || "USD") : "USD";
  const today = new Date().toISOString().slice(0, 10);
  let postedCount = 0;

  for (const [id, r] of Object.entries(recurring)) {
    let nextDate = r.nextDate;
    let occurrenceCount = r.occurrenceCount || 0;
    let stopped = false;
    const origCurrency = r.currency || ledgerCurrency;

    // A template can be overdue by more than one cycle if the app hasn't
    // been opened in a while — post each missed occurrence in turn.
    while (nextDate && nextDate <= today && !stopped) {
      if (r.endDate && nextDate > r.endDate) { stopped = true; break; }
      if (r.maxOccurrences && occurrenceCount >= r.maxOccurrences) { stopped = true; break; }

      // Convert live at post-time (rates can drift since the template was created),
      // same pattern as manually-entered transactions — original amount/currency
      // is always kept too, so nothing is ever silently lost.
      let amount = r.amount, fxRate = 1;
      if (origCurrency !== ledgerCurrency) {
        const converted = await convert(r.amount, origCurrency, ledgerCurrency);
        if (converted != null) { amount = converted; fxRate = converted / r.amount; }
        else { fxRate = null; }
      }

      await writePush(`ledgerTransactions/${lid}`, {
        type: r.type || "expense",
        amount,
        currency: ledgerCurrency,
        origAmount: r.amount,
        origCurrency,
        fxRate,
        category: r.category,
        description: `${r.name} (auto)`,
        date: nextDate,
        time: new Date().toTimeString().slice(0, 5),
        ts: Date.now(),
        addedBy: r.createdBy || S.user.uid,
        fromRecurringId: id,
      });

      occurrenceCount++;
      nextDate = addInterval(nextDate, r.freq);
      postedCount++;
    }

    await writeUpdate(`ledgers/${lid}/recurring/${id}`, { nextDate, occurrenceCount, stopped });
  }

  return postedCount;
}
