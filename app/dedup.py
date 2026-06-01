"""
Content-hash deduplication + auto trade_id generation.

The Pine indicator sometimes fires the same alert() multiple times within
seconds (TM v20.80's `_srv_entry_sent` flag occasionally fails after
recompiles, and `alert.freq_all` is used so any same-bar re-eval re-fires).
Until the v20.81 patch is applied we absorb the spam server-side.

Strategy:
  - Hash a tuple of the payload fields that identify a unique event:
    (ticker, event, side, qty, entry_px, stop_px, source)
  - Keep an in-process LRU of recent hashes (60s TTL).
  - If the same hash arrives within the window → reject as duplicate.

For ENTRY events without an explicit trade_id, we synthesise one from
(ticker, side, minute_bucket). Within the same minute, two ENTRYs on the
same side of the same ticker collapse to one trade — handles the
"spam in 8 seconds" case automatically.

For non-ENTRY events (STOP_UPDATE / TPx / CLOSE) without trade_id, we
look up the most recent OPEN/PARTIAL Position for that ticker and reuse
its trade_id. Stops/TPs naturally land on the active trade.
"""

from __future__ import annotations

import hashlib
import time
from threading import RLock
from typing import Any, Optional


# How long a payload hash stays "recent" before it's considered a fresh
# event. Tuned for Pine spam — same alert re-fired within 60s = dup.
DEDUP_TTL_SECONDS = 60.0


def _payload_hash(p: dict[str, Any]) -> str:
    """Stable fingerprint of the event payload (minus auth + trade_id)."""
    # Use a small subset — fields that together identify a unique event.
    # Excluding "key" because that's auth, and event_id/trade_id because
    # those are what we're trying to synthesize.
    keys = (
        "event", "ticker", "side", "qty",
        "entry_px", "stop_px",
        "tp1_px", "tp2_px", "tp3_px",
        "close_qty", "remaining_qty",
        "source",
    )
    parts = [str(p.get(k, "")) for k in keys]
    blob = "|".join(parts)
    return hashlib.sha1(blob.encode("utf-8")).hexdigest()[:16]


class DedupCache:
    """In-process recent-hash store. Cheap, single-process. Resets on restart."""

    def __init__(self, ttl: float = DEDUP_TTL_SECONDS) -> None:
        self._lock = RLock()
        self._store: dict[str, float] = {}  # hash -> expires_at
        self._ttl = ttl

    def _gc(self, now: float) -> None:
        # Cheap inline expiry sweep — called on every check.
        if len(self._store) < 256:
            return
        for k in list(self._store):
            if self._store[k] < now:
                del self._store[k]

    def seen_recently(self, h: str) -> bool:
        now = time.time()
        with self._lock:
            self._gc(now)
            exp = self._store.get(h)
            return exp is not None and exp >= now

    def mark(self, h: str) -> None:
        now = time.time()
        with self._lock:
            self._store[h] = now + self._ttl


cache = DedupCache()


def is_duplicate(payload: dict[str, Any]) -> tuple[bool, str]:
    """Returns (is_duplicate, hash_used_for_dedup).

    Call this BEFORE saving. If True, drop the event without writing
    to webhook_signals.
    """
    h = _payload_hash(payload)
    return cache.seen_recently(h), h


def mark_seen(h: str) -> None:
    cache.mark(h)


# ---------------------------------------------------------------------------
# trade_id synthesis
# ---------------------------------------------------------------------------

def synth_entry_trade_id(ticker: str, side: str, ts: Optional[float] = None) -> str:
    """Deterministic trade_id for an ENTRY missing one.

    Same minute + same side + same ticker → same trade_id.
    Handles the "same entry fires 16 times in 8 seconds" case naturally:
    all 16 collapse to one trade_id, server sees them as duplicates of
    the first ENTRY, only ONE Position row gets created.
    """
    now = ts if ts is not None else time.time()
    minute = int(now // 60)
    safe_ticker = (ticker or "UNKNOWN").replace(" ", "")
    safe_side = (side or "UNKNOWN").upper()
    return f"AUTO-{safe_ticker}-{minute}-{safe_side}"


def synth_event_id(trade_id: str, event: str) -> str:
    """Deterministic event_id when one isn't supplied.

    Uses the trade_id (which is itself minute-bucketed) so duplicate
    events within the same minute on the same trade get the same
    event_id and are caught by the unique-index dup check.
    """
    return f"{trade_id}-{event.upper()}"
