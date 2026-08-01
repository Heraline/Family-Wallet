// categories.js — per-ledger expense/income categories, each optionally
// with its own monthly budget target and a manual sort order. Ships with
// sensible defaults; a ledger only gets its own saved copy in Firebase
// once someone actually customizes it (add/edit/delete/reorder/reset) —
// until then it just uses the defaults, so untouched ledgers don't carry
// redundant data.
//
// Transactions store the category as plain LABEL TEXT (not a key/ID) —
// this keeps things fully backward-compatible with old free-text data,
// and means deleting/renaming a category never breaks past transactions'
// display.

import { writeSet, writeRemove, listen } from "./firebase.js";
import { S, notify } from "./state.js";

export const DEFAULT_CATEGORIES = {
  food:          { label: "Food & Dining",    icon: "🍔", type: "expense", order: 0 },
  groceries:     { label: "Groceries",        icon: "🛒", type: "expense", order: 1 },
  transport:     { label: "Transport",        icon: "🚗", type: "expense", order: 2 },
  shopping:      { label: "Shopping",         icon: "🛍️", type: "expense", order: 3 },
  bills:         { label: "Bills & Utilities",icon: "🧾", type: "expense", order: 4 },
  housing:       { label: "Housing & Rent",   icon: "🏠", type: "expense", order: 5 },
  health:        { label: "Health",           icon: "💊", type: "expense", order: 6 },
  entertainment: { label: "Entertainment",    icon: "🎬", type: "expense", order: 7 },
  travel:        { label: "Travel",           icon: "✈️", type: "expense", order: 8 },
  education:     { label: "Education",        icon: "📚", type: "expense", order: 9 },
  other:         { label: "Other",            icon: "📦", type: "expense", order: 10 },
  income:        { label: "Income",           icon: "💰", type: "income",  order: 0 },
};

// Starter emoji palette (a fuller icon library is planned as a follow-up,
// at which point categories will link to it instead).
export const EMOJI_PALETTE = [
  "🍔", "🛒", "🚗", "🛍️", "🧾", "🏠", "💊", "🎬", "✈️", "📚", "💰", "📦",
  "🐶", "🎮", "☕", "🎁", "⚡", "📱", "💇", "🏋️", "🧸", "🚌", "🍺", "🧻",
];

export function listenCategories(lid) {
  return listen(`ledgers/${lid}/categories`, (data) => {
    S.categories = data || {};
    notify();
  });
}

// The list actually shown/used right now: the ledger's own saved list if
// it has one, otherwise the shared defaults.
export function activeCategories() {
  return Object.keys(S.categories || {}).length ? S.categories : DEFAULT_CATEGORIES;
}

// Split + sort into the two groups the UI displays.
export function groupedCategories() {
  const all = Object.entries(activeCategories()).map(([key, c]) => ({ key, ...c }));
  const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
  return {
    expense: all.filter((c) => c.type !== "income").sort(byOrder),
    income: all.filter((c) => c.type === "income").sort(byOrder),
  };
}

function slugify(label) {
  return label.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "cat_" + Date.now();
}

async function persist(lid, updatedMap) {
  await writeSet(`ledgers/${lid}/categories`, updatedMap);
}

export async function addCategory(lid, { label, icon, type }) {
  const current = { ...activeCategories() }; // seeds from defaults on first-ever edit
  const key = slugify(label);
  const sameType = Object.values(current).filter((c) => c.type === type);
  const order = sameType.length ? Math.max(...sameType.map((c) => c.order ?? 0)) + 1 : 0;
  current[key] = { label, icon: icon || "📦", type, order };
  await persist(lid, current);
  return key;
}

export async function updateCategory(lid, key, patch) {
  const current = { ...activeCategories() };
  if (!current[key]) return;
  current[key] = { ...current[key], ...patch };
  await persist(lid, current);
}

export async function setCategoryBudget(lid, key, amount) {
  await updateCategory(lid, key, { budget: amount ? Number(amount) : null });
}

export async function deleteCategory(lid, key) {
  const current = { ...activeCategories() };
  delete current[key];
  await persist(lid, current);
}

// Swaps this category's order with its neighbor in the same type group.
export async function moveCategory(lid, key, direction) {
  const current = { ...activeCategories() };
  const target = current[key];
  if (!target) return;
  const sameType = Object.entries(current)
    .filter(([, c]) => c.type === target.type)
    .sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0));
  const idx = sameType.findIndex(([k]) => k === key);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= sameType.length) return; // already at the edge
  const [otherKey, otherCat] = sameType[swapIdx];
  const myOrder = target.order ?? 0;
  current[key] = { ...target, order: otherCat.order ?? 0 };
  current[otherKey] = { ...otherCat, order: myOrder };
  await persist(lid, current);
}

export async function resetCategoriesToDefault(lid) {
  await writeRemove(`ledgers/${lid}/categories`);
}
