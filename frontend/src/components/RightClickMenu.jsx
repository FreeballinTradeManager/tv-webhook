import React, { useState, useEffect, useCallback, useRef } from "react";

// Hook variant — for elements that CAN'T be wrapped in a <div>
// (e.g. table rows inside <tbody>). Returns { menuProps, menu }.
// Spread `menuProps` onto whatever element you want to be right-clickable;
// render `menu` somewhere in the tree (React Portal or inline).
//
//   const { menuProps, menu } = useContextMenu([...items]);
//   return <tr {...menuProps}>...</tr>{menu}
//
export function useContextMenu(items) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const touchTimer = useRef(null);

  const openAt = useCallback((cx, cy) => {
    const W = 220, H = 8 + (items?.length || 1) * 32;
    setPos({
      x: Math.min(cx, window.innerWidth  - W - 8),
      y: Math.min(cy, window.innerHeight - H - 8),
    });
    setOpen(true);
  }, [items?.length]);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [open]);

  const menuProps = {
    onContextMenu: (e) => {
      e.preventDefault();
      e.stopPropagation();
      openAt(e.clientX, e.clientY);
    },
    onTouchStart: (e) => {
      const t = setTimeout(() => {
        const touch = e.touches?.[0];
        if (touch) openAt(touch.clientX, touch.clientY);
      }, 500);
      touchTimer.current = t;
    },
    onTouchEnd:    () => { if (touchTimer.current) clearTimeout(touchTimer.current); },
    onTouchMove:   () => { if (touchTimer.current) clearTimeout(touchTimer.current); },
    onTouchCancel: () => { if (touchTimer.current) clearTimeout(touchTimer.current); },
  };

  const menu = open ? (
    <MenuPortal items={items} pos={pos} onClose={() => setOpen(false)}/>
  ) : null;

  return { menuProps, menu, close: () => setOpen(false) };
}

function MenuPortal({ items, pos, onClose }) {
  const runItem = (item) => {
    if (item.disabled || item.separator || item.header) return;
    onClose();
    try { item.onClick?.(); } catch (e) { console.error(e); }
  };
  return (
    <>
      <div className="fixed inset-0 z-[100]" onClick={onClose}/>
      <div
        className="fixed z-[101] min-w-[200px] rounded-lg border border-slate-700 bg-slate-900 shadow-xl shadow-black/60 py-1 select-none"
        style={{ left: pos.x, top: pos.y }}
        onClick={(e) => e.stopPropagation()}
        role="menu"
      >
        {items.map((item, i) => {
          if (item.separator) return <div key={i} className="my-1 h-px bg-slate-800"/>;
          if (item.header) return (
            <div key={i} className="px-3 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              {item.header}
            </div>
          );
          const cls = item.disabled
            ? "opacity-40 cursor-not-allowed"
            : item.danger
              ? "hover:bg-red-900/50 hover:text-white text-red-300 cursor-pointer"
              : "hover:bg-slate-800 hover:text-white text-slate-200 cursor-pointer";
          return (
            <div key={i}
                 role="menuitem"
                 onClick={() => runItem(item)}
                 className={`flex items-center gap-2 px-3 py-1.5 text-sm ${cls}`}>
              {item.icon && <span className="w-4 h-4 shrink-0 flex items-center justify-center opacity-80">{item.icon}</span>}
              <span className="flex-1">{item.label}</span>
              {item.kbd && (
                <span className="text-[10px] text-slate-500 font-mono px-1 border border-slate-700 rounded">{item.kbd}</span>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// Right-click / long-press context menu — the "PC feel" wrapper.
//
// Wrap any element:
//   <RightClickMenu items={[
//     { label: "Edit",   icon: <Pencil/>, onClick: () => ... },
//     { label: "Delete", icon: <Trash2/>, onClick: () => ..., danger: true },
//     { separator: true },
//     { label: "Copy",   onClick: () => ... },
//   ]}>
//     <div>Anything, a row, a card, a title</div>
//   </RightClickMenu>
//
// - Right-click ANYWHERE inside the wrapped children opens the menu at the cursor.
// - Long-press (500ms touch hold) opens on mobile.
// - Click outside / Escape / after any item click closes it.
// - Positions itself so it stays inside the viewport.
//
// items[]:
//   { label, icon?, onClick, danger?, disabled?, kbd?, separator?, header? }
//     - `separator: true` renders a divider row
//     - `header: "…"`     renders a small greyed section header
//     - `kbd: "⌘⇧D"`      renders a keyboard-hint on the right
export default function RightClickMenu({ items, children, className = "" }) {
  const [open, setOpen] = useState(false);
  const [pos,  setPos]  = useState({ x: 0, y: 0 });
  const [touchTimer, setTouchTimer] = useState(null);

  const openAt = useCallback((clientX, clientY) => {
    // Clamp so the menu doesn't clip off the right/bottom edges.
    const W = 220, H = 8 + items.length * 32;
    const x = Math.min(clientX, window.innerWidth  - W - 8);
    const y = Math.min(clientY, window.innerHeight - H - 8);
    setPos({ x, y });
    setOpen(true);
  }, [items.length]);

  const onContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    openAt(e.clientX, e.clientY);
  };

  const onTouchStart = (e) => {
    const t = setTimeout(() => {
      const touch = e.touches?.[0];
      if (touch) openAt(touch.clientX, touch.clientY);
    }, 500);
    setTouchTimer(t);
  };
  const clearTouch = () => { if (touchTimer) clearTimeout(touchTimer); setTouchTimer(null); };

  useEffect(() => {
    if (!open) return;
    const onEsc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [open]);

  const runItem = (item) => {
    if (item.disabled || item.separator || item.header) return;
    setOpen(false);
    try { item.onClick?.(); } catch (e) { console.error(e); }
  };

  return (
    <>
      <div
        onContextMenu={onContextMenu}
        onTouchStart={onTouchStart}
        onTouchEnd={clearTouch}
        onTouchMove={clearTouch}
        onTouchCancel={clearTouch}
        className={className}
      >
        {children}
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-[100]" onClick={() => setOpen(false)}/>
          <div
            className="fixed z-[101] min-w-[200px] rounded-lg border border-slate-700 bg-slate-900 shadow-xl shadow-black/60 py-1 select-none"
            style={{ left: pos.x, top: pos.y }}
            onClick={(e) => e.stopPropagation()}
            role="menu"
          >
            {items.map((item, i) => {
              if (item.separator) {
                return <div key={i} className="my-1 h-px bg-slate-800"/>;
              }
              if (item.header) {
                return (
                  <div key={i} className="px-3 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                    {item.header}
                  </div>
                );
              }
              const cls = item.disabled
                ? "opacity-40 cursor-not-allowed"
                : item.danger
                  ? "hover:bg-red-900/50 hover:text-white text-red-300 cursor-pointer"
                  : "hover:bg-slate-800 hover:text-white text-slate-200 cursor-pointer";
              return (
                <div
                  key={i}
                  role="menuitem"
                  onClick={() => runItem(item)}
                  className={`flex items-center gap-2 px-3 py-1.5 text-sm ${cls}`}
                >
                  {item.icon && <span className="w-4 h-4 shrink-0 flex items-center justify-center opacity-80">{item.icon}</span>}
                  <span className="flex-1">{item.label}</span>
                  {item.kbd && (
                    <span className="text-[10px] text-slate-500 font-mono px-1 border border-slate-700 rounded">
                      {item.kbd}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
