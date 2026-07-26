// ui.js — plain, minimal rendering just to prove Phase 2 works end-to-end.
// This is NOT the final look — the 5-theme system from Phase 1 gets wired
// in during a later phase. Right now this only renders into <div id="app">.

import { S } from "./state.js";

const app = document.getElementById("app");

export function render() {
  if (!S.user) return renderLogin();
  if (!S.activeLedgerId) return renderLedgerList();
  return renderLedgerDetail();
}

function renderLogin() {
  app.innerHTML = `
    <div class="auth-box">
      <h2>Tally Buddy</h2>
      <div id="authError" class="error"></div>
      <input id="authName" placeholder="Name (sign up only)" />
      <input id="authEmail" type="email" placeholder="Email" />
      <input id="authPass" type="password" placeholder="Password" />
      <div class="btn-row">
        <button id="btnLogin">Log in</button>
        <button id="btnSignup" class="secondary">Sign up</button>
      </div>
    </div>`;
}

function renderLedgerList() {
  const ledgers = Object.entries(S.ledgers || {});
  app.innerHTML = `
    <div class="topbar">
      <span>Hi, ${S.profile?.displayName || "there"}</span>
      <button id="btnLogout" class="link">Log out</button>
    </div>
    <h2>Your ledgers</h2>
    <div id="ledgerList" class="ledger-list">
      ${ledgers.length ? ledgers.map(([lid, l]) => `
        <button class="ledger-card" data-lid="${lid}">
          <span class="icon">${l.icon || "💼"}</span>
          <span>${l.name}</span>
          <span class="role">${l.role}</span>
        </button>`).join("") : `<p class="muted">No ledgers yet — create or join one below.</p>`}
    </div>
    <div class="panel">
      <h3>Create a new ledger</h3>
      <div id="createError" class="error"></div>
      <input id="newLedgerName" placeholder="Ledger name (e.g. Family)" />
      <button id="btnCreateLedger">Create</button>
    </div>
    <div class="panel">
      <h3>Join with invite code</h3>
      <div id="joinError" class="error"></div>
      <input id="joinCode" placeholder="6-character code" />
      <button id="btnJoinLedger">Join</button>
    </div>`;
}

function renderLedgerDetail() {
  const ledger = S.ledgers[S.activeLedgerId] || {};
  const txs = Object.entries(S.txs || {}).sort((a, b) => b[1].ts - a[1].ts);
  const balance = txs.reduce((sum, [, t]) => sum + (t.type === "income" ? t.amount : -t.amount), 0);
  const members = Object.values(S.members || {});

  // fetch invite code lazily from the ledgers object we already have client-side
  app.innerHTML = `
    <div class="topbar">
      <button id="btnBack" class="link">&larr; All ledgers</button>
      <button id="btnLogout" class="link">Log out</button>
    </div>
    <h2>${ledger.icon || "💼"} ${ledger.name || ""}</h2>
    <div class="balance">${(ledger.currency || "USD")} ${balance.toFixed(2)}</div>

    <div class="panel">
      <h3>Add entry</h3>
      <div id="txError" class="error"></div>
      <select id="txType"><option value="expense">Expense</option><option value="income">Income</option></select>
      <input id="txAmount" type="number" step="0.01" placeholder="Amount" />
      <input id="txCategory" placeholder="Category (e.g. Food)" />
      <input id="txDesc" placeholder="Description (optional)" />
      <button id="btnAddTx">Add</button>
    </div>

    <h3>Recent activity</h3>
    <div class="tx-list">
      ${txs.length ? txs.map(([id, t]) => `
        <div class="tx-row">
          <span>${t.category}${t.description ? " — " + t.description : ""}</span>
          <span class="${t.type}">${t.type === "income" ? "+" : "-"}${t.amount.toFixed(2)}</span>
          <button class="link small" data-del="${id}">delete</button>
        </div>`).join("") : `<p class="muted">No transactions yet.</p>`}
    </div>

    <div class="panel">
      <h3>Members (${members.length})</h3>
      ${members.map(m => `<div>${m.avatar || "🙂"} ${m.displayName} <span class="role">${m.role}</span></div>`).join("")}
      <p class="muted">Invite code: <strong>${ledger.inviteCode || "..."}</strong></p>
    </div>`;
}
