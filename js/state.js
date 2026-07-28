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
};

// Very small pub/sub so ui.js can re-render whenever state changes,
// without state.js needing to know anything about the DOM.
const listeners = new Set();
export function onStateChange(fn) { listeners.add(fn); }
export function notify() { listeners.forEach(fn => fn(S)); }