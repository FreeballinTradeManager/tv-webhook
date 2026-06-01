"""
In-process latest-price store.

Populated by the Tradovate MD WebSocket task (when broker creds are
present). Read by the PnL serializer / live PnL broadcast loop.

Keys are normalized asset roots (asset_root('MNQ1!') == 'MNQ') so we
don't accidentally store the same instrument under two different ticker
strings.
"""

from __future__ import annotations

import time
from threading import RLock
from typing import Optional

from .assets import asset_root


class QuoteStore:
    def __init__(self) -> None:
        self._lock = RLock()
        self._quotes: dict[str, dict] = {}  # root -> {last, bid, ask, ts}

    def update(
        self,
        ticker: str,
        *,
        last: Optional[float] = None,
        bid: Optional[float] = None,
        ask: Optional[float] = None,
    ) -> None:
        root = asset_root(ticker) or (ticker or "").upper()
        if not root:
            return
        now = time.time()
        with self._lock:
            entry = self._quotes.setdefault(root, {})
            if last is not None:
                entry["last"] = float(last)
            if bid is not None:
                entry["bid"] = float(bid)
            if ask is not None:
                entry["ask"] = float(ask)
            entry["ts"] = now

    def get(self, ticker: str) -> Optional[dict]:
        root = asset_root(ticker) or (ticker or "").upper()
        with self._lock:
            return dict(self._quotes.get(root, {})) or None

    def last_price(self, ticker: str) -> Optional[float]:
        q = self.get(ticker)
        if not q:
            return None
        return q.get("last") or ((q.get("bid", 0) + q.get("ask", 0)) / 2 if q.get("bid") and q.get("ask") else None)

    def snapshot(self) -> dict[str, dict]:
        with self._lock:
            return {k: dict(v) for k, v in self._quotes.items()}


# Module-level singleton — imported wherever live price is needed.
store = QuoteStore()
