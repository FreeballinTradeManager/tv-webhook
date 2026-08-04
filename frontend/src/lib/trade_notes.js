// Task #49 — Per-trade notes + screenshot gallery.
//
// Storage shape (localStorage MVP, portable to backend #40):
//   { [tradeId]: { notes: string, images: string[] /* base64 dataURLs */ } }
//
// Kept in a SEPARATE key from trade_tags so gallery bloat doesn't
// evict tag data (localStorage is a shared quota per origin — 5-10MB).

const KEY = "tradecore_trade_notes_v1";
const MAX_IMG_BYTES = 2 * 1024 * 1024;   // 2MB per image

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function writeAll(m) {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
    return true;
  } catch (e) {
    // Storage quota exceeded — probably too many images. Surface to caller.
    return false;
  }
}

export function getNotes(tradeId) {
  if (tradeId == null) return { notes: "", images: [], mae: null, mfe: null };
  const all = readAll();
  const entry = all[tradeId] || {};
  return {
    notes:  typeof entry.notes  === "string" ? entry.notes  : "",
    images: Array.isArray(entry.images) ? entry.images : [],
    // Task #88 — MAE / MFE. Positive numbers, in $ (or whatever unit
    // matches profit_loss). null = not recorded.
    mae: typeof entry.mae === "number" ? entry.mae : null,
    mfe: typeof entry.mfe === "number" ? entry.mfe : null,
  };
}

// Task #88 — set MAE (max adverse excursion) + MFE (max favorable excursion)
// for a single trade. Called from the TradeNotesRow inputs.
export function setExcursions(tradeId, { mae, mfe }) {
  if (tradeId == null) return;
  const all = readAll();
  const cur = all[tradeId] || {};
  if (mae === null || mae === "") delete cur.mae; else if (typeof mae === "number") cur.mae = mae;
  if (mfe === null || mfe === "") delete cur.mfe; else if (typeof mfe === "number") cur.mfe = mfe;
  const empty = !cur.notes && !(cur.images || []).length && cur.mae == null && cur.mfe == null;
  if (empty) delete all[tradeId];
  else all[tradeId] = cur;
  writeAll(all);
}

export function setNotesText(tradeId, notes) {
  if (tradeId == null) return;
  const all = readAll();
  const cur = all[tradeId] || {};
  cur.notes = notes || "";
  if (!cur.notes && !(cur.images || []).length) delete all[tradeId];
  else all[tradeId] = cur;
  writeAll(all);
}

export function addImage(tradeId, dataUrl) {
  if (tradeId == null || !dataUrl) return { ok: false, reason: "missing" };
  const all = readAll();
  const cur = all[tradeId] || { notes: "", images: [] };
  cur.images = [...(cur.images || []), dataUrl];
  all[tradeId] = cur;
  if (!writeAll(all)) return { ok: false, reason: "quota" };
  return { ok: true, images: cur.images };
}

export function removeImage(tradeId, index) {
  if (tradeId == null) return [];
  const all = readAll();
  const cur = all[tradeId] || { notes: "", images: [] };
  cur.images = (cur.images || []).filter((_, i) => i !== index);
  if (!cur.notes && cur.images.length === 0) delete all[tradeId];
  else all[tradeId] = cur;
  writeAll(all);
  return cur.images;
}

// Turn a File into a data URL, with a size guard. Same pattern used by
// the Daily Journal image slots + Vault avatar upload.
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error("no file"));
    if (file.size > MAX_IMG_BYTES) {
      return reject(new Error(`image too large (${(file.size/1024/1024).toFixed(1)}MB) — keep under 2MB`));
    }
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
}
