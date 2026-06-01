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


def _pmt_present() -> bool:
    return all(
        os.getenv(k, "").strip()
        for k in ("PMT_WEBHOOK_URL", "PMT_TOKEN", "PMT_ACCOUNT_ID")
    )


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
    """Selection priority (highest first):

      1. PMT (user's preferred prop firm execution path — cheap when
         paired with TradeSyncer master-watch for the actual fan-out)
      2. TradeSyncer webhook (when used as the primary signal sink)
      3. Tradovate direct REST API (when API approval comes through)
      4. Simulated (default — state machine works without broker calls)
    """
    # Lazy imports so missing optional deps (httpx, websockets, ...) don't
    # break the simulated path.
    if _pmt_present():
        from .pmt import PMTAdapter
        try:
            return PMTAdapter()
        except Exception as e:
            import logging
            logging.getLogger("tv-webhook.brokers").warning(
                "PMTAdapter failed to init (%s) — falling back to next", e,
            )
    if _tradesyncer_present():
        from .tradesyncer import TradeSyncerAdapter
        try:
            return TradeSyncerAdapter()
        except Exception as e:
            import logging
            logging.getLogger("tv-webhook.brokers").warning(
                "TradeSyncerAdapter failed to init (%s) — falling back to next", e,
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
