"""
TradovateAdapter — implements BrokerAdapter using TradovateClient.

Mapping from BrokerAdapter calls to Tradovate REST:

  open_position(side=LONG, qty=4, stop_px=24780)
      → place_market_order(Buy, 4)              # the entry
      → place_stop_order(Sell, 4, stop=24780)   # the bracket stop
      → returns BrokerResult(order_id=<entry>, stop_order_id=<stop>,
                              fill_price=<entry fill>)

  modify_stop(broker_stop_order_id=..., new_stop_px=24820)
      → modify_order(orderId, stop=24820)

  close_partial(side=LONG, close_qty=1)
      → place_market_order(Sell, 1)             # opposite side

  close_position(...)
      → place_market_order(<opposite>, qty_open)
      → cancel_order(stop_order_id)             # cancel the bracket stop

Errors are returned as BrokerResult(success=False, message=...) — the
executor decides whether to roll back state machine transitions. For
now we still advance state on broker failure (so dashboard stays
consistent with Pine's view) but mark the position with broker_error
so the user can see something went wrong.
"""

from __future__ import annotations

import logging
from typing import Optional

from .base import BrokerAdapter, BrokerResult
from .tradovate_client import TradovateClient, TradovateError
from ..assets import asset_root

log = logging.getLogger("tv-webhook.tradovate.adapter")


def _opposite(side: str) -> str:
    return "Sell" if side.upper() == "LONG" else "Buy"


def _entry_action(side: str) -> str:
    return "Buy" if side.upper() == "LONG" else "Sell"


def _fill_price_from_order(resp: dict) -> Optional[float]:
    # Tradovate placeorder response varies — sometimes returns just the
    # orderId, sometimes a full order command result. Best-effort
    # extraction; None when the order hasn't been filled synchronously.
    for k in ("avgPrice", "filledPrice", "price"):
        v = resp.get(k)
        if v is not None:
            return float(v)
    return None


def _order_id_from_resp(resp: dict) -> Optional[str]:
    for k in ("orderId", "id", "commandId"):
        v = resp.get(k)
        if v is not None:
            return str(v)
    return None


class TradovateAdapter(BrokerAdapter):
    name = "tradovate"

    def __init__(self, client: Optional[TradovateClient] = None) -> None:
        self.client = client or TradovateClient()
        self.env = self.client.env

    # ------------------------------------------------------------------
    # BrokerAdapter implementation
    # ------------------------------------------------------------------

    def open_position(self, *, ticker, side, qty, stop_px=None, entry_px_hint=None) -> BrokerResult:
        root = asset_root(ticker) or ticker
        try:
            entry_resp = self.client.place_market_order(
                root=root, action=_entry_action(side), qty=qty,
            )
        except TradovateError as e:
            log.warning("tradovate entry failed: %s", e)
            return BrokerResult(success=False, message=f"entry: {e}")

        order_id = _order_id_from_resp(entry_resp)
        fill_price = _fill_price_from_order(entry_resp) or entry_px_hint

        # Place the protective stop on the opposite side. If the entry
        # failed we already returned above.
        stop_order_id = None
        if stop_px is not None:
            try:
                stop_resp = self.client.place_stop_order(
                    root=root, action=_opposite(side), qty=qty, stop_px=stop_px,
                )
                stop_order_id = _order_id_from_resp(stop_resp)
            except TradovateError as e:
                # Don't fail the whole open_position call — entry is filled,
                # just surface the stop failure so the user can manually
                # place a stop.
                log.error("tradovate stop placement failed after entry: %s", e)
                return BrokerResult(
                    success=True,
                    order_id=order_id,
                    fill_price=fill_price,
                    position_qty=qty if side.upper() == "LONG" else -qty,
                    message=f"entry ok BUT stop failed: {e}",
                    raw=entry_resp,
                )

        return BrokerResult(
            success=True,
            order_id=order_id,
            stop_order_id=stop_order_id,
            fill_price=fill_price,
            position_qty=qty if side.upper() == "LONG" else -qty,
            raw=entry_resp,
        )

    def modify_stop(self, *, broker_stop_order_id, new_stop_px, ticker, side, qty_open) -> BrokerResult:
        if not broker_stop_order_id:
            # We never placed a stop, or lost the id. Place a new one.
            root = asset_root(ticker) or ticker
            try:
                resp = self.client.place_stop_order(
                    root=root, action=_opposite(side), qty=qty_open, stop_px=new_stop_px,
                )
                return BrokerResult(
                    success=True,
                    stop_order_id=_order_id_from_resp(resp),
                    message="placed new stop (no prior id)",
                    raw=resp,
                )
            except TradovateError as e:
                return BrokerResult(success=False, message=f"new stop: {e}")
        # Otherwise modify the existing stop.
        try:
            resp = self.client.modify_order(
                order_id=int(broker_stop_order_id),
                new_stop_px=new_stop_px,
                qty=qty_open,
            )
            return BrokerResult(
                success=True,
                stop_order_id=str(broker_stop_order_id),
                message=f"stop -> {new_stop_px}",
                raw=resp,
            )
        except TradovateError as e:
            return BrokerResult(success=False, message=f"modify_stop: {e}")

    def close_partial(self, *, ticker, side, close_qty, entry_px_hint=None) -> BrokerResult:
        root = asset_root(ticker) or ticker
        try:
            resp = self.client.place_market_order(
                root=root, action=_opposite(side), qty=close_qty,
            )
        except TradovateError as e:
            return BrokerResult(success=False, message=f"partial close: {e}")
        return BrokerResult(
            success=True,
            order_id=_order_id_from_resp(resp),
            fill_price=_fill_price_from_order(resp),
            raw=resp,
        )

    def close_position(self, *, ticker, side, qty_open,
                        broker_stop_order_id=None, broker_order_id=None) -> BrokerResult:
        root = asset_root(ticker) or ticker
        errs = []

        flat_id: Optional[str] = None
        flat_fill: Optional[float] = None
        if qty_open > 0:
            try:
                resp = self.client.place_market_order(
                    root=root, action=_opposite(side), qty=qty_open,
                )
                flat_id = _order_id_from_resp(resp)
                flat_fill = _fill_price_from_order(resp)
            except TradovateError as e:
                errs.append(f"flatten: {e}")

        # Cancel the bracket stop — if it's still resting at the broker
        # we don't want it filling after we're already flat.
        if broker_stop_order_id:
            try:
                self.client.cancel_order(order_id=int(broker_stop_order_id))
            except TradovateError as e:
                errs.append(f"cancel stop: {e}")

        if errs and flat_id is None:
            return BrokerResult(success=False, message="; ".join(errs))
        return BrokerResult(
            success=True,
            order_id=flat_id,
            fill_price=flat_fill,
            position_qty=0,
            message="; ".join(errs) if errs else None,
        )

    def fetch_open_positions(self) -> list[dict]:
        try:
            return self.client.get_open_positions()
        except TradovateError as e:
            log.warning("fetch_open_positions failed: %s", e)
            return []
