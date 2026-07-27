import { useEffect, useRef } from 'react';

// TradingView Advanced Chart embed — free, script-tag based.
// Rebuilds when `symbol` changes. Fills its container.
//
// Symbol format examples the widget understands:
//   CME_MINI:MNQ1!  (front-month micro Nasdaq)
//   CME_MINI:ES1!   (front-month S&P)
//   COMEX:GC1!      (gold)
//   NYMEX:CL1!      (crude)
//   FX:EURUSD
//   NASDAQ:AAPL

const TV_MAP = {
  // Common shorthand → TradingView symbol. Continuous-futures contracts
  // ("MNQ1!") can be gated behind TradingView paid tiers; fall back to
  // most-liquid proxy tickers that are free to display.
  "MNQ1!": "NASDAQ:NDX",         // Nasdaq index proxy (free)
  "MES1!": "SP:SPX",             // S&P index proxy (free)
  "NQ1!":  "NASDAQ:NDX",
  "ES1!":  "SP:SPX",
  "GC1!":  "TVC:GOLD",           // Gold spot (free)
  "CL1!":  "TVC:USOIL",          // WTI crude spot (free)
  "SI1!":  "TVC:SILVER",
  "6E1!":  "FX:EURUSD",
  "MNQ":   "NASDAQ:NDX",
  "MES":   "SP:SPX",
};

function toTVSymbol(raw) {
  if (!raw) return "CME_MINI:MNQ1!";
  if (raw.includes(":")) return raw;      // already qualified
  return TV_MAP[raw] || raw;
}

export default function TradingViewChart({ symbol = "MNQ1!", interval = "5" }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = ""; // reset

    // TradingView widget script — configured via a script tag with inline JSON.
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      allow_symbol_change: true,
      calendar: false,
      details: false,
      hide_side_toolbar: false,
      hide_top_toolbar: false,
      hide_legend: false,
      hide_volume: false,
      hotlist: false,
      interval: interval,
      locale: "en",
      save_image: true,
      style: "1",
      symbol: toTVSymbol(symbol),
      theme: "dark",
      timezone: "America/New_York",
      backgroundColor: "#0F172A",
      gridColor: "rgba(51, 65, 85, 0.5)",
      watchlist: [],
      withdateranges: false,
      compareSymbols: [],
      studies: [],
      autosize: true,
    });

    // TradingView widgets need a wrapper structure
    const wrapper = document.createElement("div");
    wrapper.className = "tradingview-widget-container__widget";
    wrapper.style.height = "100%";
    wrapper.style.width = "100%";
    containerRef.current.appendChild(wrapper);
    containerRef.current.appendChild(script);
  }, [symbol, interval]);

  return (
    <div
      ref={containerRef}
      className="tradingview-widget-container h-full w-full rounded-lg overflow-hidden border border-slate-800"
      style={{ minHeight: 400 }}
    />
  );
}
