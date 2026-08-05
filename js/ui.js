// ui.js — plain, minimal rendering just to prove Phase 2 works end-to-end.
// This is NOT the final look — the 5-theme system from Phase 1 gets wired
// in during a later phase. Right now this only renders into <div id="app">.

import { S } from "./state.js";
import { can, isOwner, canDeleteTx, canRemoveMembers, canManageRoles, canDeleteLedger, canManageCategories, canManageTags, GRANTABLE_PERMISSIONS } from "./permissions.js";
import { currentYM } from "./budgets.js";
import { FREQUENCIES } from "./recurring.js";
import { computeBalances } from "./splits.js";
import { groupedCategories, EMOJI_PALETTE } from "./categories.js";
import { tagUsageCounts } from "./tags.js";
import { getGeminiKey } from "./receipt.js";
import { THEMES } from "./theme.js";

const app = document.getElementById("app");

export function render() {
  if (!S.user) return renderLogin();
  if (S.activeLedgerId) {
    if (S.view === "splits") return renderSplitsPage();
    return renderLedgerDetail();
  }
  if (S.view === "personalBudget") return renderPersonalBudget();
  if (S.view === "aiSettings") return renderAiSettings();
  if (S.view === "ledgers") return renderLedgerList();
  if (S.view === "homeSplits") return renderHomeSplitsPage();
  if (S.view === "wallet") return renderWalletPage();
  return renderHome();
}

function budgetProgress(pct, over) {
  if ((S.uiPrefs?.chartStyle || "donut") === "donut") {
    const r = 26, circumference = 2 * Math.PI * r;
    const offset = circumference - (pct / 100) * circumference;
    return `
      <div class="ring-wrap">
        <svg viewBox="0 0 60 60">
          <circle cx="30" cy="30" r="${r}" fill="none" stroke="var(--budget-track)" stroke-width="6" />
          <circle cx="30" cy="30" r="${r}" fill="none" stroke="${over ? "var(--budget-over)" : "var(--accent)"}" stroke-width="6"
            stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round" transform="rotate(-90 30 30)" />
        </svg>
        <span class="ring-pct">${pct}%</span>
      </div>`;
  }
  return `<div class="budget-bar-track"><div class="budget-bar-fill ${over ? "over" : ""}" style="width:${pct}%"></div></div>`;
}

function memberChips(memberEntries, group) {
  return memberEntries.map(([uid, m]) => `
    <button type="button" class="chip" data-group="${group}" data-uid="${uid}">${m.avatar || "🙂"} ${m.displayName}</button>
  `).join("");
}

// Rebuilds the equal-split-by-default amount inputs for a group of selected
// people. Called from index.js (not during a full render) whenever chip
// selection or the total amount changes — keeps typed form values intact.
export function splitAmountRowsHtml(uids, totalAmount, group) {
  if (!uids.length) return "";
  const share = (Number(totalAmount) || 0) / uids.length;
  return uids.map((uid) => {
    const m = S.members[uid];
    return `
      <div class="split-amt-row">
        <span>${m?.avatar || "🙂"} ${m?.displayName || uid}</span>
        <input type="number" step="0.01" class="split-amt-input" data-amt-group="${group}" data-amt-uid="${uid}" value="${share.toFixed(2)}" />
      </div>`;
  }).join("");
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

function categoryOptionsHtml(selectedLabel) {
  const { expense, income } = groupedCategories();
  const opt = (c) => `<option value="${c.label}" ${c.label === selectedLabel ? "selected" : ""}>${c.icon} ${c.label}</option>`;
  return `
    <optgroup label="Expense">${expense.map(opt).join("")}</optgroup>
    <optgroup label="Income">${income.map(opt).join("")}</optgroup>`;
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
        ${target > 0 ? budgetProgress(pct, over) : ""}
      ` : `<p class="muted">Set a personal budget target to see your overview here.</p>`}
      <p class="muted" style="margin-top:6px">Tap for details →</p>
    </div>

    <div id="btnHomeWalletCard" class="panel card-button" role="button" tabindex="0" style="margin-top:14px">
      <h3>💰 Wallet</h3>
      ${Object.keys(S.walletBalances || {}).length ? `
        <div class="btn-row" style="flex-wrap:wrap;gap:14px">
          ${Object.entries(S.walletBalances).map(([cur, amt]) => `<span class="balance" style="font-size:18px">${cur} ${amt.toFixed(2)}</span>`).join("")}
        </div>
      ` : `<p class="muted">No funds yet — tap to add some.</p>`}
      <p class="muted" style="margin-top:6px">Tap to manage →</p>
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
      <button id="btnHomeSplits" class="secondary" style="width:100%">🤝 Splits & Settle (all ledgers)</button>
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
  const prefs = S.uiPrefs || {};
  const themeBtn = (t) => `<button class="opt-btn ${prefs.theme === t.key ? "active" : ""}" data-set-theme="${t.key}">${t.label}</button>`;
  app.innerHTML = `
    <div class="topbar">
      <span>Settings</span>
      <button id="btnLogout" class="link">Log out</button>
    </div>

    <div class="panel">
      <h3>🎨 Appearance</h3>
      <p class="muted" style="margin-bottom:8px">Dark themes</p>
      <div class="btn-row" style="flex-wrap:wrap;margin-bottom:10px">${THEMES.dark.map(themeBtn).join("")}</div>
      <p class="muted" style="margin-bottom:8px">Light themes</p>
      <div class="btn-row" style="flex-wrap:wrap;margin-bottom:10px">${THEMES.light.map(themeBtn).join("")}</div>
      <p class="muted" style="margin-bottom:8px">Card style</p>
      <div class="btn-row" style="margin-bottom:10px">
        <button class="opt-btn ${prefs.cardStyle === "glass" ? "active" : ""}" data-set-card="glass">Glass / Blurred</button>
        <button class="opt-btn ${prefs.cardStyle === "flat" ? "active" : ""}" data-set-card="flat">Flat / Minimal</button>
      </div>
      <p class="muted" style="margin-bottom:8px">Budget progress style</p>
      <div class="btn-row">
        <button class="opt-btn ${prefs.chartStyle === "donut" ? "active" : ""}" data-set-chart="donut">Ring</button>
        <button class="opt-btn ${prefs.chartStyle === "bar" ? "active" : ""}" data-set-chart="bar">Bar</button>
      </div>
    </div>

    <div class="panel">
      <h3>🔑 AI Settings</h3>
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
        <select id="txCategory">${categoryOptionsHtml()}</select>
        <input id="txDesc" placeholder="Description (optional)" />

        <p class="muted" style="margin:6px 0 4px">Pay from (expenses only)</p>
        <select id="txAccount">
          <option value="">No account / Pending</option>
          <option value="wallet">🏦 Ledger Wallet (${ledger.currency || "USD"} ${(S.ledgerWalletBalance || 0).toFixed(2)} available)</option>
        </select>

        <button type="button" id="btnToggleSplit" class="secondary" style="margin-bottom:10px">➕ Split this expense (optional)</button>
        <div id="splitSection" class="sub-panel hidden">
          <p class="muted" style="margin-bottom:6px">Paid by <span class="muted">(none selected = you)</span></p>
          <div class="chip-row" id="payerChips">${memberChips(memberEntries, "payer")}</div>
          <div id="payerAmounts" class="split-amounts"></div>

          <p class="muted" style="margin:12px 0 6px">Split between</p>
          <div class="chip-row" id="splitChips">${memberChips(memberEntries, "split")}</div>
          <div id="splitAmounts" class="split-amounts"></div>
        </div>

        <p class="muted" style="margin:10px 0 6px">Tags (optional)</p>
        <div class="chip-row" id="tagChips">
          ${(S.tags || []).map(t => `<button type="button" class="chip tag-chip" data-tag="${t}">🏷️ ${t}</button>`).join("")}
        </div>
        <div class="btn-row" style="margin-bottom:10px">
          <input id="newTagInput" placeholder="New tag..." style="flex:1" />
          <button type="button" id="btnAddTagChip" class="secondary">Add</button>
        </div>

        <button id="btnAddTx">Add</button>
      </div>

      <h3>Recent activity</h3>
      <div class="tx-list">
        ${txs.length ? txs.map(([id, t]) => `
          <div class="tx-row">
            <span>${t.fromRecurringId ? "🔄 " : ""}${t.account === "wallet" ? "🏦 " : ""}${t.category}${t.description ? " — " + t.description : ""}${t.tags?.length ? ` <span class="muted">${t.tags.map(x => "#" + x).join(" ")}</span>` : ""}</span>
            <span class="${t.type}">
              ${t.type === "income" ? "+" : "-"}${(t.origAmount ?? t.amount).toFixed(2)} ${t.origCurrency || t.currency}
              ${t.origCurrency && t.origCurrency !== t.currency ? `<span class="muted" style="font-weight:400"> (≈ ${t.currency} ${t.amount.toFixed(2)})</span>` : ""}
            </span>
            ${canDeleteTx(myMember, t, S.user.uid) ? `<button class="link small" data-del="${id}">delete</button>` : ""}
          </div>`).join("") : `<p class="muted">No transactions yet.</p>`}
      </div>

      ${renderLedgerWalletPanel(ledger)}
      ${renderLedgerBudgetPanel(ledger, myMember, txs)}
      ${renderCategoriesPanel(myMember, txs, ledger)}
      ${renderTagsPanel(myMember, txs)}
      ${renderRecurringPanel(myMember, ledger)}
      <button id="btnOpenSplits" class="secondary" style="width:100%;margin-bottom:16px">🤝 Splits & Settle</button>
      ${renderMembersPanel(memberEntries, myMember, iAmOwner)}
      ${renderSettingsPanel(ledger, myMember, iAmOwner)}
    </div>
  `;
}

function renderLedgerWalletPanel(ledger) {
  const balance = S.ledgerWalletBalance || 0;
  const currency = ledger.currency || "USD";

  return `
    <div class="panel">
      <h3>🏦 Ledger Wallet</h3>
      <p class="muted" style="margin-bottom:8px">Pooled money members fund in for this ledger's purpose — anyone can add to it, and expenses can be paid straight from it. Fund-ins show up in the activity feed above too.</p>
      <div class="balance" style="font-size:22px">${currency} ${balance.toFixed(2)}</div>

      <div id="ledgerFundError" class="error"></div>
      <div class="btn-row">
        <input id="ledgerFundAmount" type="number" step="0.01" placeholder="Amount (${currency})" style="flex:2" />
        <button id="btnFundLedgerWallet" style="flex:1">Fund it</button>
      </div>
      <input id="ledgerFundNote" placeholder="Note (optional)" />
    </div>`;
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
        ${budgetProgress(pct, over)}
        ${over ? `<p class="budget-over">Over budget</p>` : `<p class="muted">${pct}% used</p>`}
      ` : ""}
      ${canEdit ? `
        <div class="btn-row" style="margin-top:10px">
          <input id="ledgerBudgetInput" type="number" step="0.01" placeholder="Monthly target" value="${target || ""}" />
          <button id="btnSaveLedgerBudget">Save</button>
        </div>` : ""}
    </div>`;
}

function categoryRowHtml(c, canEdit, spentByCat, ledgerCurrency, isFirst, isLast) {
  const spent = spentByCat[c.label] || 0;
  const pct = c.budget ? Math.min(100, Math.round((spent / c.budget) * 100)) : null;
  return `
    <div class="cat-row">
      <button type="button" class="cat-emoji-btn" data-change-icon-key="${c.key}" ${canEdit ? "" : "disabled"}>${c.icon}</button>
      ${canEdit ? `
        <input class="cat-label-input" data-cat-field="label" data-cat-key="${c.key}" value="${c.label}" />
        <input class="cat-budget-input" type="number" step="0.01" data-cat-field="budget" data-cat-key="${c.key}" value="${c.budget || ""}" placeholder="Budget" />
        <div class="cat-row-actions">
          <button type="button" class="link small" data-move-cat="${c.key}" data-dir="up" ${isFirst ? "disabled" : ""}>↑</button>
          <button type="button" class="link small" data-move-cat="${c.key}" data-dir="down" ${isLast ? "disabled" : ""}>↓</button>
          <button type="button" class="link small" data-del-cat="${c.key}">🗑️</button>
        </div>
      ` : `<span class="cat-label-static">${c.label}</span>`}
    </div>
    ${pct !== null ? `
      <div class="cat-spend-line">
        <div class="budget-bar-track"><div class="budget-bar-fill ${pct >= 100 ? "over" : ""}" style="width:${pct}%"></div></div>
        <span class="muted">${ledgerCurrency} ${spent.toFixed(2)} / ${c.budget.toFixed(2)}</span>
      </div>` : (spent > 0 ? `<div class="cat-spend-line"><span class="muted">${ledgerCurrency} ${spent.toFixed(2)} spent this month</span></div>` : "")}`;
}

function renderCategoriesPanel(myMember, txs, ledger) {
  const canEdit = canManageCategories(myMember);
  const { expense, income } = groupedCategories();
  const ym = currentYM();
  const ledgerCurrency = ledger?.currency || "USD";
  const spentByCat = {};
  txs.forEach(([, t]) => {
    if (t.type === "expense" && t.date?.startsWith(ym)) spentByCat[t.category] = (spentByCat[t.category] || 0) + t.amount;
  });

  return `
    <div class="panel">
      <h3>🏷️ Categories</h3>

      <p class="muted" style="margin:6px 0 4px">Expense</p>
      <div class="cat-manage-list">
        ${expense.length ? expense.map((c, i) => categoryRowHtml(c, canEdit, spentByCat, ledgerCurrency, i === 0, i === expense.length - 1)).join("") : `<p class="muted">No expense categories.</p>`}
      </div>

      <p class="muted" style="margin:14px 0 4px">Income</p>
      <div class="cat-manage-list">
        ${income.length ? income.map((c, i) => categoryRowHtml(c, canEdit, spentByCat, ledgerCurrency, i === 0, i === income.length - 1)).join("") : `<p class="muted">No income categories.</p>`}
      </div>

      ${canEdit ? `
        <div class="sub-panel" style="margin-top:14px">
          <h4>Add category</h4>
          <div id="catError" class="error"></div>
          <input id="catName" placeholder="Category name" />
          <div class="btn-row" style="margin:6px 0 8px">
            <select id="catType" style="flex:1"><option value="expense">Expense</option><option value="income">Income</option></select>
          </div>
          <p class="muted" style="margin:0 0 4px">Icon</p>
          <div class="chip-row" id="catEmojiPicker">
            ${EMOJI_PALETTE.map((e, i) => `<button type="button" class="chip emoji-chip ${i === 0 ? "active" : ""}" data-emoji="${e}">${e}</button>`).join("")}
          </div>
          <button id="btnAddCategory">Add category</button>
        </div>

        <div class="chip-row hidden" id="catChangeIconPicker" style="margin-top:10px">
          ${EMOJI_PALETTE.map((e) => `<button type="button" class="chip" data-set-icon="${e}">${e}</button>`).join("")}
        </div>
      ` : ""}
    </div>`;
}

function renderTagsPanel(myMember, txs) {
  const canEdit = canManageTags(myMember);
  const counts = tagUsageCounts(Object.fromEntries(txs));
  const allTags = [...new Set([...(S.tags || []), ...Object.keys(counts)])].sort();

  return `
    <div class="panel">
      <h3>🏷️ Tags</h3>
      ${allTags.length ? allTags.map((tag) => `
        <div class="cat-row">
          ${canEdit
            ? `<input class="cat-label-input" data-tag-rename-old="${tag}" value="${tag}" style="flex:2" />`
            : `<span class="cat-label-static" style="flex:2">${tag}</span>`}
          <span class="muted" style="flex:0 0 auto;margin-right:8px">${counts[tag] || 0} tx</span>
          ${canEdit ? `<button class="link small" data-del-tag="${tag}">delete</button>` : ""}
        </div>
      `).join("") : `<p class="muted">No tags yet — add one while entering a transaction.</p>`}
    </div>`;
}


function renderRecurringPanel(myMember, ledger) {
  const canEdit = can(myMember, "manageRecurring");
  const items = Object.entries(S.recurring || {});
  const ledgerCurrency = ledger?.currency || "USD";
  return `
    <div class="panel">
      <h3>🔄 Recurring transactions</h3>
      ${items.length ? items.map(([id, r]) => `
        <div class="tx-row">
          <span>${r.name} <span class="muted">(${FREQUENCIES.find(f => f.key === r.freq)?.label || r.freq})</span></span>
          <span class="${r.type}">${r.type === "income" ? "+" : "-"}${r.amount.toFixed(2)} ${r.currency}</span>
          ${canEdit ? `<button class="link small" data-del-recurring="${id}">delete</button>` : ""}
        </div>
        <p class="muted" style="margin:-4px 0 6px">Next: ${r.stopped ? "ended" : r.nextDate}</p>
      `).join("") : `<p class="muted">No recurring transactions set up.</p>`}

      ${canEdit ? `
        <div class="sub-panel">
          <h4>Add recurring</h4>
          <div id="recurringError" class="error"></div>
          <input id="recurName" placeholder="Name (e.g. Netflix, Rent)" />
          <div class="btn-row">
            <select id="recurType" style="flex:1"><option value="expense">Expense</option><option value="income">Income</option></select>
            <input id="recurAmount" type="number" step="0.01" placeholder="Amount" style="flex:1" />
          </div>
          <select id="recurCategory">${categoryOptionsHtml()}</select>
          <div class="btn-row">
            <select id="recurFreq" style="flex:1">${FREQUENCIES.map(f => `<option value="${f.key}">${f.label}</option>`).join("")}</select>
            <select id="recurCurrency" style="flex:1">
              ${["USD", "MYR", "SGD", "EUR", "GBP", "JPY", "AUD"].map(c => `<option value="${c}" ${ledgerCurrency === c ? "selected" : ""}>${c}</option>`).join("")}
            </select>
          </div>
          <p class="muted" style="margin:6px 0 4px">Starts on</p>
          <input id="recurNextDate" type="date" value="${new Date().toISOString().slice(0, 10)}" />
          <p class="muted" style="margin:6px 0 4px">Ends (optional)</p>
          <div class="btn-row">
            <input id="recurEndDate" type="date" placeholder="End date" style="flex:1" />
            <input id="recurMaxOccurrences" type="number" placeholder="Or # of times" style="flex:1" />
          </div>
          <button id="btnAddRecurring" style="margin-top:8px">Add recurring</button>
        </div>` : ""}
    </div>`;
}

function nameOf(uid) { return S.members[uid] ? `${S.members[uid].avatar || "🙂"} ${S.members[uid].displayName}` : "Unknown"; }
function nameFrom(namesMap, uid) { return namesMap[uid] ? `${namesMap[uid].avatar || "🙂"} ${namesMap[uid].displayName}` : "Unknown"; }

function renderWalletPage() {
  const balances = S.walletBalances || {};
  const txList = Object.entries(S.walletTx || {}).sort((a, b) => b[1].ts - a[1].ts).slice(0, 15);
  const recurring = Object.entries(S.walletRecurring || {});
  const ledgerOptions = Object.entries(S.ledgers || {}).map(([lid, l]) => `<option value="${lid}">${l.icon || "💼"} ${l.name}</option>`).join("");
  const currencyOptions = (selected) => ["USD", "MYR", "SGD", "EUR", "GBP", "JPY", "AUD"].map(c => `<option value="${c}" ${c === selected ? "selected" : ""}>${c}</option>`).join("");

  app.innerHTML = `
    <div class="topbar">
      <button id="btnBackFromWallet" class="link">&larr; Home</button>
      <button id="btnLogout" class="link">Log out</button>
    </div>
    <h2>💰 Wallet</h2>
    <p class="muted" style="margin-bottom:12px">Real money you top up yourself — separate from ledger spending. Transfer some into a ledger whenever you want it available to spend.</p>

    <div class="panel">
      <h3>Balances</h3>
      ${Object.keys(balances).length ? `
        <div class="btn-row" style="flex-wrap:wrap;gap:18px;margin-bottom:4px">
          ${Object.entries(balances).map(([cur, amt]) => `<span class="balance" style="font-size:22px">${cur} ${amt.toFixed(2)}</span>`).join("")}
        </div>` : `<p class="muted">No funds yet.</p>`}
    </div>

    <div class="panel">
      <h3>Add funds</h3>
      <div id="walletAddError" class="error"></div>
      <div class="btn-row">
        <input id="walletAddAmount" type="number" step="0.01" placeholder="Amount" style="flex:2" />
        <select id="walletAddCurrency" style="flex:1">${currencyOptions("USD")}</select>
      </div>
      <input id="walletAddNote" placeholder="Note (e.g. Freelance payment)" />
      <button id="btnWalletAddFunds">Add funds</button>
    </div>

    <div class="panel">
      <h3>Fund a ledger's wallet</h3>
      <p class="muted" style="margin-bottom:8px">Same as funding it from inside that ledger — sends money in the ledger's own currency (no conversion yet).</p>
      <div id="walletTransferError" class="error"></div>
      ${ledgerOptions ? `
        <select id="walletTransferLedger">${ledgerOptions}</select>
        <input id="walletTransferAmount" type="number" step="0.01" placeholder="Amount (in that ledger's currency)" />
        <input id="walletTransferNote" placeholder="Note (optional)" />
        <button id="btnWalletTransfer">Fund it</button>
      ` : `<p class="muted">No ledgers yet — create one in the Ledgers tab first.</p>`}
    </div>

    <div class="panel">
      <h3>🔄 Recurring top-up <span class="muted" style="font-weight:400">(e.g. fixed pocket money)</span></h3>
      ${recurring.length ? recurring.map(([id, r]) => `
        <div class="tx-row">
          <span>${r.name} <span class="muted">(${r.freq})</span></span>
          <span class="income">+${r.amount.toFixed(2)} ${r.currency}</span>
          <button class="link small" data-del-wallet-recurring="${id}">delete</button>
        </div>
        <p class="muted" style="margin:-4px 0 6px">Next: ${r.stopped ? "ended" : r.nextDate}</p>
      `).join("") : `<p class="muted">None set up.</p>`}
      <div class="sub-panel">
        <h4>Add recurring top-up</h4>
        <div id="walletRecurError" class="error"></div>
        <input id="walletRecurName" placeholder="Name (e.g. Weekly allowance)" />
        <div class="btn-row">
          <input id="walletRecurAmount" type="number" step="0.01" placeholder="Amount" style="flex:2" />
          <select id="walletRecurCurrency" style="flex:1">${currencyOptions("USD")}</select>
        </div>
        <select id="walletRecurFreq">
          <option value="daily">Daily</option>
          <option value="weekly" selected>Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
        <p class="muted" style="margin:6px 0 4px">Starts on</p>
        <input id="walletRecurNextDate" type="date" value="${new Date().toISOString().slice(0, 10)}" />
        <p class="muted" style="margin:6px 0 4px">Ends (optional)</p>
        <div class="btn-row">
          <input id="walletRecurEndDate" type="date" style="flex:1" />
          <input id="walletRecurMaxOccurrences" type="number" placeholder="Or # of times" style="flex:1" />
        </div>
        <button id="btnAddWalletRecurring" style="margin-top:8px">Add recurring top-up</button>
      </div>
    </div>

    <div class="panel">
      <h3>History</h3>
      ${txList.length ? txList.map(([id, t]) => `
        <div class="tx-row">
          <span>${t.type === "topup" ? "💰" : "➡️"} ${t.type === "topup" ? (t.note || "Top-up") : `To ${t.toLedgerName}${t.note ? " — " + t.note : ""}`}</span>
          <span class="${t.type === "topup" ? "income" : "expense"}">${t.type === "topup" ? "+" : "-"}${t.amount.toFixed(2)} ${t.currency}</span>
        </div>
      `).join("") : `<p class="muted">No wallet activity yet.</p>`}
    </div>
    ${bottomNav("home")}`;
}


function renderHomeSplitsPage() {
  const overview = S.homeSplitsOverview;
  app.innerHTML = `
    <div class="topbar">
      <button id="btnBackFromHomeSplits" class="link">&larr; Home</button>
      <button id="btnLogout" class="link">Log out</button>
    </div>
    <h2>🤝 Splits & Settle</h2>

    ${overview ? `
      <div class="panel">
        <h3>Combined balances <span class="muted" style="font-weight:400">(net, in ${overview.homeCurrency})</span></h3>
        ${overview.combined.length ? overview.combined.map(b => `
          <div class="tx-row"><span>${nameFrom(overview.namesMap, b.from)} owes ${nameFrom(overview.namesMap, b.to)}</span><span class="expense">${overview.homeCurrency} ${b.amount.toFixed(2)}</span></div>
        `).join("") : `<p class="muted">All settled up across every ledger 🎉</p>`}
      </div>

      <div class="panel">
        <h3 style="margin-bottom:4px">Summary</h3>
        <div class="balance" style="font-size:22px">${overview.ledgersWithSplitsCount} of ${overview.totalLedgersChecked} ledgers</div>
        <p class="muted">have outstanding split balances</p>
      </div>
      <p class="muted" style="margin-bottom:12px">Each ledger's balances shown below in its own currency. To record a settlement, open that ledger's own Splits & Settle screen.</p>

      ${overview.perLedger.length ? overview.perLedger.map(l => `
        <div class="panel">
          <h4 style="margin-bottom:6px">${l.icon || "💼"} ${l.name}</h4>
          ${l.balances.map(b => `
            <div class="tx-row"><span>${nameFrom(overview.namesMap, b.from)} owes ${nameFrom(overview.namesMap, b.to)}</span><span class="expense">${l.currency} ${b.amount.toFixed(2)}</span></div>
          `).join("")}
        </div>
      `).join("") : ""}
    ` : `<p class="muted">Loading...</p>`}
    ${bottomNav("home")}`;
}

function renderSplitsPage() {
  const ledger = S.activeLedgerDetail || {};
  const balances = computeBalances(S.txs, S.settlements);
  const memberEntries = Object.entries(S.members || {});
  const settleLog = Object.entries(S.settlements || {}).sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0)).slice(0, 10);

  app.innerHTML = `
    <div class="topbar">
      <button id="btnBackFromSplits" class="link">&larr; ${ledger.name || "Ledger"}</button>
      <button id="btnLogout" class="link">Log out</button>
    </div>
    <h2>🤝 Splits & Settle</h2>

    <div class="panel">
      <h3>Balances</h3>
      ${balances.length ? balances.map(b => `
        <div class="tx-row"><span>${nameOf(b.from)} owes ${nameOf(b.to)}</span><span class="expense">${ledger.currency || "USD"} ${b.amount.toFixed(2)}</span></div>
      `).join("") : `<p class="muted">All settled up — no split expenses outstanding.</p>`}
    </div>

    <div class="panel">
      <h3>Record a settlement</h3>
      <div id="settleError" class="error"></div>
      <p class="muted" style="margin-bottom:4px">Who paid</p>
      <select id="settleFrom">${memberEntries.map(([uid, m]) => `<option value="${uid}">${m.avatar || "🙂"} ${m.displayName}</option>`).join("")}</select>
      <p class="muted" style="margin-bottom:4px">Paid to</p>
      <select id="settleTo">${memberEntries.map(([uid, m]) => `<option value="${uid}">${m.avatar || "🙂"} ${m.displayName}</option>`).join("")}</select>
      <input id="settleAmount" type="number" step="0.01" placeholder="Amount" />
      <input id="settleNote" placeholder="Note (optional)" />
      <button id="btnAddSettlement">Record settlement</button>
    </div>

    <div class="panel">
      <h3>Recent settlements</h3>
      ${settleLog.length ? settleLog.map(([id, s]) => `
        <div class="tx-row">
          <span>${nameOf(s.from)} → ${nameOf(s.to)}${s.note ? " — " + s.note : ""}</span>
          <span class="income">${ledger.currency || "USD"} ${s.amount.toFixed(2)}</span>
          <button class="link small" data-del-settlement="${id}">delete</button>
        </div>
      `).join("") : `<p class="muted">No settlements recorded yet.</p>`}
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
          ${budgetProgress(pct, over)}
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

    ${renderPersonalCategoryBudgetsPanel(overview, homeCurrency)}
    ${bottomNav("home")}`;
}

function renderPersonalCategoryBudgetsPanel(overview, homeCurrency) {
  const categorySpend = overview?.categorySpend || {};
  const catBudgets = S.personalCategoryBudgets || {};
  const liveLabels = new Set((overview?.availableCategories || []).map((c) => c.label));
  const rows = {}; // label -> { spent, budget }
  Object.entries(categorySpend).forEach(([label, spent]) => { rows[label] = { spent, budget: null }; });
  Object.values(catBudgets).forEach((c) => {
    if (!rows[c.label]) rows[c.label] = { spent: 0, budget: c.budget };
    else rows[c.label].budget = c.budget;
  });

  // A row is "stale" if it has a budget target set under a name that no
  // longer matches any live category in your flagged ledgers — usually
  // because that category got renamed in its ledger.
  const active = [], stale = [];
  Object.entries(rows).forEach(([label, r]) => {
    if (r.budget && !liveLabels.has(label)) stale.push([label, r]);
    else active.push([label, r]);
  });
  active.sort((a, b) => b[1].spent - a[1].spent);

  const catRowHtml = ([label, r]) => {
    const pct = r.budget ? Math.min(100, Math.round((r.spent / r.budget) * 100)) : null;
    return `
      <div class="cat-row">
        <span class="cat-label-static" style="flex:2">${label}</span>
        <input class="cat-budget-input" type="number" step="0.01" data-pcat-label="${label}" value="${r.budget || ""}" placeholder="Budget" />
      </div>
      <div class="cat-spend-line" style="margin-left:0">
        ${pct !== null ? `<div class="budget-bar-track"><div class="budget-bar-fill ${pct >= 100 ? "over" : ""}" style="width:${pct}%"></div></div>` : ""}
        <span class="muted">${homeCurrency} ${r.spent.toFixed(2)}${r.budget ? ` / ${r.budget.toFixed(2)}` : " spent this month"}</span>
      </div>`;
  };

  return `
    <div class="panel">
      <h3>Category budgets <span class="muted" style="font-weight:400">(combined, ${homeCurrency})</span></h3>
      ${active.length ? active.map(catRowHtml).join("") : `<p class="muted">No category spending yet from your flagged ledgers this month.</p>`}

      ${stale.length ? `
        <div class="sub-panel" style="margin-top:10px;border:1px dashed #d9455c">
          <h4>⚠️ Needs re-linking</h4>
          <p class="muted" style="margin-bottom:8px">These targets don't match a current category name in your ledgers — probably renamed. Pick the new name to keep the same budget amount, or delete it.</p>
          ${stale.map(([label, r]) => `
            <div class="cat-row" style="flex-wrap:wrap">
              <span class="cat-label-static" style="flex:2">${label} <span class="muted">(${homeCurrency} ${r.budget.toFixed(2)})</span></span>
            </div>
            <div class="btn-row" style="margin-bottom:10px">
              <select class="relink-select" data-relink-old="${label}" style="flex:2">
                <option value="">Pick new category name...</option>
                ${(overview?.availableCategories || []).map(c => `<option value="${c.label}">${c.icon} ${c.label}</option>`).join("")}
              </select>
              <button class="secondary" data-relink-apply="${label}">Apply</button>
              <button class="link small" data-del-pcat="${label}">delete</button>
            </div>
          `).join("")}
        </div>` : ""}

      <div class="sub-panel" style="margin-top:10px">
        <h4>Add a category target</h4>
        <div id="pcatError" class="error"></div>
        <div class="btn-row">
          <select id="pcatName" style="flex:2">
            ${overview?.availableCategories?.length
              ? overview.availableCategories.map(c => `<option value="${c.label}">${c.icon} ${c.label}</option>`).join("")
              : `<option value="">Flag a ledger first to see its categories</option>`}
          </select>
          <input id="pcatAmount" type="number" step="0.01" placeholder="Budget" style="flex:1" />
        </div>
        <button id="btnAddPersonalCatBudget" style="margin-top:6px">Set target</button>
      </div>
    </div>`;
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
