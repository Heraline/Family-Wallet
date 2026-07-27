// ui.js — plain, minimal rendering just to prove Phase 2 works end-to-end.
// This is NOT the final look — the 5-theme system from Phase 1 gets wired
// in during a later phase. Right now this only renders into <div id="app">.

import { S } from "./state.js";
import { can, isOwner, canDeleteTx, canRemoveMembers, canManageRoles, canDeleteLedger, GRANTABLE_PERMISSIONS } from "./permissions.js";

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

function ledgerIcon(icon) {
  // Old app allowed custom uploaded icons (long image data), not just emoji.
  if (icon && icon.startsWith("data:image")) {
    return `<img src="${icon}" class="icon-img" alt="" />`;
  }
  return `<span class="icon">${icon || "💼"}</span>`;
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
          ${ledgerIcon(l.icon)}
          <span>${l.name || "Untitled ledger"}</span>
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
  const ledger = S.activeLedgerDetail || {};
  const txs = Object.entries(S.txs || {}).sort((a, b) => b[1].ts - a[1].ts);
  const balance = txs.reduce((sum, [, t]) => sum + (t.type === "income" ? t.amount : -t.amount), 0);
  const memberEntries = Object.entries(S.members || {});
  const myMember = S.members[S.user.uid];
  const iAmOwner = isOwner(myMember);

  app.innerHTML = `
    <div class="topbar">
      <button id="btnBack" class="link">&larr; All ledgers</button>
      <button id="btnLogout" class="link">Log out</button>
    </div>
    <h2>${ledgerIcon(ledger.icon)} ${ledger.name || ""}</h2>
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
          ${canDeleteTx(myMember, t, S.user.uid) ? `<button class="link small" data-del="${id}">delete</button>` : ""}
        </div>`).join("") : `<p class="muted">No transactions yet.</p>`}
    </div>

    ${renderMembersPanel(memberEntries, myMember, iAmOwner)}
    ${renderSettingsPanel(ledger, myMember, iAmOwner)}
  `;
}

function roleLabel(m) {
  if (m.guest) return "Guest";
  if (m.role === "owner") return "👑 Owner";
  if (m.role === "moderator") return "🛡️ Moderator";
  return "Member";
}

function renderMembersPanel(memberEntries, myMember, iAmOwner) {
  const iCanRemove = canRemoveMembers(myMember);
  return `
    <div class="panel">
      <h3>Members (${memberEntries.length})</h3>
      ${memberEntries.map(([uid, m]) => `
        <div class="member-row">
          <span>${m.avatar || "🙂"} ${m.displayName}</span>
          <span class="role">${roleLabel(m)}${uid === S.user.uid ? " · you" : ""}</span>
          ${iAmOwner && uid !== S.user.uid && !m.guest ? `
            <select class="role-select" data-role-uid="${uid}">
              <option value="member" ${m.role === "member" ? "selected" : ""}>Member</option>
              <option value="moderator" ${m.role === "moderator" ? "selected" : ""}>Moderator</option>
            </select>
          ` : ""}
          ${iCanRemove && uid !== S.user.uid && m.role !== "owner" && !m.guest ? `<button class="link small" data-remove-uid="${uid}">remove</button>` : ""}
          ${iCanRemove && m.guest ? `<button class="link small" data-remove-guest="${uid}">remove</button>` : ""}
        </div>
        ${iAmOwner && m.role === "moderator" ? renderModPermissions(uid, m) : ""}
      `).join("")}

      ${can(myMember, "manageGuests") ? `
        <div class="sub-panel">
          <h4>Add guest</h4>
          <div id="guestError" class="error"></div>
          <input id="guestName" placeholder="Guest name" />
          <button id="btnAddGuest">Add guest</button>
        </div>` : ""}

      ${!iAmOwner ? `<button id="btnLeaveLedger" class="secondary" style="margin-top:10px">Leave this ledger</button>` : ""}
    </div>`;
}

function renderModPermissions(uid, m) {
  const perms = m.permissions || {};
  return `
    <div class="sub-panel mod-perms">
      <p class="muted">Moderator permissions for ${m.displayName}:</p>
      ${GRANTABLE_PERMISSIONS.map(p => `
        <label class="perm-check">
          <input type="checkbox" data-perm-uid="${uid}" data-perm-key="${p.key}" ${perms[p.key] ? "checked" : ""} />
          ${p.label}
        </label>`).join("")}
    </div>`;
}

function renderSettingsPanel(ledger, myMember, iAmOwner) {
  const canRename = can(myMember, "renameLedger");
  const canInvite = can(myMember, "regenerateInvite");
  if (!canRename && !canInvite && !iAmOwner) {
    return `<div class="panel"><h3>Invite code</h3><p class="muted"><strong>${ledger.inviteCode || "..."}</strong></p></div>`;
  }
  return `
    <div class="panel">
      <h3>Ledger settings</h3>
      ${canRename ? `
        <div id="renameError" class="error"></div>
        <input id="ledgerNameInput" value="${ledger.name || ""}" placeholder="Ledger name" />
        <input id="ledgerIconInput" value="${(ledger.icon || "").startsWith("data:image") ? "" : (ledger.icon || "")}" placeholder="Icon (emoji)" />
        <button id="btnRenameLedger">Save name / icon</button>
      ` : ""}
      <p class="muted" style="margin-top:10px">Invite code: <strong>${ledger.inviteCode || "..."}</strong></p>
      ${canInvite ? `<button id="btnRegenInvite" class="secondary">Regenerate code</button>` : ""}
      ${iAmOwner ? `<button id="btnDeleteLedger" class="danger" style="margin-top:14px">Delete this ledger</button>` : ""}
    </div>`;
}