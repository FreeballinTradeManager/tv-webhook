import React, { useState, useEffect, useRef, useCallback } from "react";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  Image as ImageIcon, X as XIcon, Save, Trash2, ZoomIn,
} from "lucide-react";
import {
  getNotes, setNotesText, addImage, removeImage, fileToDataUrl, setExcursions,
} from "@/lib/trade_notes";

// Task #49 — Expandable panel that lives under a trade row.
// Rendered as a second <TableRow> with colSpan across the whole table
// when the parent row is expanded. Includes an editable notes textarea
// (autosaved on blur / 800ms debounce) + a multi-image gallery with
// paste / drag / upload / click-to-enlarge.
export default function TradeNotesRow({ tradeId, columnCount, onClose }) {
  const initial = getNotes(tradeId);
  const [notes, setNotes] = useState(initial.notes);
  const [images, setImages] = useState(initial.images);
  const [mae, setMae] = useState(initial.mae);
  const [mfe, setMfe] = useState(initial.mfe);
  const [lightbox, setLightbox] = useState(null);
  const [err, setErr] = useState(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    // If trade changes (row-recycling), reload notes fresh.
    const cur = getNotes(tradeId);
    setNotes(cur.notes);
    setImages(cur.images);
    setMae(cur.mae);
    setMfe(cur.mfe);
  }, [tradeId]);

  const commitExcursions = (nextMae, nextMfe) => {
    setExcursions(tradeId, { mae: nextMae, mfe: nextMfe });
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 900);
  };

  // Autosave notes: debounce 800ms while typing, save immediately on blur.
  const scheduleSave = useCallback((value) => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setNotesText(tradeId, value);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 900);
    }, 800);
  }, [tradeId]);
  const handleBlur = () => {
    clearTimeout(debounceRef.current);
    setNotesText(tradeId, notes);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 900);
  };
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  // Image upload / paste / drag-drop.
  const handleFiles = async (files) => {
    setErr(null);
    for (const f of files) {
      try {
        const url = await fileToDataUrl(f);
        const res = addImage(tradeId, url);
        if (!res.ok) {
          setErr(res.reason === "quota"
            ? "Out of local storage space — remove older images."
            : "Failed to add image");
          return;
        }
        setImages(res.images);
      } catch (e) {
        setErr(e.message || "invalid image");
      }
    }
  };
  const onFileInput = (e) => handleFiles([...e.target.files]);
  const onPaste = (e) => {
    const items = e.clipboardData?.items || [];
    const files = [];
    for (const it of items) {
      if (it.type?.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) handleFiles(files);
  };
  const onDrop = (e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files || [])].filter(f => f.type?.startsWith("image/"));
    if (files.length) handleFiles(files);
  };

  return (
    <>
      <TableRow className="bg-slate-950/60 hover:bg-slate-950/60">
        <TableCell colSpan={columnCount} className="p-0">
          <div className="border-l-4 border-blue-500 bg-slate-950 p-4 space-y-3"
               onPaste={onPaste}
               onDragOver={(e) => e.preventDefault()}
               onDrop={onDrop}>
            {/* Notes editor */}
            <div>
              <div className="flex items-baseline justify-between mb-1">
                <label className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Notes</label>
                <div className="flex items-center gap-2 text-[10px]">
                  {savedFlash && <span className="text-emerald-400">✓ saved</span>}
                  <button onClick={onClose} className="text-slate-500 hover:text-white">
                    <XIcon className="w-3.5 h-3.5"/>
                  </button>
                </div>
              </div>
              <textarea
                value={notes}
                onChange={(e) => { setNotes(e.target.value); scheduleSave(e.target.value); }}
                onBlur={handleBlur}
                placeholder="What was the setup? What did you notice mid-trade? What would you do different?"
                rows={4}
                className="w-full bg-slate-900 border border-slate-700 rounded-md p-2.5 text-white text-sm resize-y"
              />
            </div>

            {/* MAE / MFE — Maximum Adverse / Favorable Excursion. Task #88 */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block mb-1">
                  MAE <span className="text-slate-500 normal-case font-normal">($ against you)</span>
                </label>
                <input type="number" step="0.01" value={mae ?? ""}
                       onChange={(e) => setMae(e.target.value === "" ? null : Number(e.target.value))}
                       onBlur={() => commitExcursions(mae, mfe)}
                       placeholder="e.g. 42.50"
                       className="w-full bg-slate-900 border border-slate-700 rounded-md px-2.5 py-1.5 text-white text-sm"/>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block mb-1">
                  MFE <span className="text-slate-500 normal-case font-normal">($ in your favor)</span>
                </label>
                <input type="number" step="0.01" value={mfe ?? ""}
                       onChange={(e) => setMfe(e.target.value === "" ? null : Number(e.target.value))}
                       onBlur={() => commitExcursions(mae, mfe)}
                       placeholder="e.g. 128.00"
                       className="w-full bg-slate-900 border border-slate-700 rounded-md px-2.5 py-1.5 text-white text-sm"/>
              </div>
            </div>

            {/* Image gallery */}
            <div>
              <div className="flex items-baseline justify-between mb-1">
                <label className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                  Screenshots {images.length > 0 && <span className="text-slate-500">· {images.length}</span>}
                </label>
                <label className="text-[10px] text-blue-400 hover:text-blue-300 cursor-pointer font-semibold">
                  + Add image
                  <input type="file" accept="image/*" multiple className="hidden" onChange={onFileInput}/>
                </label>
              </div>
              {images.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {images.map((src, i) => (
                    <div key={i} className="relative group rounded-md border border-slate-800 overflow-hidden bg-slate-900">
                      <img src={src} alt={`Trade screenshot ${i + 1}`}
                           className="w-full h-24 object-cover cursor-zoom-in"
                           onClick={() => setLightbox(src)}/>
                      <button onClick={() => setImages(removeImage(tradeId, i))}
                              className="absolute top-1 right-1 bg-slate-950/80 hover:bg-red-900/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Remove">
                        <XIcon className="w-3 h-3"/>
                      </button>
                      <button onClick={() => setLightbox(src)}
                              className="absolute bottom-1 right-1 bg-slate-950/80 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                              title="View full size">
                        <ZoomIn className="w-3 h-3"/>
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <label
                  className="flex items-center justify-center gap-2 h-16 rounded-md border-2 border-dashed border-slate-700 hover:border-blue-500 cursor-pointer text-slate-500 hover:text-slate-300"
                >
                  <ImageIcon className="w-4 h-4"/>
                  <span className="text-xs">Click, drop or paste chart screenshots</span>
                  <input type="file" accept="image/*" multiple className="hidden" onChange={onFileInput}/>
                </label>
              )}
            </div>

            {err && (
              <div className="text-xs text-red-300 bg-red-950/40 border border-red-800/60 rounded-md px-3 py-1.5">
                {err}
              </div>
            )}
          </div>
        </TableCell>
      </TableRow>

      {/* Lightbox for click-to-enlarge */}
      {lightbox && (
        <TableRow>
          <TableCell colSpan={columnCount} className="p-0">
            <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-8 cursor-zoom-out"
                 onClick={() => setLightbox(null)}>
              <img src={lightbox} alt="enlarged" className="max-w-full max-h-full object-contain rounded-md shadow-2xl"/>
              <button className="absolute top-4 right-4 text-white bg-slate-900/80 hover:bg-red-900/60 rounded-full p-2">
                <XIcon className="w-5 h-5"/>
              </button>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
