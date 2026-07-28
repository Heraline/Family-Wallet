// currency.js — live exchange rates via frankfurter.dev (free, no API key
// needed, published by the European Central Bank). Cached in localStorage
// for 6 hours so we don't re-fetch on every render.
// Note: the old address api.frankfurter.app now redirects to api.frankfurter.dev,
// and browsers block that kind of cross-origin redirect — so we call the new
// address directly.

const CACHE_KEY = "tb_fx_cache_v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; }
}
function saveCache(cache) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* storage unavailable — fine, just won't persist */ }
}

let cache = loadCache(); // { [baseCurrency]: { rates: {...}, fetchedAt } }

async function getRatesForBase(base) {
  const entry = cache[base];
  if (entry && Date.now() - entry.fetchedAt < CACHE_TTL_MS) return entry.rates;
  try {
    const res = await fetch(