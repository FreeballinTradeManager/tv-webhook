"""
Broker adapter registry.

Use `get_broker()` to obtain the current adapter. Selection logic:

  - Tradovate credentials present in env  →  TradovateAdapter
  - Otherwise                             →  SimulatedAdapter

The adapter contract is defined in `app.brokers.base`. New adapters
(MT5, TopstepX, etc.) implement that interface and register themselves
in this factory.
"""

from __future__ import annotations

import os
from functools import lru_cache

from .base import BrokerAdapter
from .simulated import SimulatedAdapter


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
    if _tradovate_creds_present():
        # Lazy import so missing optional deps don't break the simulated path.
        from .tradovate import TradovateAdapter
        return TradovateAdapter()
    return SimulatedAdapter()


def reset_broker_cache() -> None:
    """Used in tests + when env vars change at runtime."""
    get_broker.cache_clear()
