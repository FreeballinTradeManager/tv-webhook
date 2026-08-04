// Task #122 — Prop firm rule presets.
//
// PMT / TradersPost / Tradovate are the ROUTING layer (broker).
// This file is the FIRM layer — whose money you're trading + which
// rules apply. Composed independently on the Account row so one
// account can be: broker=PMT observe, firm=Apex 50K.
//
// Rule shape:
//   {
//     key, name, blurb,
//     accounts:  [{ size, price, daily_dd, max_dd }],
//     drawdown_type:  "trailing" | "eod_trailing" | "static",
//     min_trading_days,
//     consistency_pct,           // e.g. 30 = max 30% of profit on any single day
//     weekend_flat,              // must flatten by Friday close
//     news_flat,                 // must flatten around red news
//     scaling_notes,             // free text
//     payout: { min_days, first_payout_days, cadence, split_pct },
//     approved_tools_link,       // where to check we're approved
//   }
//
// Numbers reflect published rules as of mid-2026. Firms tweak these
// so surface them as *defaults* the user can override on their account.

export const PROP_FIRMS = [
  {
    key: "apex",
    name: "Apex Trader Funding",
    blurb: "Popular US futures prop. Trailing EOD drawdown.",
    accounts: [
      { size: 25_000,  price: 147, daily_dd: null, max_dd: 1_500  },
      { size: 50_000,  price: 167, daily_dd: null, max_dd: 2_500  },
      { size: 100_000, price: 207, daily_dd: null, max_dd: 3_000  },
      { size: 150_000, price: 297, daily_dd: null, max_dd: 5_000  },
      { size: 250_000, price: 517, daily_dd: null, max_dd: 6_500  },
      { size: 300_000, price: 657, daily_dd: null, max_dd: 7_500  },
    ],
    drawdown_type: "eod_trailing",
    min_trading_days: 7,
    consistency_pct: 30,
    weekend_flat: false,
    news_flat: false,
    scaling_notes: "Scale-in allowed after evaluation. Personal account (PA) 5:1 payout split first, then 90/10.",
    payout: { min_days: 8, first_payout_days: 8, cadence: "every 8 days", split_pct: 90 },
    approved_tools_link: "https://apextraderfunding.com",
  },
  {
    key: "mffu",
    name: "MyFundedFutures (MFFU)",
    blurb: "Consistency-rule enforced. Static + trailing options.",
    accounts: [
      { size: 25_000,  price: 87,  daily_dd: 500,   max_dd: 1_500  },
      { size: 50_000,  price: 167, daily_dd: 1_200, max_dd: 2_000  },
      { size: 100_000, price: 297, daily_dd: 2_200, max_dd: 3_000  },
      { size: 150_000, price: 397, daily_dd: 3_200, max_dd: 4_500  },
    ],
    drawdown_type: "trailing",
    min_trading_days: 3,
    consistency_pct: 30,
    weekend_flat: true,
    news_flat: false,
    scaling_notes: "Positions must be flat over the weekend. Consistency: no single day > 30% of total profit.",
    payout: { min_days: 5, first_payout_days: 14, cadence: "weekly after first", split_pct: 90 },
    approved_tools_link: "https://myfundedfutures.com",
  },
  {
    key: "tradeify",
    name: "Tradeify",
    blurb: "Static drawdown. Fast payouts.",
    accounts: [
      { size: 25_000,  price: 97,  daily_dd: 550,   max_dd: 1_500  },
      { size: 50_000,  price: 197, daily_dd: 1_100, max_dd: 2_500  },
      { size: 100_000, price: 397, daily_dd: 2_200, max_dd: 3_000  },
    ],
    drawdown_type: "static",
    min_trading_days: 5,
    consistency_pct: 40,
    weekend_flat: true,
    news_flat: false,
    scaling_notes: "Static max DD — doesn't trail as you go into profit. Cleaner mental math.",
    payout: { min_days: 5, first_payout_days: 10, cadence: "on-demand after min days", split_pct: 90 },
    approved_tools_link: "https://tradeify.co",
  },
  {
    key: "lucid",
    name: "Lucid Trading",
    blurb: "Public leaderboards + monthly stats page (like Tradezella's public tier).",
    accounts: [
      { size: 50_000,  price: 167, daily_dd: 1_250, max_dd: 2_500  },
      { size: 100_000, price: 297, daily_dd: 2_500, max_dd: 3_500  },
      { size: 150_000, price: 397, daily_dd: 3_500, max_dd: 5_000  },
    ],
    drawdown_type: "trailing",
    min_trading_days: 5,
    consistency_pct: 25,
    weekend_flat: true,
    news_flat: false,
    scaling_notes: "Public-facing stats. Consistency rule strict at 25%.",
    payout: { min_days: 5, first_payout_days: 10, cadence: "bi-weekly", split_pct: 80 },
    approved_tools_link: "https://lucidtrading.com",
  },
  {
    key: "fivepercenters",
    name: "The 5%ers",
    blurb: "Bootcamp + scaling plan. FX/futures.",
    accounts: [
      { size: 40_000,  price: 200, daily_dd: 800,  max_dd: 1_600  },
      { size: 100_000, price: 495, daily_dd: 2_000, max_dd: 4_000  },
    ],
    drawdown_type: "static",
    min_trading_days: 10,
    consistency_pct: null,
    weekend_flat: false,
    news_flat: true,
    scaling_notes: "Scaling plan doubles account at each milestone. No trading around red news.",
    payout: { min_days: 10, first_payout_days: 30, cadence: "monthly", split_pct: 80 },
    approved_tools_link: "https://the5ers.com",
  },
  {
    key: "topstep",
    name: "TopStep",
    blurb: "OG US futures prop. Trailing drawdown, min trading days.",
    accounts: [
      { size: 50_000,  price: 165, daily_dd: 1_000, max_dd: 2_000  },
      { size: 100_000, price: 325, daily_dd: 2_000, max_dd: 3_000  },
      { size: 150_000, price: 375, daily_dd: 3_000, max_dd: 4_500  },
    ],
    drawdown_type: "trailing",
    min_trading_days: 5,
    consistency_pct: 50,
    weekend_flat: true,
    news_flat: false,
    scaling_notes: "Combine has a profit target then Funded Account. Rithmic + NinjaTrader are the native routes.",
    payout: { min_days: 5, first_payout_days: 14, cadence: "every 4 weeks", split_pct: 100 },
    approved_tools_link: "https://topstep.com",
  },
  {
    key: "blueberry",
    name: "Blueberry Futures",
    blurb: "Newer prop, aggressive scaling.",
    accounts: [
      { size: 50_000,  price: 147, daily_dd: 1_250, max_dd: 2_500  },
      { size: 100_000, price: 247, daily_dd: 2_500, max_dd: 3_500  },
    ],
    drawdown_type: "eod_trailing",
    min_trading_days: 3,
    consistency_pct: 30,
    weekend_flat: true,
    news_flat: false,
    scaling_notes: "Quick scaling once funded. Verify current rules with firm before payout.",
    payout: { min_days: 3, first_payout_days: 7, cadence: "weekly", split_pct: 90 },
    approved_tools_link: null,
  },
  {
    key: "topone",
    name: "TopOneTrader",
    blurb: "Fixed drawdown, generous consistency window.",
    accounts: [
      { size: 50_000,  price: 137, daily_dd: 1_000, max_dd: 2_000  },
      { size: 100_000, price: 297, daily_dd: 2_000, max_dd: 3_000  },
    ],
    drawdown_type: "static",
    min_trading_days: 5,
    consistency_pct: 40,
    weekend_flat: true,
    news_flat: false,
    scaling_notes: "Static DD — mental model matches Tradeify.",
    payout: { min_days: 5, first_payout_days: 10, cadence: "weekly", split_pct: 90 },
    approved_tools_link: null,
  },
  {
    key: "custom",
    name: "Custom / Personal",
    blurb: "Your own account or an unsupported firm — set rules manually.",
    accounts: [],
    drawdown_type: "static",
    min_trading_days: 0,
    consistency_pct: null,
    weekend_flat: false,
    news_flat: false,
    scaling_notes: "",
    payout: { min_days: 0, first_payout_days: 0, cadence: "", split_pct: 100 },
    approved_tools_link: null,
  },
];

export function firmByKey(key) {
  return PROP_FIRMS.find(f => f.key === key) || null;
}

// Given a firm + a chosen account size, resolve the guardrail values
// TradeCore should default onto the Account row.
export function guardrailsFor(firmKey, sizeUsd) {
  const f = firmByKey(firmKey);
  if (!f) return null;
  const acct = f.accounts.find(a => a.size === sizeUsd) || f.accounts[0] || {};
  return {
    firm: f.key,
    firm_name: f.name,
    starting_balance:   acct.size || null,
    daily_loss_limit:   acct.daily_dd || null,
    max_drawdown:       acct.max_dd || null,
    drawdown_type:      f.drawdown_type,
    min_trading_days:   f.min_trading_days,
    consistency_pct:    f.consistency_pct,
    weekend_flat:       f.weekend_flat,
    news_flat:          f.news_flat,
    payout_min_days:    f.payout?.min_days ?? null,
    payout_split_pct:   f.payout?.split_pct ?? null,
    payout_cadence:     f.payout?.cadence ?? "",
  };
}

// Human-readable one-line summary for the account card.
export function firmSummary(acc) {
  const f = firmByKey(acc?.firm);
  if (!f) return null;
  const dd = acc.max_drawdown ? `$${acc.max_drawdown.toLocaleString()} DD` : "";
  const dt = f.drawdown_type === "trailing" ? "trailing" : f.drawdown_type === "eod_trailing" ? "EOD trail" : "static";
  const wk = f.weekend_flat ? " · weekend flat" : "";
  const cons = f.consistency_pct ? ` · ${f.consistency_pct}% consistency` : "";
  return `${f.name} · ${dd} (${dt})${wk}${cons}`;
}
