"""
PMT-compat webhook — observability mode.

User's automation (v17.9.16) already fires PMT-shaped JSON directly to
PMT for execution. We want those trades visible on our dashboard
without disrupting the existing PMT path. This module accepts PMT's
JSON shape, translates it to our internal model, and saves a signal
without calling any broker.

Setup on the user side:
  1. Keep the existing TradingView alert pointed at PMT (executes on Lucid).
  2. Create a SECOND alert with the same conditions, webhook URL =
     https://tv-webhook-production-218f.up.railway.app/api/webhook/pmt-compat
  3. The second alert fires the same PMT JSON to us. We translate and
     log. Zero broker calls from our side.

PMT JSON shapes we handle:

  ENTRY (buy or sell):
    {
      "symbol": "MNQ1!",
      "data": "buy" | "sell",
      "quantity": 10,
      "price": 30481.25,
      "advance_tp_sl": [
        {"quantity":3, "tp":30493.25, "sl":30461.25, ...},
        {"quantity":3, "tp":30505.25, "sl":30461.25, ...},
        {"quantity":3, "tp":30525.25, "sl":30461.25, ...},
        {"quantity":1, "tp":99999,    "sl":30461.25, ...}   ← runner (tp=99999/1)
      ],
      ...
    }

  CLOSE (master close / FLAT):
    {
      "symbol": "MNQ1!",
      "data": "CLOSE" | "FLAT",
      "quantity": 0,
      "full_closed": true,
      ...
    }
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class _AdvanceTPSL(BaseModel):
    """A single bracket leg in PMT's advance_tp_sl array."""
    quantity: int = 0
    tp: float = 0.0
    sl: float = 0.0

    # Lots of other fields exist (breakeven, trail, etc) but we only need
    # qty/tp/sl for observability. Pydantic ignores unknowns by default.
    model_config = {"extra": "ignore"}


class PMTWebhook(BaseModel):
    """The subset of PMT's JSON we read for observability.

    Any unknown extra fields are ignored, so this is robust to PMT's
    schema growing.
    """
    symbol: str
    data: str                                  # "buy" | "sell" | "CLOSE" | "FLAT"
    quantity: int = 0
    price: Optional[float] = None
    advance_tp_sl: list[_AdvanceTPSL] = Field(default_factory=list)
    full_closed: Optional[bool] = None

    # Allow but ignore everything else
    model_config = {"extra": "ignore"}


# Synthetic key used so the main webhook handler's auth check passes.
# We accept this on the pmt-compat endpoint specifically — no broker
# call happens, no PII leaks, this is observability only.
PMT_COMPAT_KEY = "__pmt_compat__"


def pmt_to_trade_engine(p: PMTWebhook) -> dict:
    """Translate the PMT payload to a TradeEngineWebhook-shape dict.

    Used by the /api/webhook/pmt-compat endpoint so the same downstream
    pipeline (dedup, auto trade_id, state machine, dashboard) can run on
    a PMT-shaped signal.
    """
    action = (p.data or "").strip().lower()

    # --- ENTRY ---
    if action in ("buy", "sell"):
        side = "LONG" if action == "buy" else "SHORT"
        result: dict = {
            "event": "ENTRY",
            "ticker": p.symbol,
            "side": side,
            "qty": p.quantity,
            "key": PMT_COMPAT_KEY,
            "entry_px": p.price,
            "source": "PMT-compat",
        }

        # Translate the bracket groups → tp1/tp2/tp3 + runner.
        # PMT uses tp=99999 (LONG) or tp=1 (SHORT) to mark a runner that
        # should never auto-close at the broker.
        tps: list[_AdvanceTPSL] = []
        runner_qty = 0
        for leg in p.advance_tp_sl:
            is_runner = leg.tp >= 99000 or (side == "SHORT" and leg.tp <= 5)
            if is_runner:
                runner_qty += leg.quantity
            else:
                tps.append(leg)

        if tps:
            # The first non-runner leg's SL is the position's stop_px.
            # All legs share the same SL in PMT's bracket model.
            result["stop_px"] = tps[0].sl
        if len(tps) >= 1:
            result["tp1_px"] = tps[0].tp
            result["tp1_qty"] = tps[0].quantity
        if len(tps) >= 2:
            result["tp2_px"] = tps[1].tp
            result["tp2_qty"] = tps[1].quantity
        if len(tps) >= 3:
            result["tp3_px"] = tps[2].tp
            result["tp3_qty"] = tps[2].quantity
        if runner_qty:
            result["runner_qty"] = runner_qty
        return result

    # --- MASTER CLOSE / FLAT ---
    if action in ("close", "flat"):
        return {
            "event": "MASTER_CLOSE",
            "ticker": p.symbol,
            # Side and qty aren't carried in CLOSE; the state machine
            # resolves them by looking up the active position on the
            # ticker.
            "side": "LONG",
            "qty": 0,
            "key": PMT_COMPAT_KEY,
            "close_qty": 0,
            "remaining_qty": 0,
            "source": "PMT-compat CLOSE",
        }

    # Unknown verb — log as TEST so it appears on the dashboard
    # without polluting position state.
    return {
        "event": "TEST",
        "ticker": p.symbol,
        "side": "LONG",
        "qty": p.quantity,
        "key": PMT_COMPAT_KEY,
        "source": f"PMT-compat unknown ({action})",
    }
