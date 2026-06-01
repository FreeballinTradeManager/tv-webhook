"""
BrokerAdapter contract.

The executor owns the position state machine + validation. Side-effects
(actually placing orders, modifying stops, closing positions) are
delegated to a BrokerAdapter implementation.

For the simulated adapter, methods return fake ids and the recorded
entry price so the dashboard has something to show. For the Tradovate
adapter, methods hit the real REST API and return broker-issued ids.

Every method returns a BrokerResult — success/failure + the ids and
fill price we need to persist on Position.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Any


@dataclass
class BrokerResult:
    success: bool
    # IDs that should be persisted on the Position row so we can refer
    # back to them on subsequent calls (modify_stop, cancel, close).
    order_id: Optional[str] = None
    stop_order_id: Optional[str] = None
    # Real fill price reported by the broker. None if the order is async
    # (still working) — we'll learn the fill later from a fills stream.
    fill_price: Optional[float] = None
    # Broker's view of the resulting position quantity (signed: +ve LONG).
    position_qty: Optional[int] = None
    # Human-readable error / status message; populated when success is False
    # or when the broker has extra context to surface to the dashboard.
    message: Optional[str] = None
    # Anything else we want to persist for debugging — never required for
    # state machine correctness.
    raw: dict[str, Any] = field(default_factory=dict)


class BrokerAdapter:
    """Abstract broker. Implementations must override these four methods."""

    name: str = "abstract"

    # Identifies the environment for the dashboard / logs (e.g. "demo",
    # "live", "sim"). Helps avoid catastrophic foot-guns like sending a
    # live order while you think you're in demo.
    env: str = "unknown"

    def open_position(
        self,
        *,
        ticker: str,
        side: str,                       # "LONG" or "SHORT"
        qty: int,
        stop_px: Optional[float] = None,
        entry_px_hint: Optional[float] = None,
    ) -> BrokerResult:
        raise NotImplementedError

    def modify_stop(
        self,
        *,
        broker_stop_order_id: Optional[str],
        new_stop_px: float,
        ticker: str,
        side: str,
        qty_open: int,
    ) -> BrokerResult:
        raise NotImplementedError

    def close_partial(
        self,
        *,
        ticker: str,
        side: str,
        close_qty: int,
        entry_px_hint: Optional[float] = None,
    ) -> BrokerResult:
        """Market-sell (LONG) / market-buy (SHORT) of close_qty contracts.
        Used for TP1/2/3 and CLOSE50."""
        raise NotImplementedError

    def close_position(
        self,
        *,
        ticker: str,
        side: str,
        qty_open: int,
        broker_stop_order_id: Optional[str] = None,
        broker_order_id: Optional[str] = None,
    ) -> BrokerResult:
        """Flatten the entire remaining position. Used for MASTER_CLOSE /
        STOP_HIT / EMA_EXIT / CLOSE_FALLBACK. Should also cancel the
        bracket stop order if one was placed."""
        raise NotImplementedError

    # Optional reconciliation hook — returns broker's view of positions
    # for the connected account. Empty list = no positions / not
    # implemented for this adapter.
    def fetch_open_positions(self) -> list[dict[str, Any]]:
        return []
