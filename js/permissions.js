// permissions.js — the ONLY place that decides "can this person do X?"
// Every other file asks THIS file instead of checking role strings itself.
// That way, if the permission rules ever change, this is the one file to edit.

// Actions an Owner can grant to a Moderator, individually, per person.
export const GRANTABLE_PERMISSIONS = [
  { key: "renameLedger", label: "Rename ledger / change icon" },
  { key: "regenerateInvite", label: "Regenerate invite code" },
  { key: "manageGuests", label: "Add / manage guest members" },
  { key: "deleteOthersTx", label: "Delete other members' transactions" },
  { key: "removeMembers", label: "Remove members from the ledger" },
  { key: "manageBudget", label: "Set the ledger's monthly budget" },
  { key: "manageRecurring", label: "Set up recurring transactions" },
  { key: "manageCategories", label: "Add/edit categories & category budgets" },
  { key: "manageTags", label: "Rename/delete tags" },
];

// Things ONLY the Owner can ever do, no matter what — never grantable.
export function isOwner(member) {
  return member?.role === "owner";
}

export function can(member, actionKey) {
  if (!member) return false;
  if (member.role === "owner") return true;
  if (member.role === "moderator") return !!member.permissions?.[actionKey];
  return false;
}

export function canDeleteTx(member, tx, myUid) {
  if (!member) return false;
  if (tx.addedBy === myUid) return true; // everyone can delete their own entries
  return can(member, "deleteOthersTx");
}

export function canRemoveMembers(member) { return can(member, "removeMembers"); }
export function canManageBudget(member) { return can(member, "manageBudget"); }
export function canManageRecurring(member) { return can(member, "manageRecurring"); }
export function canManageCategories(member) { return can(member, "manageCategories"); }
export function canManageTags(member) { return can(member, "manageTags"); }
export function canDeleteLedger(member) { return isOwner(member); }
export function canManageRoles(member) { return isOwner(member); } // promoting/demoting stays Owner-only — more sensitive than removing
