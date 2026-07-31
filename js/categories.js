// categories.js — per-ledger category list (emoji icon + optional monthly
// budget each). Transactions still store the category as a plain text
// label (not a key) for full backward compatibility with the free-text
// categories used before this feature existed, and with the old app's data.

import { readOnce, writeSet, writeUpdate, writeRemove, listen } from "./firebase.js";
import { S, notify } from "./state.js";

// Used automatically whenever a ledger has no custom categories saved yet —
// never written to the database unless the person actually edits one,
// so a brand-new ledger costs nothing until customized.
export const DEFAULT_CATEGORIES = {
  food: { label: "Food & Dining", icon: "🍔" },
  transport: { label: "Transport", icon: "🚗" },
  shopping: { label: "Shopping", icon: "🛍️" },
  bills: { label: "Bills & Utilities", icon: "🏠" },
  entertainment: { label: "Entertainment", icon: "🎬" },
  health: { label: "Health", icon: "💊" },
  education: { label: "Education", icon: "📚" },
  travel: { label: "Travel", icon: "✈️" },
  income: { label: "Income", icon: "💰" },
  other: { label: "Other", icon: "📦" },
};

export const EMOJI_PALETTE = [
  "🍔", "🚗", "🛍️", "🏠", "🎬", "💊", "📚", "✈️", "💰", "📦",
  "☕", "🍕", "🚕", "🎮", "🎁", "💡", "📱", "🐾", "🏥", "🎓",
];

export function listenCategories(lid) {
  return listen(`ledgerCategories/${lid}`, (data) => {
    S.categories = data || {};
    notify();
  });
}

// The list to actually show in pickers — custom categories if the ledger
// has any, otherwise the defaults.
export function activeCategories() {
  return Object.keys(S.categories || {}).length ? S.categories : DEFAULT_CATEGORIES;
}

export async function addCategory(lid, { label, icon }) {
  const key = label.trim().toLowerCase().replace(/\s+/g, "_") + "_" + Date.now().toString(36);
  // First customization ever for this ledger — seed with the defaults so
  // nothing already-familiar silently disappears from the picker.
  const base = Object.keys(S.categories || {}).length ? S.categories : DEFAULT_CATEGORIES;
  await writeSet(`ledgerCategories/${lid}`, { ...base, [key]: { label: label.trim(), icon: icon || "📦" } });
}

export async function updateCategory(lid, key, patch) {
  const base = Object.keys(S.categories || {}).length ? S.categories : DEFAULT_CATEGORIES;
  await writeSet(`ledgerCategories/${lid}`, { ...base, [key]: { ...base[key], ...patch } });
}

export async function deleteCategory(lid, key) {
  const base = Object.keys(S.categories || {}).length ? S.categories : DEFAULT_CATEGORIES;
  const updated = { ...base };
  delete updated[key];
  await writeSet(`ledgerCategories/${lid}`, updated);
}

export async function setCategoryBudget(lid, key, amount) {
  await updateCategory(lid, key, { budget: amount ? Number(amount) : null });
}
