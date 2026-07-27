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
import { render } from "./ui.js";

onStateChange(render);

let unsubUserLedgers = null;

initAuthWatcher((user) => {
  unsubUserLedgers?.();
  if (user) unsubUserLedgers = listenUserLedgers();
  render();
});

// Event delegation: one listener handles all clicks/submits, since ui.js
// re-renders the whole #app div each time (simple + no memory leaks).
document.getElementById("app").addEventListener("click", async (e) => {
  const id = e.target.id;
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

    if (e.target.dataset.lid) switchLedger(e.target.dataset.lid), listenTransactions(e.target.dataset.lid);
    if (id === "btnBack") { S.activeLedgerId = null; render(); }

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
      const type = val("txType"), amount = val("txAmount"), category = val("txCategory"), description = val("txDesc");
      if (!amount || !category) return showError("txError", "Amount and category are required.");
      await addTransaction({ type, amount, category, description });
    }
    if (e.target.dataset.del) await deleteTransaction(e.target.dataset.del);

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
  } catch (err) {
    console.error(err);
    showError("authError", err.message) || showError("createError", err.message) ||
      showError("joinError", err.message) || showError("txError", err.message);
  }
});

function val(id) { return document.getElementById(id)?.value?.trim(); }
function showError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return false;
  el.textContent = msg;
  return true;
}

// Role changes and permission checkboxes fire "change", not "click".
document.getElementById("app").addEventListener("change", async (e) => {
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
  } catch (err) {
    console.error(err);
  }
});