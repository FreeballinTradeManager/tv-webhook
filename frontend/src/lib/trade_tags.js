// Task #75 — Per-trade emotional / mistake / freeform tags.
//
// Localstorage-backed for MVP since backend #40 isn't shipped yet.
// Shape: { [tradeId]: string[] }  — an array of tag slugs per trade.
// Portable to a trade_tags table later (same schema).

const KEY = "tradecore_trade_tags_v1";

// Curated vocabularies. Adding new tags here surfaces them in the
// picker without touching every callsite.
// Kept to 4 tags on purpose (user-locked labels) — every trade fits
// into one of these process states. Anything more specific goes into
// a freeform hashtag via the "add your own" input in the picker.
export const EMOTION_TAGS = [
  { slug: "prepared",  label: "Prepared",  color: "bg-emerald-600 text-white" },
  { slug: "confident", label: "Confident", color: "bg-blue-600 text-white"    },
  { slug: "guessing",  label: "Guessing",  color: "bg-slate-600 text-white"   },
  { slug: "impulsive", label: "Impulsive", color: "bg-red-600 text-white"     },
];

export const MISTAKE_TAGS = [
  { slug: "no-stop",         label: "No stop",         color: "bg-red-600 text-white" },
  { slug: "chased",          label: "Chased entry",    color: "bg-red-600 text-white" },
  { slug: "oversize",        label: "Oversize",        color: "bg-red-600 text-white" },
  { slug: "moved-sl",        label: "Moved SL",        color: "bg-red-600 text-white" },
  { slug: "ignored-rules",   label: "Ignored rules",   color: "bg-red-600 text-white" },
  { slug: "revenge-trade",   label: "Revenge trade",   color: "bg-red-600 text-white" },
  { slug: "news-trade",      label: "Traded through news", color: "bg-red-600 text-white" },
  { slug: "illiquid",        label: "Illiquid session", color: "bg-slate-600 text-white" },
  { slug: "held-too-long",   label: "Held too long",   color: "bg-slate-600 text-white" },
  { slug: "closed-too-early",label: "Closed too early",color: "bg-slate-600 text-white" },
];

// Combined lookup for pill rendering (any known tag → its meta).
const KNOWN_TAGS = new Map(
  [...EMOTION_TAGS, ...MISTAKE_TAGS].map(t => [t.slug, t])
);

// Freeform tags render as blue #hashtags.
export function tagMeta(slug) {
  if (KNOWN_TAGS.has(slug)) return KNOWN_TAGS.get(slug);
  return { slug, label: `#${slug}`, color: "bg-blue-600 text-white" };
}

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function writeAll(m) {
  localStorage.setItem(KEY, JSON.stringify(m));
}

export function getTags(tradeId) {
  if (tradeId == null) return [];
  const all = readAll();
  return Array.isArray(all[tradeId]) ? all[tradeId] : [];
}

export function setTags(tradeId, tags) {
  if (tradeId == null) return;
  const all = readAll();
  if (!tags || tags.length === 0) delete all[tradeId];
  else all[tradeId] = tags;
  writeAll(all);
}

export function toggleTag(tradeId, slug) {
  const cur = getTags(tradeId);
  const next = cur.includes(slug) ? cur.filter(t => t !== slug) : [...cur, slug];
  setTags(tradeId, next);
  return next;
}

// Return the set of ALL tag slugs the user has ever applied — used
// to populate the freeform-history and the filter dropdown.
export function allUsedTags() {
  const all = readAll();
  const set = new Set();
  Object.values(all).forEach(arr => (arr || []).forEach(t => set.add(t)));
  return [...set];
}

// Filter helper for the Trades page — "does this trade have any of
// these tags?"
export function tradeHasAnyTag(tradeId, wantedSlugs) {
  if (!wantedSlugs || wantedSlugs.length === 0) return true;
  const cur = getTags(tradeId);
  return wantedSlugs.some(w => cur.includes(w));
}
