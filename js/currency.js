// currency.js — live exchange rates via frankfurter.app (free, no API key
// needed, published by the European Central Bank). Cached in localStorage
// for 6 hours so we don't re-fetch on every render.

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
    const res = await fetch(`https://api.frankfurter.app/latest?from=${base}`);
    const data = await res.json();
    const rates = { ...data.rates, [base]: 1 };
    cache[base] = { rates, fetchedAt: Date.now() };
    saveCache(cache);
    return rates;
  } catch (err) {
    console.error("Exchange rate fetch failed — using last cached rates if any:", err);
    return entry?.rates || null; // fall back to stale cache rather than breaking the app
  }
}

// Convert `amount` from one currency to another using live rates.
// Returns null if conversion isn't possible right now (e.g. offline, no cache yet).
export async function convert(amount, from, to) {
  if (from === to) return amount;
  const rates = await getRatesForBase(from);
  if (!rates || rates[to] == null) return null;
  return amount * rates[to];
}

export async function getRate(from, to) {
  if (from === to) return 1;
  const rates = await getRatesForBase(from);
  return rates ? (rates[to] ?? null) : null;
}
