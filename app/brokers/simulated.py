"""
SimulatedAdapter — returns synthetic order ids and uses the hint prices.

This preserves the project's current behavior exactly: the dashboard
still shows position state and stop movements, but no real broker call
is made. Active by default until Tradovate credentials are set.
"""

from __future__ import annotations

import uuid
from typing import Optional

from .base import BrokerAdapter, BrokerResult


def _sim_id(prefix: str) -> str:
    return f"sim-{prefix}-{uuid.uuid4().hex[:10]}"


class SimulatedAdapter(BrokerAdapter):
    name = "simulated"
    env = "sim"

    def open_position(self, *, ticker, side, qty, stop_px=None, entry_px_hint=None) -> BrokerResult:
        return BrokerResult(
            success=True,
            order_id=_sim_id("entry"),
            stop_order_id=_sim_id("stop") if stop_px is not None else None,
            fill_price=entry_px_hint,
            position_qty=qty if side.upper() == "LONG" else -qty,
            message="simulated fill",
        )

    def modify_stop(self, *, broker_stop_order_id, new_stop_px, ticker, side, qty_open) -> BrokerResult:
        # If there was no existing stop order id (e.g. dropped earlier),
        # we create a new synthetic one — keeps later modify_stop calls
        # idempotent.
        return BrokerResult(
            success=True,
            stop_order_id=broker_stop_order_id or _sim_id("stop"),
            message=f"simulated stop -> {new_stop_px}",
        )

    def close_partial(self, *, ticker, side, close_qty, entry_px_hint=None) -> BrokerResult:
        return BrokerResult(
            success=True,
            order_id=_sim_id("partial"),
            fill_price=entry_px_hint,
            message=f"simulated partial close {close_qty}",
        )

    def close_position(self, *, ticker, side, qty_open,
                        broker_stop_order_id=None, broker_order_id=None) -> BrokerResult:
        return BrokerResult(
            success=True,
            order_id=_sim_id("close"),
            position_qty=0,
            message=f"simulated flatten {qty_open}",
        )
