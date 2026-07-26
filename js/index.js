// index.js — the entry point. Wires together auth, ledgers, transactions,
// and ui.js. Keep this file thin — it should mostly just connect event
// clicks to the functions defined in the other modules.

import { S, onStateChange } from "./state.js";
import { initAuthWatcher, register, login, logout } from "./auth.js";
import { createLedger, joinLedgerByCode, switchLedger, listenUserLedgers } from "./ledgers.js";
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
