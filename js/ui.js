// ui.js — plain, minimal rendering just to prove Phase 2 works end-to-end.
// This is NOT the final look — the 5-theme system from Phase 1 gets wired
// in during a later phase. Right now this only renders into <div id="app">.

import { S } from "./state.js";
import { can, isOwner, canDeleteTx, canRemoveMembers, canManageRoles, canDeleteLedger, GRANTABLE_PERMISSIONS } from "./permissions.js";
import { currentYM } from "./budgets.js";
import { getGeminiKey } from "./receipt.js";

const app = document.getElementById("app");

export function render() {
  if (!S.user) return renderLogin();
  if (S.activeLedgerId) return renderLedgerDetail();
  if (S.view === "personalBudget") return renderPersonalBudget();
  if (S.view === "aiSettings") return renderAiSettings();
  if (S.view === "ledgers") return renderLedgerList();
  return renderHome();
}

function bottomNav(active) {
  const tab = (key, icon, label) => `
    <button class="nav-btn ${active === key ? "active" : ""}" data-nav="${key}">
      <span class="nav-icon">${icon}</span><span class="nav-label">${label}</span>
    </button>`;
  return `
    <div class="bottom-nav">
      ${tab("home", "🏠", "Home")}
      ${tab("ledgers", "📒", "Ledgers")}
      ${tab("aiSettings", "⚙️", "Settings")}
    </div>`;
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

function renderHome() {
  const pb = S.personalBudget || {};
  const homeCurrency = pb.homeCurrency || "USD";
  const overview = S.personalOverview;
  const target = pb.total || 0;
  const spent = overview?.total || 0;
  const pct = target > 0 ? Math.min(100, Math.round((spent / target) * 100)) : 0;
  const over = target > 0 && spent > target;
  const ledgerEntries = Object.entries(S.ledgers || {});

  app.innerHTML = `
    <div class="topbar">
      <span>Hi, ${S.profile?.displayName || "there"} 👋</span>
      <button id="btnLogout" class="link">Log out</button>
    </div>

    <div id="btnHomeBudgetCard" class="panel card-button" role="button" tabindex="0">
      <h3>📊 This month's budget</h3>
      ${overview ? `
        <div class="balance" style="font-size:22px">${homeCurrency} ${spent.toFixed(2)} <span class="muted" style="font-size:13px">/ ${target ? target.toFixed(2) : "no target set"}</span></div>
        ${target > 0 ? `<div class="budget-bar-track"><div class="budget-bar-fill ${over ? "over" : ""}" style="width:${pct}%"></div></div>` : ""}
      ` : `<p class="muted">Set a personal budget target to see your overview here.</p>`}
      <p class="muted" style="margin-top:6px">Tap for details →</p>
    </div>

    <h3 style="margin-top:16px">Latest activity</h3>
    <div class="tx-list">
      ${S.recentTx?.length ? S.recentTx.map((t) => `
        <div class="tx-row">
          <span>${t.ledgerIcon || "💼"} ${t.category}${t.description ? " — " + t.description : ""}</span>
          <span class="${t.type}">${t.type === "income" ? "+" : "-"}${(t.origAmount ?? t.amount).toFixed(2)} ${t.origCurrency || t.currency}</span>
        </div>`).join("") : `<p class="muted">No recent activity yet — flag a ledger to include in your budget to see it here.</p>`}
    </div>

    <h3 style="margin-top:16px">Your ledgers</h3>
    <div class="ledger-scroll-row">
      ${ledgerEntries.length ? ledgerEntries.map(([lid, l]) => `
        <button class="ledger-scroll-card" data-lid="${lid}">
          ${ledgerIcon(l.icon)}
          <span>${l.name || "Untitled"}</span>
        </button>`).join("") : `<p class="muted">No ledgers yet — head to the Ledgers tab to create one.</p>`}
    </div>

    <div class="btn-row" style="margin-top:16px">
      <button class="secondary" disabled title="Coming soon">🤝 Splits</button>
      <button class="secondary" disabled title="Coming soon">✅ Settled</button>
    </div>

    ${bottomNav("home")}`;
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
        <div class="ledger-card-row">
          <button class="ledger-card" data-lid="${lid}">
            ${ledgerIcon(l.icon)}
            <span>${l.name || "Untitled ledger"}</span>
            <span class="role">${l.role}</span>
          </button>
          <label class="include-toggle">
            <input type="checkbox" data-include-lid="${lid}" ${S.includedLedgers?.[lid] ? "checked" : ""} />
            Include in my budget
          </label>
        </div>`).join("") : `<p class="muted">No ledgers yet — create or join one below.</p>`}
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
    </div>
    ${bottomNav("ledgers")}`;
}

function renderAiSettings() {
  const hasKey = !!getGeminiKey();
  app.innerHTML = `
    <div class="topbar">
      <span>Settings</span>
      <button id="btnLogout" class="link">Log out</button>
    </div>
    <h2>🔑 AI Settings</h2>
    <div class="panel">
      <p class="muted" style="margin-bottom:10px">Used for scanning receipt photos. Get a free key at <strong>aistudio.google.com/apikey</strong>. It's stored only in this browser — never sent anywhere except directly to Google when you scan a receipt.</p>
      <div id="aiKeyError" class="error"></div>
      <input id="geminiKeyInput" type="password" placeholder="Paste Gemini API key..." value="${getGeminiKey()}" />
      <div class="btn-row">
        <button id="btnSaveAiKey">Save key</button>
        ${hasKey ? `<button id="btnClearAiKey" class="secondary">Remove key</button>` : ""}
      </div>
      ${hasKey ? `<p class="muted" style="margin-top:8px">✓ Key saved</p>` : ""}
    </div>
    ${bottomNav("aiSettings")}`;
}

function fakePreviewMember(role) {
  if (role === "member") return { role: "member" };
  if (role === "guest") return { role: "guest", guest: true };
  if (role === "moderator") return {
    role: "moderator",
    permissions: { renameLedger: true, regenerateInvite: true, manageGuests: true, deleteOthersTx: true, removeMembers: true },
  };
  return null;
}

function renderLedgerDetail() {
  const ledger = S.activeLedgerDetail || {};
  const txs = Object.entries(S.txs || {}).sort((a, b) => b[1].ts - a[1].ts);
  const balance = txs.reduce((sum, [, t]) => sum + (t.type === "income" ? t.amount : -t.amount), 0);
  const memberEntries = Object.entries(S.members || {});

  const realMember = S.members[S.user.uid];
  const iAmRealOwner = isOwner(realMember);
  const previewing = iAmRealOwner && S.debugPreviewRole;
  const myMember = previewing ? fakePreviewMember(S.debugPreviewRole) : realMember;
  const iAmOwner = isOwner(myMember);

  app.innerHTML = `
    <div class="topbar">
      <button id="btnBack" class="link">&larr; All ledgers</button>
      <button id="btnLogout" class="link">Log out</button>
    </div>

    ${iAmRealOwner ? `
      <div class="preview-bar">
        <label>🔍 Preview as:</label>
        <select id="previewRoleSelect">
          <option value="" ${!S.debugPreviewRole ? "selected" : ""}>My real view (Owner)</option>
          <option value="moderator" ${S.debugPreviewRole === "moderator" ? "selected" : ""}>Moderator (all permissions)</option>
          <option value="member" ${S.debugPreviewRole === "member" ? "selected" : ""}>Member</option>
          <option value="guest" ${S.debugPreviewRole === "guest" ? "selected" : ""}>Guest</option>
        </select>
      </div>` : ""}

    <div class="${previewing ? "preview-lock" : ""}">
      ${previewing ? `<p class="preview-note">Previewing as <strong>${S.debugPreviewRole}</strong> — everything below is view-only, no actions will actually run.</p>` : ""}
      <h2>${ledgerIcon(ledger.icon)} ${ledger.name || ""}</h2>
      <div class="balance">${(ledger.currency || "USD")} ${balance.toFixed(2)}</div>

      <div class="panel">
        <h3>Add entry</h3>
        <div id="txError" class="error"></div>
        <button id="btnScanReceipt" class="secondary" style="margin-bottom:10px">📷 Scan receipt (optional)</button>
        <input type="file" id="receiptFileInput" accept="image/*" capture="environment" style="display:none" />
        <p id="scanStatus" class="muted" style="display:none;margin-bottom:8px">Reading receipt with AI...</p>
        <select id="txType"><option value="expense">Expense</option><option value="income">Income</option></select>
        <div class="btn-row">
          <input id="txAmount" type="number" step="0.01" placeholder="Amount" style="flex:2" />
          <select id="txCurrency" style="flex:1">
            ${["USD", "MYR", "SGD", "EUR", "GBP", "JPY", "AUD"].map(c => `<option value="${c}" ${((ledger.currency || "USD") === c) ? "selected" : ""}>${c}</option>`).join("")}
          </select>
        </div>
        <input id="txCategory" placeholder="Category (e.g. Food)" />
        <input id="txDesc" placeholder="Description (optional)" />
        <button id="btnAddTx">Add</button>
      </div>

      <h3>Recent activity</h3>
      <div class="tx-list">
        ${txs.length ? txs.map(([id, t]) => `
          <div class="tx-row">
            <span>${t.category}${t.description ? " — " + t.description : ""}</span>
            <span class="${t.type}">
              ${t.type === "income" ? "+" : "-"}${(t.origAmount ?? t.amount).toFixed(2)} ${t.origCurrency || t.currency}
              ${t.origCurrency && t.origCurrency !== t.currency ? `<span class="muted" style="font-weight:400"> (≈ ${t.currency} ${t.amount.toFixed(2)})</span>` : ""}
            </span>
            ${canDeleteTx(myMember, t, S.user.uid) ? `<button class="link small" data-del="${id}">delete</button>` : ""}
          </div>`).join("") : `<p class="muted">No transactions yet.</p>`}
      </div>

      ${renderLedgerBudgetPanel(ledger, myMember, txs)}
      ${renderMembersPanel(memberEntries, myMember, iAmOwner)}
      ${renderSettingsPanel(ledger, myMember, iAmOwner)}
    </div>
  `;
}

function renderLedgerBudgetPanel(ledger, myMember, txs) {
  const canEdit = can(myMember, "manageBudget");
  const budget = S.ledgerBudget || {};
  const target = budget.total || 0;
  const ym = currentYM();
  const spent = txs.filter(([, t]) => t.type === "expense" && t.date?.startsWith(ym)).reduce((sum, [, t]) => sum + t.amount, 0);
  const pct = target > 0 ? Math.min(100, Math.round((spent / target) * 100)) : 0;
  const over = target > 0 && spent > target;

  return `
    <div class="panel">
      <h3>Ledger budget — ${ym}</h3>
      <div class="balance" style="font-size:20px">${ledger.currency || "USD"} ${spent.toFixed(2)} <span class="muted" style="font-size:13px">/ ${target ? target.toFixed(2) : "no target set"}</span></div>
      ${target > 0 ? `
        <div class="budget-bar-track"><div class="budget-bar-fill ${over ? "over" : ""}" style="width:${pct}%"></div></div>
        ${over ? `<p class="budget-over">Over budget</p>` : `<p class="muted">${pct}% used</p>`}
      ` : ""}
      ${canEdit ? `
        <div class="btn-row" style="margin-top:10px">
          <input id="ledgerBudgetInput" type="number" step="0.01" placeholder="Monthly target" value="${target || ""}" />
          <button id="btnSaveLedgerBudget">Save</button>
        </div>` : ""}
    </div>`;
}

function renderPersonalBudget() {
  const ym = currentYM();
  const pb = S.personalBudget || {};
  const homeCurrency = pb.homeCurrency || "USD";
  const overview = S.personalOverview;
  const target = pb.total || 0;
  const spent = overview?.total || 0;
  const pct = target > 0 ? Math.min(100, Math.round((spent / target) * 100)) : 0;
  const over = target > 0 && spent > target;

  app.innerHTML = `
    <div class="topbar">
      <button id="btnBackFromBudget" class="link">&larr; Home</button>
      <button id="btnLogout" class="link">Log out</button>
    </div>
    <h2>📊 My Budget — ${ym}</h2>

    <div class="panel">
      <h3>Target</h3>
      <div class="btn-row">
        <input id="personalBudgetTotal" type="number" step="0.01" placeholder="Monthly target" value="${target || ""}" />
        <select id="personalHomeCurrency">
          ${["USD", "MYR", "SGD", "EUR", "GBP", "JPY", "AUD"].map(c => `<option value="${c}" ${homeCurrency === c ? "selected" : ""}>${c}</option>`).join("")}
        </select>
      </div>
      <button id="btnSavePersonalBudget">Save target</button>
    </div>

    <div class="panel">
      <h3>This month's spending (from ledgers you've flagged)</h3>
      ${overview ? `
        <div class="balance">${homeCurrency} ${spent.toFixed(2)} <span class="muted" style="font-size:14px">/ ${target ? target.toFixed(2) : "no target set"}</span></div>
        ${target > 0 ? `
          <div class="budget-bar-track"><div class="budget-bar-fill ${over ? "over" : ""}" style="width:${pct}%"></div></div>
          ${over ? `<p class="budget-over">Over budget</p>` : `<p class="muted">${pct}% used</p>`}
        ` : ""}
        <div style="margin-top:12px">
          ${Object.values(overview.perLedger).map(l => `
            <div class="tx-row"><span>${l.name}</span><span>${l.currency} ${l.spend.toFixed(2)}${l.currency !== homeCurrency ? ` <span class="muted">(≈ ${homeCurrency} ${l.spendInHomeCurrency.toFixed(2)})</span>` : ""}</span></div>
          `).join("") || `<p class="muted">No ledgers flagged yet — go to the Ledgers tab and tick "Include in my budget" on the ones you want counted.</p>`}
        </div>
      ` : `<p class="muted">Tap refresh to calculate.</p>`}
      <button id="btnRefreshOverview" class="secondary" style="margin-top:10px">🔄 Refresh</button>
    </div>
    ${bottomNav("home")}`;
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
