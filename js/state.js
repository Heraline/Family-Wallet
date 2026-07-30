// state.js — single source of truth for in-memory app state.
// No Firebase calls here, no UI rendering here. Just plain data + a way to react to changes.

export const S = {
  user: null,          // firebase auth user object
  profile: null,       // { displayName, avatar, color } from users/{uid}
  ledgers: {},         // { ledgerId: {name, icon, role} } — lightweight list for the ledger-picker screen
  activeLedgerId: null,
  activeLedgerDetail: null, // full record from ledgers/{lid} (currency, inviteCode, etc.) — only loaded once a ledger is opened
  members: {},         // members of the active ledger { uid: {displayName, role, ...} }
  txs: {},             // transactions of the active ledger { txId: {...} }
  debugPreviewRole: null, // Owner-only testing tool: "member" | "moderator" | "guest" | null
  view: "home",        // "home" | "ledgers" | "personalBudget" | "aiSettings"
  personalBudget: {},  // this month's personal target, from users/{uid}/personalBudget/{ym}
  includedLedgers: {}, // { lid: true } — which ledgers count toward the personal overview
  personalOverview: null, // computed on demand by budgets.js refreshPersonalOverview()
  recentTx: [],        // latest 5 transactions across flagged ledgers, for the Home screen
  ledgerBudget: {},    // active ledger's monthly target, from ledgers/{lid}/budgets/{ym}
  recurring: {},       // active ledger's recurring transaction templates
  uiPrefs: { theme: "teal", cardStyle: "glass", chartStyle: "donut" }, // synced appearance settings
};

// Very small pub/sub so ui.js can re-render whenever state changes,
// without state.js needing to know anything about the DOM.
const listeners = new Set();
export function onStateChange(fn) { listeners.add(fn); }
export function notify() { listeners.forEach(fn => fn(S)); }
