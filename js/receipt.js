// receipt.js — AI receipt scanning, "bring your own API key" style (same
// approach as the old app): the person pastes their own free Gemini key,
// stored only in their own browser's localStorage. Never sent anywhere
// except directly from their browser to Google's API — we never see it,
// and there's no cost to us as the developer.

const KEY_STORAGE = "tb_gemini_key";

export function getGeminiKey() {
  return (localStorage.getItem(KEY_STORAGE) || "").trim();
}
export function setGeminiKey(key) {
  localStorage.setItem(KEY_STORAGE, key.trim());
}
export function clearGeminiKey() {
  localStorage.removeItem(KEY_STORAGE);
}

function todayStr() { return new Date().toISOString().slice(0, 10); }
function nowStr() { return new Date().toTimeString().slice(0, 5); }

function buildPrompt() {
  return `You are an expert receipt/invoice reader for a personal expense tracker app.
Analyze this image carefully. It may contain text in any language.
Extract the transaction details and return ONLY a valid JSON object with no markdown, no code fences:
{
  "amount": <number, the total amount paid — look for "TOTAL", or the largest final amount>,
  "description": <string, the merchant or store name, max 40 chars>,
  "category": <string, a short one-or-two-word category like "Groceries", "Dining", "Transport", "Shopping", "Utilities", or similar — pick the best fit>,
  "date": <string, YYYY-MM-DD format. Use today's date if not visible: ${todayStr()}>,
  "time": <string, HH:MM 24-hour format. Use current time if not visible: ${nowStr()}>,
  "currency": <string, 3-letter ISO code, e.g. USD, MYR, SGD. Best guess if not shown>
}
Rules: amount must be a plain number (no currency symbol, no commas). Return ONLY the JSON object, nothing else.`;
}

function extractJson(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  try { return JSON.parse(clean); } catch { /* fall through */ }
  const match = clean.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch { /* fall through */ } }
  throw new Error("Could not understand the AI's response. Try a clearer photo.");
}

// base64: raw base64 image data (no "data:image/...;base64," prefix)
export async function scanReceipt(base64, mimeType) {
  const key = getGeminiKey();
  if (!key) throw new Error("No Gemini API key saved yet — add one in AI Settings first.");

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mimeType, data: base64 } },
          { text: buildPrompt() },
        ] }],
      }),
    }
  );

  const responseText = await resp.text();
  if (!resp.ok) {
    let msg = `Gemini API error ${resp.status}`;
    try {
      const errJson = JSON.parse(responseText);
      msg = errJson?.error?.message || msg;
      if (resp.status === 400) msg = "Invalid request or unreadable image. " + msg;
      if (resp.status === 401 || resp.status === 403) msg = "Invalid Gemini key — check it in AI Settings.";
      if (resp.status === 429) msg = "Gemini rate limit reached — wait a moment and try again.";
      if (resp.status === 503) msg = "Gemini is temporarily unavailable — try again shortly.";
    } catch { /* use default msg */ }
    throw new Error(msg);
  }

  const data = JSON.parse(responseText);
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!text) throw new Error("Empty response from Gemini — try a clearer photo.");
  return extractJson(text);
}

// Reads a File object (from an <input type=file>) into raw base64 + mime type.
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result; // "data:image/jpeg;base64,AAAA..."
      const base64 = result.split(",")[1];
      resolve({ base64, mimeType: file.type || "image/jpeg" });
    };
    reader.onerror = () => reject(new Error("Could not read the selected photo."));
    reader.readAsDataURL(file);
  });
}
