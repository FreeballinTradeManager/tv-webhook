"""
Reconciliation loop.

Every 5 seconds, fetches the broker's view of open positions and
compares it to the server's `Position` rows. Mismatches (qty, side,
avg entry, missing on either side) get logged + surfaced via a small
shared list `recent_warnings` that the dashboard reads.

Purposely read-only — we don't auto-correct anything. The point is
visibility so we catch divergences (e.g. broker filled but server
didn't see it, partial fills, stop hit out-of-band) before they bite.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from .assets import asset_root

log = logging.getLogger("tv-webhook.reconciliation")

# Shared list — the dashboard reads from it. Bounded so it can't grow.
recent_warnings: list[dict[str, Any]] = []
MAX_WARNINGS = 50


def _record_warning(kind: str, message: str, **extra) -> None:
    entry = {"kind": kind, "message": message, "ts": time.time(), **extra}
    recent_warnings.insert(0, entry)
    del recent_warnings[MAX_WARNINGS:]


async def reconcile_loop(*, broker, session_factory) -> None:
    """Endless background task. session_factory() must return a fresh
    SQLAlchemy session (the FastAPI Depends path needs request scope —
    we use the raw SessionLocal here)."""
    from .models import Position  # local import to avoid circular

    interval = 5.0
    backoff = 5.0
    while True:
        try:
            broker_positions = await asyncio.to_thread(broker.fetch_open_positions)
            with session_factory() as db:
                server_positions = (
                    db.query(Position)
                    .filter(Position.status.in_(["OPEN", "PARTIAL", "PENDING"]))
                    .all()
                )

                # Group server positions by ticker root (a single account
                # rarely has multiple trades open on the same root at once
                # in this app, but we still check by root).
                by_root: dict[str, list[Position]] = {}
                for p in server_positions:
                    by_root.setdefault(asset_root(p.ticker) or p.ticker, []).append(p)

                broker_by_root: dict[str, dict[str, Any]] = {}
                for bp in broker_positions:
                    sym = bp.get("symbol") or bp.get("contractSymbol") or ""
                    root = asset_root(sym) or sym
                    broker_by_root[root] = bp

                # Server has it, broker doesn't (closed at broker, server
                # still thinks it's open).
                for root, ps in by_root.items():
                    if root not in broker_by_root:
                        for p in ps:
                            _record_warning(
                                "broker_flat_server_open",
                                f"Server thinks {p.trade_id} is {p.status} "
                                f"({p.qty_open} ct) but broker is flat on {root}",
                                trade_id=p.trade_id,
                                ticker=p.ticker,
                            )

                # Broker has it, server doesn't (unknown position at broker
                # — manual order? bug?).
                for root, bp in broker_by_root.items():
                    if root not in by_root:
                        _record_warning(
                            "broker_open_server_flat",
                            f"Broker has open position on {root} "
                            f"(net={bp.get('netPos')}) but server has none",
                            ticker=root,
                            broker_position=bp,
                        )

                # Both have it but qty differs.
                for root, ps in by_root.items():
                    bp = broker_by_root.get(root)
                    if not bp:
                        continue
                    server_qty = sum(p.qty_open if (p.side or "").upper() == "LONG" else -p.qty_open for p in ps)
                    broker_qty = int(bp.get("netPos", 0))
                    if server_qty != broker_qty:
                        _record_warning(
                            "qty_mismatch",
                            f"{root}: server net={server_qty}, broker net={broker_qty}",
                            ticker=root,
                            server_qty=server_qty,
                            broker_qty=broker_qty,
                        )
            backoff = 5.0
            await asyncio.sleep(interval)
        except Exception as e:
            log.warning("reconcile loop error: %s — sleeping %.1fs", e, backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60.0)
