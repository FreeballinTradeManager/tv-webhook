"""
TradeSyncerAdapter — execute trades via TradeSyncer's webhook endpoint.

TradeSyncer is a copy-trading platform that connects to Tradovate (and a
few other brokers) via the user's regular login — no Tradovate API
subscription required. Their product is designed for "one master account
copied to many slaves with multipliers", which is exactly the
prop-firm-copy use case here.

Architecture: we POST trade signals to a single TradeSyncer webhook URL
configured per master. TradeSyncer's platform then places the order on
the master broker AND copies to every slave configured in their UI with
the per-slave multiplier they own. We don't need to know about slaves
on our side — TradeSyncer handles that fan-out.

ENV VARS (set on Railway when ready):
  TRADESYNCER_WEBHOOK_URL  - the URL TradeSyncer gave you (per master)
  TRADESYNCER_TOKEN        - optional auth token if their setup uses one
  TRADESYNCER_AUTH_HEADER  - optional, defaults to "Authorization: Bearer <token>"
  TRADESYNCER_PAYLOAD      - "tradersport-style" (default) | "custom" — set
                             once the user confirms which shape their TS
                             expects. Lots of copy services use the
                             TradersPost shape because TV plugin templates
                             default to it.

When env vars are missing the factory in brokers/__init__.py falls back
to SimulatedAdapter so nothing breaks at startup.
"""

from __future__ import annotations

import logging
import os
import time
import uuid
from typing import Optional

try:
    import httpx
except ImportError:
    httpx = None  # type: ignore

from .base import BrokerAdapter, BrokerResult

log = logging.getLogger("tv-webhook.brokers.tradesyncer")


def _tsid(prefix: str) -> str:
    return f"ts-{prefix}-{uuid.uuid4().hex[:10]}"


class TradeSyncerAdapter(BrokerAdapter):
    name = "tradesyncer"
    env = os.getenv("TRADESYNCER_ENV", "demo")  # "demo" | "live"

    def __init__(self) -> None:
        self.url = os.getenv("TRADESYNCER_WEBHOOK_URL", "").strip()
        self.token = os.getenv("TRADESYNCER_TOKEN", "").strip()
        self.payload_style = os.getenv("TRADESYNCER_PAYLOAD", "tradersport-style").strip()
        self.timeout = float(os.getenv("TRADESYNCER_TIMEOUT", "5.0"))
        if not self.url:
            raise RuntimeError(
                "TRADESYNCER_WEBHOOK_URL is not set — TradeSyncer adapter cannot start."
            )
        if httpx is None:
            raise RuntimeError("httpx is not installed — add it to requirements.txt")

    # ------------------------------------------------------------------
    # Internal HTTP helper
    # ------------------------------------------------------------------
    def _post(self, payload: dict) -> tuple[bool, dict | None, str | None]:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        try:
            with httpx.Client(timeout=self.timeout) as client:
                resp = client.post(self.url, json=payload, headers=headers)
            ok = 200 <= resp.status_code < 300
            try:
                body = resp.json()
            except Exception:
                body = {"raw": resp.text}
            if not ok:
                log.warning("tradesyncer POST %s -> %d %s", self.url, resp.status_code, body)
            return ok, body, None if ok else f"HTTP {resp.status_code}"
        except Exception as e:
            log.exception("tradesyncer POST failed")
            return False, None, f"{type(e).__name__}: {e}"

    # ------------------------------------------------------------------
    # Payload shapers — extend once user confirms TS's exact format
    # ------------------------------------------------------------------
    def _shape_entry(self, *, ticker: str, side: str, qty: int,
                      stop_px: Optional[float], entry_px_hint: Optional[float]) -> dict:
        s = side.upper()
        if self.payload_style == "tradersport-style":
            return {
                "ticker": ticker,
                "action": "buy" if s == "LONG" else "sell",
                "sentiment": "bullish" if s == "LONG" else "bearish",
                "quantity": qty,
                "quantityType": "fixed_quantity",
                "orderType": "market",
                "stopLoss": {"type": "stop", "stopPrice": stop_px} if stop_px else None,
            }
        # default: TradeSyncer's own shape (their docs format — placeholder)
        return {
            "action": "open",
            "symbol": ticker,
            "side": s.lower(),
            "quantity": qty,
            "stop_loss": stop_px,
            "entry_hint": entry_px_hint,
        }

    def _shape_stop_modify(self, *, ticker: str, side: str, new_stop_px: float, qty_open: int) -> dict:
        if self.payload_style == "tradersport-style":
            return {
                "ticker": ticker,
                "action": "modify_stop",
                "stopLoss": {"type": "stop", "stopPrice": new_stop_px},
            }
        return {
            "action": "modify_stop",
            "symbol": ticker,
            "side": side.lower(),
            "stop_loss": new_stop_px,
            "quantity": qty_open,
        }

    def _shape_partial(self, *, ticker: str, side: str, close_qty: int) -> dict:
        exit_side = "sell" if side.upper() == "LONG" else "buy"
        if self.payload_style == "tradersport-style":
            return {
                "ticker": ticker,
                "action": "exit",
                "quantity": close_qty,
                "quantityType": "fixed_quantity",
                "orderType": "market",
            }
        return {"action": "partial_close", "symbol": ticker, "side": exit_side, "quantity": close_qty}

    def _shape_flatten(self, *, ticker: str, side: str, qty_open: int) -> dict:
        if self.payload_style == "tradersport-style":
            return {"ticker": ticker, "action": "exit"}
        return {"action": "close", "symbol": ticker, "side": side.lower(), "quantity": qty_open}

    # ------------------------------------------------------------------
    # BrokerAdapter interface
    # ------------------------------------------------------------------
    def open_position(self, *, ticker, side, qty, stop_px=None, entry_px_hint=None) -> BrokerResult:
        payload = self._shape_entry(ticker=ticker, side=side, qty=qty,
                                     stop_px=stop_px, entry_px_hint=entry_px_hint)
        ok, body, err = self._post(payload)
        return BrokerResult(
            success=ok,
            order_id=(body or {}).get("order_id") or _tsid("entry"),
            stop_order_id=(body or {}).get("stop_order_id") or (_tsid("stop") if stop_px else None),
            fill_price=(body or {}).get("fill_price") or entry_px_hint,
            position_qty=qty if side.upper() == "LONG" else -qty,
            message="tradesyncer open" if ok else f"tradesyncer error: {err}",
            error=err,
            raw=body,
        )

    def modify_stop(self, *, broker_stop_order_id, new_stop_px, ticker, side, qty_open) -> BrokerResult:
        payload = self._shape_stop_modify(ticker=ticker, side=side,
                                           new_stop_px=new_stop_px, qty_open=qty_open)
        ok, body, err = self._post(payload)
        return BrokerResult(
            success=ok,
            stop_order_id=(body or {}).get("stop_order_id") or broker_stop_order_id or _tsid("stop"),
            message=f"tradesyncer stop -> {new_stop_px}" if ok else f"tradesyncer error: {err}",
            error=err,
            raw=body,
        )

    def close_partial(self, *, ticker, side, close_qty, entry_px_hint=None) -> BrokerResult:
        payload = self._shape_partial(ticker=ticker, side=side, close_qty=close_qty)
        ok, body, err = self._post(payload)
        return BrokerResult(
            success=ok,
            order_id=(body or {}).get("order_id") or _tsid("partial"),
            fill_price=(body or {}).get("fill_price"),
            message=f"tradesyncer partial close {close_qty}" if ok else f"tradesyncer error: {err}",
            error=err,
            raw=body,
        )

    def close_position(self, *, ticker, side, qty_open,
                        broker_stop_order_id=None, broker_order_id=None) -> BrokerResult:
        payload = self._shape_flatten(ticker=ticker, side=side, qty_open=qty_open)
        ok, body, err = self._post(payload)
        return BrokerResult(
            success=ok,
            order_id=(body or {}).get("order_id") or _tsid("close"),
            position_qty=0,
            message=f"tradesyncer flatten {qty_open}" if ok else f"tradesyncer error: {err}",
            error=err,
            raw=body,
        )
