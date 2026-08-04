import React, { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, Share2 } from "lucide-react";

// ShareCard — 1080×1080 Instagram-square recap card for one day of
// trading. Pure inline SVG, so download-to-PNG works without any
// external library or dependency:
//     SVG → Blob → HTMLImageElement → Canvas → PNG blob → <a download>
//
// Palette is locked to the TradeCore/Pine set — blue accent for
// info, emerald for wins, rose for losses, slate ground. No amber /
// yellow / brown anywhere (memory rule).
//
// Props:
//   trader_name  — string, shown on the bottom line ("Trader: Natalia")
//   date_iso     — "YYYY-MM-DD"
//   summary      — { count, wins, losses, net, winRate, bestSymbol? }
//   variant      — "square" (default 1080×1080) or "story" (1080×1920)

const W_SQ = 1080, H_SQ = 1080;
const W_ST = 1080, H_ST = 1920;

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}
function fmtMoney(n) {
  const abs = Math.abs(n);
  const sign = n >= 0 ? "+" : "-";
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(abs >= 10000 ? 1 : 2)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

export default function ShareCard({ trader_name, date_iso, summary, variant = "square" }) {
  const svgRef = useRef(null);
  const [customName, setCustomName] = useState(trader_name || "");
  const [busy, setBusy] = useState(false);

  const W = variant === "story" ? W_ST : W_SQ;
  const H = variant === "story" ? H_ST : H_SQ;

  const s = summary || { count: 0, wins: 0, losses: 0, net: 0, winRate: 0 };
  const win = s.net > 0, loss = s.net < 0;

  // Semantic palette — locked hex values so SVG→canvas renders identically.
  const bg1        = "#0b1220";
  const bg2        = "#111a2e";
  const panelBg    = "#151e35";
  const stroke     = "#1e293b";
  const accent     = "#3b82f6";   // blue
  const emerald    = "#10b981";
  const rose       = "#ef4444";
  const textWhite  = "#ffffff";
  const textDim    = "#94a3b8";
  const textFaint  = "#64748b";
  const netColor   = win ? emerald : loss ? rose : textDim;

  const displayName = (customName || trader_name || "Trader").trim();

  const download = async () => {
    if (!svgRef.current || busy) return;
    setBusy(true);
    try {
      const svgEl = svgRef.current;
      const serializer = new XMLSerializer();
      let source = serializer.serializeToString(svgEl);
      if (!source.startsWith("<?xml")) source = '<?xml version="1.0" standalone="no"?>\n' + source;
      const svgBlob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error("SVG failed to load into image"));
        img.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = bg1;
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(img, 0, 0, W, H);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => {
        if (!blob) { alert("PNG export failed"); return; }
        const a = document.createElement("a");
        const bloburl = URL.createObjectURL(blob);
        a.href = bloburl;
        const safeName = (displayName || "trader").replace(/[^a-z0-9]/gi, "_").toLowerCase();
        a.download = `tradecore-${safeName}-${date_iso || "day"}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(bloburl);
      }, "image/png");
    } catch (e) {
      alert(`Export failed: ${e.message}`);
    }
    setBusy(false);
  };

  const shareNative = async () => {
    if (!navigator.share) { alert("Web Share API not available in this browser — use Download instead."); return; }
    try {
      const svgEl = svgRef.current;
      const source = new XMLSerializer().serializeToString(svgEl);
      const svgBlob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      await new Promise((r, e) => { img.onload = r; img.onerror = e; img.src = url; });
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      canvas.getContext("2d").drawImage(img, 0, 0, W, H);
      URL.revokeObjectURL(url);
      canvas.toBlob(async blob => {
        if (!blob) return;
        const file = new File([blob], `tradecore-${date_iso || "day"}.png`, { type: "image/png" });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: `${displayName} · ${fmtDate(date_iso)}`, text: `${fmtMoney(s.net)} · ${s.wins}W/${s.losses}L` });
        } else {
          alert("This browser can't share files — use Download.");
        }
      }, "image/png");
    } catch (e) { alert(`Share failed: ${e.message}`); }
  };

  // Layout — just the header pill, the BIG net-P&L number, and the
  // bottom trader-name credit. Everything else was noise.
  const centerX = W / 2;
  const netY    = Math.round(H * 0.55);
  // Font size scales down as the P&L string gets longer so it always
  // stays comfortably inside the middle of the frame — "+$0" reads as
  // big as "-$12.5k" without touching the edges.
  const netLen = fmtMoney(s.net).length;
  const _base = variant === "story" ? 240 : 200;
  const _shrink = Math.max(0, netLen - 5) * (variant === "story" ? 22 : 18);
  const netSize = Math.max(variant === "story" ? 140 : 120, _base - _shrink);
  const bottomY = variant === "story" ? 1780 : 980;

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white text-base flex items-center gap-2">
          <Share2 className="w-5 h-5 text-blue-400"/> Share today's card
        </CardTitle>
        <p className="text-xs text-slate-400 mt-1">
          Downloadable trade recap card — Instagram-square PNG. Set your trader name, hit Download.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 flex-wrap items-center">
          <Input value={customName}
                 onChange={e => setCustomName(e.target.value)}
                 placeholder="Trader name"
                 className="bg-slate-950 border-slate-700 text-white max-w-xs"/>
          <Button onClick={download} disabled={busy}
                  className="bg-blue-600 hover:bg-blue-700 text-white">
            <Download className="w-4 h-4 mr-2"/>{busy ? "Rendering…" : "Download PNG"}
          </Button>
          {typeof navigator !== "undefined" && navigator.share && (
            <Button onClick={shareNative} variant="outline"
                    className="bg-slate-800 border-slate-700 text-white hover:bg-slate-700">
              <Share2 className="w-4 h-4 mr-2"/>Share…
            </Button>
          )}
        </div>

        {/* Live preview — shown at ~1/3 scale, real SVG. Downloads at full 1080. */}
        <div className="bg-slate-950 border border-slate-800 rounded-md p-3 flex justify-center overflow-x-auto">
          <div style={{ width: 360 }}>
            <svg
              ref={svgRef}
              xmlns="http://www.w3.org/2000/svg"
              viewBox={`0 0 ${W} ${H}`}
              width="100%"
              style={{ display: "block" }}
              preserveAspectRatio="xMidYMid meet"
            >
              <defs>
                <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"  stopColor={bg1}/>
                  <stop offset="100%" stopColor={bg2}/>
                </linearGradient>
                <linearGradient id="accentBar" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%"  stopColor={accent} stopOpacity="0"/>
                  <stop offset="50%" stopColor={accent} stopOpacity="1"/>
                  <stop offset="100%" stopColor={accent} stopOpacity="0"/>
                </linearGradient>
              </defs>

              {/* Ground */}
              <rect width={W} height={H} fill="url(#bg)"/>

              {/* Top accent bar */}
              <rect x="0" y="0" width={W} height="8" fill="url(#accentBar)"/>

              {/* Wordmark row */}
              <g transform={`translate(${W / 2}, 90)`}>
                <text x="0" y="0" textAnchor="middle"
                      fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
                      fontWeight="800" fontSize="42"
                      letterSpacing="8"
                      fill={textWhite}>TRADECORE</text>
                <text x="0" y="46" textAnchor="middle"
                      fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
                      fontSize="24" letterSpacing="3" fill={textDim}>
                  DAILY RECAP
                </text>
              </g>

              {/* Date pill */}
              <g transform={`translate(${W / 2}, ${variant === "story" ? 260 : 220})`}>
                <rect x="-260" y="-30" width="520" height="60" rx="30" fill={panelBg} stroke={stroke} strokeWidth="2"/>
                <text x="0" y="12" textAnchor="middle"
                      fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
                      fontSize="26" fontWeight="600" fill={textWhite}>
                  {fmtDate(date_iso)}
                </text>
              </g>

              {/* Big net-P&L number */}
              <g transform={`translate(${centerX}, ${netY})`}>
                <text x="0" y="0" textAnchor="middle"
                      fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
                      fontWeight="900" fontSize={netSize}
                      fill={netColor}
                      style={{ letterSpacing: "-4px" }}>
                  {fmtMoney(s.net)}
                </text>
                <text x="0" y={netSize / 2 + 40} textAnchor="middle"
                      fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
                      fontSize="28" letterSpacing="4" fill={textDim}>
                  NET P&amp;L
                </text>
              </g>

              {/* Bottom credit row */}
              <g transform={`translate(${centerX}, ${bottomY})`}>
                <text x="0" y="-24" textAnchor="middle"
                      fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
                      fontSize="30" fontWeight="700" fill={textWhite}>
                  {displayName || "Trader"}
                </text>
                <text x="0" y="14" textAnchor="middle"
                      fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
                      fontSize="20" letterSpacing="3" fill={textFaint}>
                  shared from TradeCore
                </text>
              </g>

              {/* Bottom accent bar */}
              <rect x="0" y={H - 8} width={W} height="8" fill="url(#accentBar)"/>
            </svg>
          </div>
        </div>

        <p className="text-[10px] text-slate-500 leading-relaxed">
          The download is 1080×1080 (Instagram / X-square). Story variant is 1080×1920. No trade prices or account details leave your browser — only the numbers shown on the card get baked into the image.
        </p>
      </CardContent>
    </Card>
  );
}

