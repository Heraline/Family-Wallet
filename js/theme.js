// theme.js — appearance preferences (color theme, card style, chart style),
// synced to the user's account so it's the same across devices.

import { listen, writeUpdate } from "./firebase.js";
import { S, notify } from "./state.js";

export const THEMES = {
  dark: [
    { key: "teal", label: "Teal Glass" },
    { key: "neon", label: "Neon Smart-Home" },
  ],
  light: [
    { key: "fintech", label: "Fintech Pink" },
    { key: "orb", label: "AI Orb Purple" },
    { key: "blue", label: "Social Blue" },
  ],
};

export function listenThemePrefs() {
  return listen(`users/${S.user.uid}/uiPrefs`, (data) => {
    S.uiPrefs = { theme: "teal", cardStyle: "glass", chartStyle: "donut", ...(data || {}) };
    applyTheme();
    notify();
  });
}

export async function setThemePref(key, value) {
  await writeUpdate(`users/${S.user.uid}/uiPrefs`, { [key]: value });
}

// Applies the current theme/card-style as data-attributes on <body>, which
// style.css reads to pick the right CSS variables. Safe to call anytime —
// falls back to defaults if prefs haven't loaded yet.
export function applyTheme() {
  const prefs = S.uiPrefs || { theme: "teal", cardStyle: "glass", chartStyle: "donut" };
  document.body.dataset.theme = prefs.theme;
  document.body.dataset.card = prefs.cardStyle;
  document.body.dataset.chart = prefs.chartStyle;
}
