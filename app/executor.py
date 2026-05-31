"""
Phase 2 executor — stateful.

The executor is now responsible for the position state machine:

    ENTRY         → create position (OPEN) — reject if one already exists/closed
    STOP_UPDATE   → update stop on OPEN/PARTIAL — reject if closed
    TP1/2/3       → reduce qty_open — close if 0 — reject if closed
    CLOSE50       → halve qty_open (PARTIAL) — reject if closed
    MASTER_CLOSE  ─┐
    STOP_HIT      ─┼─ close position (CLOSED + exit_reason) — reject if already closed
    EMA_EXIT      ─┤
    CLOSE_FALLBACK┘

When the inbound signal has no trade_id we cannot track state and fall back
to the legacy "would_*" simulated response (backward-compatible).
"""

from datetime import datetime
from math import ceil
from typing import Any

from sqlalchemy.orm import Session

from .models import Position


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def _sim_result(action: str, signal, **extra) -> dict[str, Any]:
    """Legacy simulated response shape (used when trade_id is missing)."""
    return {
        "status": "executed_sim",
        "action": action,
        "ticker": signal.ticker,
        "side": signal.side,
        "qty": signal.qty,
        "timestamp": _now_iso(),
        **extra,
    }


def _reject(reason: str, signal, position: Position | None = None) -> dict[str, Any]:
    """Standard rejection envelope used for late / illegal events."""
    out = {
        "status": reason,
        "action": "rejected",
        "ticker": signal.ticker,
        "side": signal.side,
        "qty": signal.qty,
        "timestamp": _now_iso(),
    }
    if position is not None:
        out["trade_id"] = position.trade_id
        out["position_status"] = position.status
        out["qty_open"] = position.qty_open
    return out


def _ok(action: str, signal, position: Position) -> dict[str, Any]:
    """Successful execution envelope (with state info)."""
    return {
        "status": "executed_sim",
        "action": action,
        "ticker": signal.ticker,
        "side": signal.side,
        "qty": signal.qty,
        "trade_id": position.trade_id,
        "position_status": position.status,
        "qty_open": position.qty_open,
        "qty_total": position.qty_total,
        "timestamp": _now_iso(),
    }


_CLOSE_EVENTS = {"MASTER_CLOSE", "CLOSE_FALLBACK", "EMA_EXIT", "STOP_HIT"}
_TP_EVENTS = {"TP1", "TP2", "TP3"}
_TERMINAL = {"CLOSED", "CANCELLED"}
_ACTIVE = {"OPEN", "PARTIAL", "PENDING"}


# ---------------------------------------------------------------------------
# Main entrypoint
# ---------------------------------------------------------------------------

def execute_trade(signal, db: Session | None = None) -> dict[str, Any]:
    event = (signal.event or "").upper()
    trade_id = getattr(signal, "trade_id", None)

    # ---- Backward-compatible path -------------------------------------------------
    # Without a trade_id, we cannot track state. Behave like the old executor.
    if not trade_id or db is None:
        return _legacy_execute(signal, event)

    position = (
        db.query(Position).filter(Position.trade_id == trade_id).first()
    )

    # ---- ENTRY -----------------------------------------------------------
    if event == "ENTRY":
        if position is None:
            # Create fresh position.
            entry_price = getattr(signal, "entry_px", None)
            stop_price = getattr(signal, "stop_px", None)
            position = Position(
                trade_id=trade_id,
                ticker=signal.ticker,
                side=signal.side,
                qty_total=signal.qty,
                qty_open=signal.qty,
                entry_price=entry_price,
                stop_price=stop_price,
                status="OPEN",
            )
            db.add(position)
            db.flush()  # populate id without committing — caller commits with the signal row
            return _ok("placed_order", signal, position)

        if position.status in _ACTIVE:
            # Trade lock — refuse to re-enter an already-active trade.
            return _reject("entry_already_open", signal, position)

        # CLOSED / CANCELLED — don't reopen a finished trade.
        return _reject("trade_already_closed", signal, position)

    # ---- Everything else needs an existing position ----------------------
    if position is None:
        return _reject("no_position_for_trade_id", signal)

    if position.status in _TERMINAL:
        return _reject("already_closed", signal, position)

    # ---- STOP_UPDATE -----------------------------------------------------
    if event == "STOP_UPDATE":
        new_stop = getattr(signal, "stop_px", None)
        if new_stop is not None:
            position.stop_price = new_stop
        return _ok("updated_stop", signal, position)

    # ---- TP1 / TP2 / TP3 -------------------------------------------------
    if event in _TP_EVENTS:
        # Reduce by the TP qty (capped at qty_open so we never go negative).
        reduce_by = min(signal.qty, position.qty_open)
        position.qty_open -= reduce_by
        if position.qty_open <= 0:
            position.qty_open = 0
            position.status = "CLOSED"
            position.exit_reason = "all_tps_filled"
        else:
            position.status = "PARTIAL"
        return _ok(f"processed_{event.lower()}", signal, position)

    # ---- CLOSE50 ---------------------------------------------------------
    if event == "CLOSE50":
        # Halve (round up so 3 → 2, 1 → 1) — matches Pine "close 50%" semantics.
        new_open = ceil(position.qty_open / 2)
        position.qty_open = new_open
        if position.qty_open <= 0:
            position.qty_open = 0
            position.status = "CLOSED"
            position.exit_reason = "close_half_to_zero"
        else:
            position.status = "PARTIAL"
        return _ok("closed_half", signal, position)

    # ---- Master closes ---------------------------------------------------
    if event in _CLOSE_EVENTS:
        position.qty_open = 0
        position.status = "CLOSED"
        position.exit_reason = event.lower()
        return _ok("closed_all", signal, position)

    # ---- Unknown event ---------------------------------------------------
    return {
        "status": "ignored",
        "action": "no_execution_rule",
        "ticker": signal.ticker,
        "side": signal.side,
        "qty": signal.qty,
        "trade_id": position.trade_id,
        "position_status": position.status,
        "qty_open": position.qty_open,
        "timestamp": _now_iso(),
    }


# ---------------------------------------------------------------------------
# Legacy (no trade_id) — same behavior as Phase 1 executor
# ---------------------------------------------------------------------------

def _legacy_execute(signal, event: str) -> dict[str, Any]:
    if event == "ENTRY":
        return _sim_result("would_place_order", signal)
    if event == "STOP_UPDATE":
        return _sim_result("would_update_stop", signal)
    if event == "CLOSE50":
        return _sim_result("would_close_half", signal)
    if event in _CLOSE_EVENTS:
        return _sim_result("would_close_all", signal)
    if event in _TP_EVENTS:
        return _sim_result(f"would_process_{event.lower()}", signal)
    return {
        "status": "ignored",
        "action": "no_execution_rule",
        "ticker": signal.ticker,
        "side": signal.side,
        "qty": signal.qty,
        "timestamp": _now_iso(),
    }
