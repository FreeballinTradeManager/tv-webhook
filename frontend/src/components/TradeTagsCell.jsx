import React, { useState, useEffect } from "react";
import {
  EMOTION_TAGS, MISTAKE_TAGS, tagMeta,
  getTags, setTags, toggleTag,
} from "@/lib/trade_tags";
import { Tag, Plus, X as XIcon } from "lucide-react";

// Task #75 — Compact tag pills + inline picker for a single trade row.
// Rendered in a table cell on the Trades page. Click any pill or the
// "+" chip to open the picker popover. Persists to localStorage until
// backend #40 ships.
export default function TradeTagsCell({ tradeId }) {
  const [tags, setTagsState] = useState(() => getTags(tradeId));
  const [open, setOpen] = useState(false);
  const [freeform, setFreeform] = useState("");

  // Keep in sync if tradeId changes (e.g. re-render).
  useEffect(() => setTagsState(getTags(tradeId)), [tradeId]);

  const toggle = (slug) => {
    const next = toggleTag(tradeId, slug);
    setTagsState(next);
  };
  const remove = (slug) => {
    const next = tags.filter(t => t !== slug);
    setTags(tradeId, next);
    setTagsState(next);
  };
  const addFreeform = () => {
    const slug = freeform.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!slug) return;
    if (!tags.includes(slug)) {
      const next = [...tags, slug];
      setTags(tradeId, next);
      setTagsState(next);
    }
    setFreeform("");
  };

  return (
    <div className="relative inline-flex items-center gap-1 flex-wrap">
      {tags.map(slug => {
        const m = tagMeta(slug);
        return (
          <span key={slug}
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${m.color}`}>
            {m.label}
            <button onClick={() => remove(slug)} className="hover:text-white/70" title="Remove">
              <XIcon className="w-2.5 h-2.5"/>
            </button>
          </span>
        );
      })}
      <button onClick={() => setOpen(o => !o)}
              className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 hover:text-white hover:bg-slate-800 border border-dashed border-slate-700"
              title="Add tag">
        {tags.length === 0 ? <><Tag className="w-2.5 h-2.5"/>Tag</> : <Plus className="w-2.5 h-2.5"/>}
      </button>

      {open && (
        <>
          {/* Click-outside dismiss layer */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)}/>
          <div className="absolute top-full left-0 mt-1 z-50 w-72 rounded-lg border border-slate-700 bg-slate-900 shadow-xl shadow-black/40 p-3 space-y-3">
            <TagGroup title="Emotions" options={EMOTION_TAGS} selected={tags} onToggle={toggle}/>
            <TagGroup title="Mistakes" options={MISTAKE_TAGS} selected={tags} onToggle={toggle}/>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Freeform hashtag</div>
              <div className="flex gap-1">
                <input
                  value={freeform}
                  onChange={e => setFreeform(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addFreeform(); } }}
                  placeholder="e.g. reversal"
                  className="flex-1 h-7 bg-slate-950 border border-slate-700 rounded px-2 text-xs text-white"/>
                <button onClick={addFreeform}
                        className="h-7 px-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold">
                  Add
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function TagGroup({ title, options, selected, onToggle }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">{title}</div>
      <div className="flex flex-wrap gap-1">
        {options.map(o => {
          const on = selected.includes(o.slug);
          return (
            <button key={o.slug} onClick={() => onToggle(o.slug)}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border transition-colors ${
                      on
                        ? `${o.color} border-transparent`
                        : "bg-slate-950 text-slate-400 border-slate-700 hover:border-blue-500/60 hover:text-white"
                    }`}>
              {on ? "✓ " : ""}{o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
