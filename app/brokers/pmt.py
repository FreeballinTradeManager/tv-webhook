"""
PMTAdapter — POSTs trade signals to PickMyTrade's webhook URL.

Architecture in the user's setup:
  TradingView -> Trade Engine (us) -> PMTAdapter -> PMT URL -> Lucid 50K
                                                              -> (TradeSyncer master-watches Lucid, copies to slaves)

Our server only talks to PMT for ONE prop account (the master that
TradeSyncer is watching). TS handles fan-out to all other prop firms,
which is much cheaper than paying PMT $50/mo per additional account.

ENV VARS (set on Railway when ready):
  PMT_WEBHOOK_URL   - PMT's webhook endpoint (e.g. https://webhook.pickmytrade.com/...)
                      this is the URL you'd otherwise paste into a TradingView alert
  PMT_TOKEN         - your PMT API token (e.g. Sz37e09189a1e0a2421731)
  PMT_ACCOUNT_ID    - the Tradovate account id PMT should fill (e.g. LFE05068667220004)
  PMT_SYMBOL        - the broker symbol PMT expects (e.g. MNQ1!)
  PMT_RUN_AS_DEMO   - "true" => sets main_token_type: DEMO in the JSON; defaults true
"""

from __future__ import annotations

import logging
import os
import uuid
from typing import Optional

try:
    import httpx
except ImportError:
    httpx = None  # type: ignore

from .base import BrokerAdapter, BrokerResult

log = logging.getLogger("tv-webhook.brokers.pmt")


def _id(prefix: str) -> str:
    return f"pmt-{prefix}-{uuid.uuid4().hex[:10]}"


def _truthy(s: str) -> bool:
    return s.strip().lower() in ("1", "true", "yes", "y", "on")


class PMTAdapter(BrokerAdapter):
    """Single-account PMT routing — the user's existing $50/mo PMT
    subscription used as the master execution path. TradeSyncer (set up
    separately by the user) watches the resulting position on the master
    account and copies to all other prop firms.

    We don't use PMT's `multiple_accounts` copier feature here because the
    user is paying for it on TradeSyncer instead (cheaper for >1 account).
    """

    name = "pmt"
    env = os.getenv("PMT_ENV", "live")  # "demo" | "live"

    def __init__(self) -> None:
        self.url = os.getenv("PMT_WEBHOOK_URL", "").strip()
        self.token = os.getenv("PMT_TOKEN", "").strip()
        self.account_id = os.getenv("PMT_ACCOUNT_ID", "").strip()
        self.symbol = os.getenv("PMT_SYMBOL", "MNQ1!").strip()
        self.is_demo = _truthy(os.getenv("PMT_RUN_AS_DEMO", "true"))
        self.timeout = float(os.getenv("PMT_TIMEOUT", "5.0"))
        if not self.url:
            raise RuntimeError("PMT_WEBHOOK_URL is not set — PMT adapter cannot start.")
        if not self.token:
            raise RuntimeError("PMT_TOKEN is not set — PMT adapter cannot start.")
        if not self.account_id:
            raise RuntimeError("PMT_ACCOUNT_ID is not set — PMT adapter cannot start.")
        if httpx is None:
            raise RuntimeError("httpx is not installed — add it to requirements.txt")

    # ------------------------------------------------------------------
    # Internal: HTTP POST + per-account block builder
    # ------------------------------------------------------------------
    def _post(self, payload: dict) -> tuple[bool, dict | None, str | None]:
        try:
            with httpx.Client(timeout=self.timeout) as client:
                resp = client.post(self.url, json=payload)
            ok = 200 <= resp.status_code < 300
            try:
                body = resp.json()
            except Exception:
                body = {"raw": resp.text}
            if not ok:
                log.warning("PMT POST -> %d %s", resp.status_code, body)
            return ok, body, None if ok else f"HTTP {resp.status_code}"
        except Exception as e:
            log.exception("PMT POST failed")
            return False, None, f"{type(e).__name__}: {e}"

    def _acct_block(self, multiplier: float = 1.0) -> dict:
        return {
            "token": self.token,
            "account_id": self.account_id,
            "risk_percentage": 0,
            "quantity_multiplier": multiplier,
        }

    # ------------------------------------------------------------------
    # Payload builders — match the shapes TM v20.80 sends to PMT today
    # ------------------------------------------------------------------
    def _entry_payload(self, *, ticker: str, side: str, qty: int,
                        stop_px: Optional[float], entry_px_hint: Optional[float],
                        tp_groups: Optional[list[dict]] = None) -> dict:
        # tp_groups is the `advance_tp_sl` array PMT expects (TP1/TP2/TP3 + runner).
        # If omitted, we send a single-group bracket with the runner.
        side_l = "buy" if side.upper() == "LONG" else "sell"
        if tp_groups is None:
            run_tp = 99999.0 if side.upper() == "LONG" else 1.0
            tp_groups = [{
                "quantity": qty,
                "tp": run_tp,
                "percentage_tp": 0,
                "dollar_tp": 0,
                "sl": stop_px or 0,
                "percentage_sl": 0,
                "dollar_sl": 0,
                "breakeven": 0,
                "breakeven_offset": 0,
                "trail": 0,
                "trail_stop": 0,
                "trail_trigger": 0,
                "trail_freq": 0,
            }]
        return {
            "symbol": self.symbol or ticker,
            "data": side_l,
            "quantity": qty,
            "risk_percentage": 0,
            "price": entry_px_hint or 0,
            "gtd_in_second": 0,
            "stp_limit_stp_price": 0,
            "update_tp": False,
            "update_sl": False,
            "breakeven_offset": 0,
            "token": self.token,
            "pyramid": False,
            "same_direction_ignore": False,
            "reverse_order_close": True,
            "order_type": "MKT",
            "advance_tp_sl": tp_groups,
            "multiple_accounts": [self._acct_block()],
        }

    def _close_payload(self) -> dict:
        # Full-flatten close — matches the verified working MFF close shape
        # the user's TM uses (see line ~3567 in TM_Compact_20.80.pine).
        return {
            "symbol": self.symbol,
            "data": "CLOSE",
            "quantity": 0,
            "full_closed": True,
            "token": self.token,
            "account_id": self.account_id,
            "risk_percentage": 0.0,
            "comment": "",
            "breakeven": 0,
            "trail_stop": 0,
            "trail_trigger": 0,
            "trail_freq": 0,
            "trail": 0,
            "price": 0,
            "tp": 0,
            "stp_limit_stp_price": 0,
            "sl": 0,
            "main_token_type": "DEMO" if self.is_demo else "LIVE",
            "duplicate_position_allow": True,
            "order_type": None,
            "dollar_tp": 0,
            "dollar_sl": 0,
            "reverse_order_close": False,
            "update_tp": False,
            "update_sl": False,
            "percentage_tp": 0,
            "percentage_sl": 0,
            "same_direction_ignore": False,
            "gtd_in_second": 0,
            "reverse_action": False,
            "created_first": "",
            "strategy_name": "",
            "tif": "GTC",
            "breakeven_offset": 0,
        }

    def _partial_close_payload(self, *, side: str, close_qty: int) -> dict:
        # Partial close = opposite-direction market order for `close_qty`.
        opp_side = "sell" if side.upper() == "LONG" else "buy"
        return {
            "symbol": self.symbol,
            "data": opp_side,
            "quantity": close_qty,
            "token": self.token,
            "multiple_accounts": [self._acct_block()],
        }

    # ------------------------------------------------------------------
    # BrokerAdapter interface
    # ------------------------------------------------------------------
    def open_position(self, *, ticker, side, qty, stop_px=None, entry_px_hint=None) -> BrokerResult:
        payload = self._entry_payload(
            ticker=ticker, side=side, qty=qty,
            stop_px=stop_px, entry_px_hint=entry_px_hint,
        )
        ok, body, err = self._post(payload)
        return BrokerResult(
            success=ok,
            order_id=(body or {}).get("order_id") or _id("entry"),
            stop_order_id=(body or {}).get("stop_order_id") or (_id("stop") if stop_px else None),
            fill_price=(body or {}).get("fill_price") or entry_px_hint,
            position_qty=qty if side.upper() == "LONG" else -qty,
            message="pmt entry" if ok else f"pmt error: {err}",
            error=err,
            raw=body,
        )

    def modify_stop(self, *, broker_stop_order_id, new_stop_px, ticker, side, qty_open) -> BrokerResult:
        # PMT does not support modifying an existing stop — it would
        # cancel the position. So stop drags from Pine intentionally do
        # NOT propagate to PMT; the indicator manages stops visually and
        # we fire CLOSE when the indicator's stop is hit (handled by
        # close_position). Surface this in the result so the dashboard
        # shows it.
        return BrokerResult(
            success=True,
            stop_order_id=broker_stop_order_id,
            message=f"pmt: stop tracked locally ({new_stop_px}); broker keeps original",
        )

    def close_partial(self, *, ticker, side, close_qty, entry_px_hint=None) -> BrokerResult:
        payload = self._partial_close_payload(side=side, close_qty=close_qty)
        ok, body, err = self._post(payload)
        return BrokerResult(
            success=ok,
            order_id=(body or {}).get("order_id") or _id("partial"),
            fill_price=(body or {}).get("fill_price"),
            message=f"pmt partial close {close_qty}" if ok else f"pmt error: {err}",
            error=err,
            raw=body,
        )

    def close_position(self, *, ticker, side, qty_open,
                        broker_stop_order_id=None, broker_order_id=None) -> BrokerResult:
        payload = self._close_payload()
        ok, body, err = self._post(payload)
        return BrokerResult(
            success=ok,
            order_id=(body or {}).get("order_id") or _id("close"),
            position_qty=0,
            message=f"pmt flatten {qty_open}" if ok else f"pmt error: {err}",
            error=err,
            raw=body,
        )
