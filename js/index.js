// index.js — the entry point. Wires together auth, ledgers, transactions,
// and ui.js. Keep this file thin — it should mostly just connect event
// clicks to the functions defined in the other modules.

import { S, onStateChange } from "./state.js";
import { initAuthWatcher, register, login, logout } from "./auth.js";
import {
  createLedger, joinLedgerByCode, switchLedger, listenUserLedgers,
  renameLedger, regenerateInviteCode, addGuest, removeGuest,
  setMemberRole, setModeratorPermissions, removeMember, leaveLedger, deleteLedger,
} from "./ledgers.js";
import { listenTransactions, addTransaction, deleteTransaction } from "./transactions.js";
import {
  listenPersonalBudget, setPersonalBudget, listenIncludedLedgers, setLedgerIncluded,
  listenLedgerBudget, setLedgerBudget, refreshPersonalOverview,
} from "./budgets.js";
import { setBudgetUnsub } from "./ledgers.js";
import { getGeminiKey, setGeminiKey, clearGeminiKey, scanReceipt, fileToBase64 } from "./receipt.js";
import { listenThemePrefs, setThemePref, applyTheme } from "./theme.js";
import { listenRecurring, addRecurring, deleteRecurring, processDueRecurring } from "./recurring.js";
import { listenSettlements, addSettlement, deleteSettlement } from "./splits.js";
import { render, splitAmountRowsHtml } from "./ui.js";

onStateChange((s) => { applyTheme(); render(s); });

let unsubUserLedgers = null;
let unsubPersonalBudget = null;
let unsubIncluded = null;
let unsubTheme = null;

initAuthWatcher((user) => {
  unsubUserLedgers?.(); unsubPersonalBudget?.(); unsubIncluded?.(); unsubTheme?.();
  if (user) {
    unsubUserLedgers = listenUserLedgers();
    unsubPersonalBudget = listenPersonalBudget();
    unsubIncluded = listenIncludedLedgers();
    unsubTheme = listenThemePrefs();
    refreshHomeOverview();
  }
  applyTheme();
  render();
});

function refreshHomeOverview() {
  const homeCurrency = S.personalBudget?.homeCurrency || "USD";
  refreshPersonalOverview(homeCurrency).catch((err) => console.error("Overview refresh failed:", err));
}

function goTo(view) {
  S.activeLedgerId = null;
  S.view = view;
  if (view === "home") refreshHomeOverview();
  render();
}

// Event delegation: one listener handles all clicks/submits, since ui.js
// re-renders the whole #app div each time (simple + no memory leaks).
document.getElementById("app").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  const id = btn ? btn.id : "";
  try {
    if (id === "btnLogin") {
      const email = val("authEmail"), pass = val("authPass");
      await login(email, pass);
    }
    if (id === "btnSignup") {
      const name = val("authName"), email = val("authEmail"), pass = val("authPass");
      await register(email, pass, name || "User");
    }
    if (id === "btnLogout") await logout();

    const navBtn = e.target.closest?.("[data-nav]");
    if (navBtn) goTo(navBtn.dataset.nav);

    if (e.target.closest?.("#btnHomeBudgetCard")) goTo("personalBudget");

    if (e.target.dataset.lid) {
      switchLedger(e.target.dataset.lid);
      listenTransactions(e.target.dataset.lid);
      setBudgetUnsub(listenLedgerBudget(e.target.dataset.lid));
      listenRecurring(e.target.dataset.lid);
      processDueRecurring(e.target.dataset.lid).catch((err) => console.error("Recurring processing failed:", err));
      listenSettlements(e.target.dataset.lid);
    }
    if (id === "btnBack") { S.activeLedgerId = null; S.view = "ledgers"; render(); }
    if (id === "btnBackFromBudget") goTo("home");
    if (id === "btnOpenSplits") { S.view = "splits"; render(); }
    if (id === "btnBackFromSplits") { S.view = null; render(); }
    if (id === "btnAddSettlement") {
      const from = val("settleFrom"), to = val("settleTo"), amount = val("settleAmount"), note = val("settleNote");
      if (from === to) return showError("settleError", "Pick two different people.");
      if (!amount || Number(amount) <= 0) return showError("settleError", "Enter a valid amount.");
      await addSettlement(S.activeLedgerId, { from, to, amount, note });
      render();
    }
    if (e.target.dataset.delSettlement) {
      if (confirm("Delete this settlement record?")) await deleteSettlement(S.activeLedgerId, e.target.dataset.delSettlement);
    }
    if (id === "btnSaveAiKey") {
      const key = val("geminiKeyInput");
      if (!key) return showError("aiKeyError", "Paste a key first.");
      setGeminiKey(key);
      render();
    }
    if (id === "btnClearAiKey") { clearGeminiKey(); render(); }
    if (id === "btnScanReceipt") { document.getElementById("receiptFileInput").click(); }

    const themeBtn = e.target.closest?.("[data-set-theme]");
    if (themeBtn) await setThemePref("theme", themeBtn.dataset.setTheme);
    const cardBtn = e.target.closest?.("[data-set-card]");
    if (cardBtn) await setThemePref("cardStyle", cardBtn.dataset.setCard);
    const chartBtn = e.target.closest?.("[data-set-chart]");
    if (chartBtn) await setThemePref("chartStyle", chartBtn.dataset.setChart);

    if (id === "btnCreateLedger") {
      const name = val("newLedgerName");
      if (!name) return showError("createError", "Enter a name first.");
      await createLedger(name);
      document.getElementById("newLedgerName").value = "";
    }
    if (id === "btnJoinLedger") {
      const code = val("joinCode");
      if (!code) return showError("joinError", "Enter an invite code.");
      await joinLedgerByCode(code);
    }
    if (id === "btnAddTx") {
      const type = val("txType"), amount = val("txAmount"), category = val("txCategory"), description = val("txDesc"), currency = val("txCurrency");
      if (!amount || !category) return showError("txError", "Amount and category are required.");

      const payerUids = Array.from(document.querySelectorAll('.chip[data-group="payer"].active')).map((c) => c.dataset.uid);
      const splitUids = Array.from(document.querySelectorAll('.chip[data-group="split"].active')).map((c) => c.dataset.uid);
      let payers, splitAmounts;
      if (payerUids.length >= 2) {
        payers = {};
        payerUids.forEach((uid) => {
          const input = document.querySelector(`.split-amt-input[data-amt-group="payer"][data-amt-uid="${uid}"]`);
          payers[uid] = Number(input?.value) || 0;
        });
        const payerSum = Object.values(payers).reduce((a, b) => a + b, 0);
        if (Math.abs(payerSum - Number(amount)) > 0.01) {
          return showError("txError", `"Paid by" amounts add up to ${payerSum.toFixed(2)}, but the total is ${Number(amount).toFixed(2)}.`);
        }
      } else if (payerUids.length === 1) {
        payers = { [payerUids[0]]: Number(amount) };
      }
      if (splitUids.length >= 1) {
        splitAmounts = {};
        splitUids.forEach((uid) => {
          const input = document.querySelector(`.split-amt-input[data-amt-group="split"][data-amt-uid="${uid}"]`);
          splitAmounts[uid] = Number(input?.value) || 0;
        });
        const splitSum = Object.values(splitAmounts).reduce((a, b) => a + b, 0);
        if (Math.abs(splitSum - Number(amount)) > 0.01) {
          return showError("txError", `"Split between" amounts add up to ${splitSum.toFixed(2)}, but the total is ${Number(amount).toFixed(2)}.`);
        }
      }

      await addTransaction({ type, amount, category, description, currency, payers, splitAmounts });
    }
    if (id === "btnToggleSplit") document.getElementById("splitSection")?.classList.toggle("hidden");
    const chip = e.target.closest?.(".chip");
    if (chip) { chip.classList.toggle("active"); rebuildSplitAmounts(chip.dataset.group); }
    if (e.target.dataset.del) await deleteTransaction(e.target.dataset.del);

    if (id === "btnAddRecurring") {
      const name = val("recurName"), type = val("recurType"), amount = val("recurAmount"),
        category = val("recurCategory"), freq = val("recurFreq"), nextDate = val("recurNextDate"),
        endDate = val("recurEndDate"), maxOccurrences = val("recurMaxOccurrences"), currency = val("recurCurrency");
      if (!name || !amount || !category || !nextDate) return showError("recurringError", "Name, amount, category, and start date are required.");
      await addRecurring(S.activeLedgerId, {
        name, type, amount, category, freq, nextDate, endDate, maxOccurrences, currency,
      });
    }
    if (e.target.dataset.delRecurring) {
      if (confirm("Delete this recurring transaction? Past entries it already created will stay.")) {
        await deleteRecurring(S.activeLedgerId, e.target.dataset.delRecurring);
      }
    }

    if (id === "btnRenameLedger") {
      const name = val("ledgerNameInput"), icon = val("ledgerIconInput");
      if (!name) return showError("renameError", "Enter a ledger name.");
      await renameLedger(S.activeLedgerId, name, icon || "💼");
    }
    if (id === "btnRegenInvite") {
      if (confirm("Old invite code will stop working. Continue?")) await regenerateInviteCode(S.activeLedgerId);
    }
    if (id === "btnAddGuest") {
      const name = val("guestName");
      if (!name) return showError("guestError", "Enter a guest name.");
      await addGuest(S.activeLedgerId, name);
      document.getElementById("guestName").value = "";
    }
    if (e.target.dataset.removeGuest) await removeGuest(S.activeLedgerId, e.target.dataset.removeGuest);
    if (e.target.dataset.removeUid) {
      if (confirm("Remove this member from the ledger?")) await removeMember(S.activeLedgerId, e.target.dataset.removeUid);
    }
    if (id === "btnLeaveLedger") {
      if (confirm("Leave this ledger? You'll need a new invite to rejoin.")) {
        await leaveLedger(S.activeLedgerId, S.user.uid);
        S.activeLedgerId = null;
        render();
      }
    }
    if (id === "btnDeleteLedger") {
      if (confirm("Delete this ledger permanently for everyone? This cannot be undone.")) {
        await deleteLedger(S.activeLedgerId);
        S.activeLedgerId = null;
        render();
      }
    }

    if (id === "btnSaveLedgerBudget") {
      const total = val("ledgerBudgetInput");
      if (total) await setLedgerBudget(S.activeLedgerId, total);
    }
    if (id === "btnSavePersonalBudget") {
      const total = val("personalBudgetTotal"), homeCurrency = val("personalHomeCurrency");
      if (total) {
        await setPersonalBudget(total, homeCurrency);
        await refreshPersonalOverview(homeCurrency);
      }
    }
    if (id === "btnRefreshOverview") {
      const homeCurrency = val("personalHomeCurrency") || S.personalBudget?.homeCurrency || "USD";
      await refreshPersonalOverview(homeCurrency);
    }
  } catch (err) {
    console.error(err);
    showError("authError", err.message) || showError("createError", err.message) ||
      showError("joinError", err.message) || showError("txError", err.message) ||
      showError("recurringError", err.message) || showError("guestError", err.message) ||
      showError("settleError", err.message);
  }
});

function val(id) { return document.getElementById(id)?.value?.trim(); }
function showError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return false;
  el.textContent = msg;
  return true;
}

// Redraws the equal-split amount inputs for whichever group (payer/split)
// just had a chip toggled, based on currently-active chips + the amount
// typed so far. Direct DOM update (not a full render()) so nothing else
// in the form gets wiped while someone's mid-entry.
function rebuildSplitAmounts(group) {
  const container = document.getElementById(group === "payer" ? "payerAmounts" : "splitAmounts");
  if (!container) return;
  const uids = Array.from(document.querySelectorAll(`.chip[data-group="${group}"].active`)).map((c) => c.dataset.uid);
  const totalAmount = document.getElementById("txAmount")?.value || 0;
  // A single payer doesn't need a custom-amount input (they're implicitly paying it all);
  // 2+ payers, or any number of split-between people, do.
  if (group === "payer" && uids.length < 2) { container.innerHTML = ""; return; }
  container.innerHTML = splitAmountRowsHtml(uids, totalAmount, group);
}

// Role changes and permission checkboxes fire "change", not "click".
document.getElementById("app").addEventListener("change", async (e) => {
  const id = e.target.id;
  try {
    if (e.target.dataset.roleUid) {
      const uid = e.target.dataset.roleUid, role = e.target.value;
      await setMemberRole(S.activeLedgerId, uid, role, role === "moderator" ? {} : null);
    }
    if (e.target.dataset.permUid) {
      const uid = e.target.dataset.permUid, key = e.target.dataset.permKey;
      const member = S.members[uid];
      const perms = { ...(member?.permissions || {}), [key]: e.target.checked };
      await setModeratorPermissions(S.activeLedgerId, uid, perms);
    }
    if (id === "previewRoleSelect") {
      S.debugPreviewRole = e.target.value || null;
      render();
    }
    if (id === "txAmount") { rebuildSplitAmounts("payer"); rebuildSplitAmounts("split"); }
    if (e.target.dataset.includeLid) {
      await setLedgerIncluded(e.target.dataset.includeLid, e.target.checked);
      refreshHomeOverview();
    }
    if (id === "receiptFileInput") {
      const file = e.target.files[0];
      if (!file) return;
      const statusEl = document.getElementById("scanStatus");
      if (statusEl) statusEl.style.display = "block";
      showError("txError", "");
      try {
        const { base64, mimeType } = await fileToBase64(file);
        const parsed = await scanReceipt(base64, mimeType);
        const amountEl = document.getElementById("txAmount");
        const categoryEl = document.getElementById("txCategory");
        const descEl = document.getElementById("txDesc");
        const currencyEl = document.getElementById("txCurrency");
        if (amountEl) amountEl.value = parsed.amount ?? "";
        if (categoryEl) categoryEl.value = parsed.category ?? "";
        if (descEl) descEl.value = parsed.description ?? "";
        if (currencyEl && parsed.currency) {
          const hasOption = Array.from(currencyEl.options).some((o) => o.value === parsed.currency);
          if (hasOption) currencyEl.value = parsed.currency;
        }
      } catch (err) {
        showError("txError", err.message);
      } finally {
        if (statusEl) statusEl.style.display = "none";
        e.target.value = ""; // allow re-selecting the same photo again later
      }
    }
  } catch (err) {
    console.error(err);
  }
});
