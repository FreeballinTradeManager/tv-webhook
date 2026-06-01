"""
Broker adapter registry.

Use `get_broker()` to obtain the current adapter. Selection priority:

  1. TradeSyncer webhook URL present in env  →  TradeSyncerAdapter
     (preferred when wired — handles master + slave fan-out for prop
     firm copy trading on Tradovate/MT5 accounts)
  2. Tradovate REST creds present in env    →  TradovateAdapter
     (direct API to user's personal Tradovate — when approved)
  3. Otherwise                              →  SimulatedAdapter
     (default fallback — state machine works, no real orders)

The adapter contract is defined in `app.brokers.base`. New adapters
(MT5, TopstepX, etc.) implement that interface and register themselves
in this factory.
"""

from __future__ import annotations

import os
from functools import lru_cache

from .base import BrokerAdapter
from .simulated import SimulatedAdapter


def _tradesyncer_present() -> bool:
    # Only the URL is strictly required; token is optional depending on
    # how the user's TradeSyncer webhook is configured.
    return bool(os.getenv("TRADESYNCER_WEBHOOK_URL", "").strip())


def _tradovate_creds_present() -> bool:
    return all(
        os.getenv(k) for k in (
            "TRADOVATE_USERNAME",
            "TRADOVATE_PASSWORD",
            "TRADOVATE_CID",
            "TRADOVATE_SECRET",
        )
    )


@lru_cache(maxsize=1)
def get_broker() -> BrokerAdapter:
    # Lazy imports so missing optional deps (httpx, websockets, ...) don't
    # break the simulated path.
    if _tradesyncer_present():
        from .tradesyncer import TradeSyncerAdapter
        try:
            return TradeSyncerAdapter()
        except Exception as e:
            # If wiring is bad (missing httpx, etc.) fall through to
            # simulated rather than crashing the app at boot.
            import logging
            logging.getLogger("tv-webhook.brokers").warning(
                "TradeSyncerAdapter failed to init (%s) — falling back to simulated", e,
            )
    if _tradovate_creds_present():
        from .tradovate import TradovateAdapter
        try:
            return TradovateAdapter()
        except Exception as e:
            import logging
            logging.getLogger("tv-webhook.brokers").warning(
                "TradovateAdapter failed to init (%s) — falling back to simulated", e,
            )
    return SimulatedAdapter()


def reset_broker_cache() -> None:
    """Used in tests + when env vars change at runtime."""
    get_broker.cache_clear()
