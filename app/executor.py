"""
Phase 2.5 executor — stateful, with stop ledger and real-time stop tracking.

Reads v20.80 Trade Engine payloads. v20.80 always sends `qty` = total
entry contracts; partial closes carry `close_qty` (TP qty / half qty).
We use `close_qty` when present, fall back to `qty` for legacy payloads.

STOP_UPDATE writes both the new stop AND a StopUpdate ledger row so we
keep a real-time history of every BE / jump / trail / drag / resync.

Events (all from TM_Compact_20.80.pine lines 1286–1356):
    ENTRY          create position, snapshot TPs + runner
    STOP_UPDATE    update position.stop_price + log to stop_updates
    TP1/TP2/TP3    reduce qty_open by close_qty
    CLOSE50        reduce qty_open by close_qty
    STOP_HIT       close (exit_reason=stop_hit)
    EMA_EXIT       close (exit_reason=ema_exit)
    MASTER_CLOSE   close (exit_reason=master_close)
    CLOSE_FALLBACK close (exit_reason=close_fallback)
    TEST           backward-compat ping
"""

from datetime import datetime
from math import ceil
from typing import Any

from sqlalchemy.orm import Session

from .models import Position, StopUpdate


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def _sim_result(action: str, signal, **extra) -> dict[str, Any]:
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


def _ok(action: str, signal, position: Position, **extra) -> dict[str, Any]:
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
        "stop_price": position.stop_price,
        "stop_source": position.stop_source,
        "timestamp": _now_iso(),
        **extra,
    }


def _close_qty(signal) -> int:
    """Pine v20.80 sends qty=total + close_qty=partial.
    Fall back to qty for legacy/manual payloads with no close_qty."""
    cq = getattr(signal, "close_qty", None)
    if cq is not None and cq > 0:
        return int(cq)
    return int(signal.qty)


_CLOSE_EVENTS = {"MASTER_CLOSE", "CLOSE_FALLBACK", "EMA_EXIT", "STOP_HIT"}
_TP_EVENTS = {"TP1", "TP2", "TP3"}
_TERMINAL = {"CLOSED", "CANCELLED"}
_ACTIVE = {"OPEN", "PARTIAL", "PENDING"}


def execute_trade(signal, db: Session | None = None) -> dict[str, Any]:
    event = (signal.event or "").upper()
    trade_id = getattr(signal, "trade_id", None)

    # Backward-compat: no trade_id → legacy simulated executor (no state).
    if not trade_id or db is None:
        return _legacy_execute(signal, event)

    position = (
        db.query(Position).filter(Position.trade_id == trade_id).first()
    )

    # ---- ENTRY -----------------------------------------------------------
    if event == "ENTRY":
        if position is None:
            # Fresh ENTRY — snapshot everything Pine sent us.
            position = Position(
                trade_id=trade_id,
                ticker=signal.ticker,
                side=signal.side,
                qty_total=signal.qty,
                qty_open=signal.qty,
                entry_price=getattr(signal, "entry_px", None),
                stop_price=getattr(signal, "stop_px", None),
                tp1_px=getattr(signal, "tp1_px", None),
                tp1_qty=getattr(signal, "tp1_qty", None),
                tp2_px=getattr(signal, "tp2_px", None),
                tp2_qty=getattr(signal, "tp2_qty", None),
                tp3_px=getattr(signal, "tp3_px", None),
                tp3_qty=getattr(signal, "tp3_qty", None),
                runner_qty=getattr(signal, "runner_qty", None),
                stop_source="BASE",
                status="OPEN",
            )
            db.add(position)
            db.flush()
            return _ok("placed_order", signal, position)

        if position.status in _ACTIVE:
            return _reject("entry_already_open", signal, position)

        return _reject("trade_already_closed", signal, position)

    # ---- Everything else needs an existing position ----------------------
    if position is None:
        return _reject("no_position_for_trade_id", signal)

    if position.status in _TERMINAL:
        return _reject("already_closed", signal, position)

    # ---- STOP_UPDATE -----------------------------------------------------
    if event == "STOP_UPDATE":
        new_stop = getattr(signal, "stop_px", None)
        source = getattr(signal, "source", None) or "UNKNOWN"
        if new_stop is None:
            return _reject("missing_stop_px", signal, position)

        old_stop = position.stop_price
        position.stop_price = new_stop
        position.stop_source = source

        # Append to ledger — gives us a real-time history of every stop
        # move (BE / JUMP / TRAIL / RESYNC / MASTER / drag).
        db.add(StopUpdate(
            trade_id=trade_id,
            ticker=signal.ticker,
            side=signal.side,
            old_stop=old_stop,
            new_stop=new_stop,
            source=source,
        ))
        return _ok("updated_stop", signal, position, old_stop=old_stop, new_stop=new_stop)

    # ---- TP1 / TP2 / TP3 -------------------------------------------------
    if event in _TP_EVENTS:
        reduce_by = min(_close_qty(signal), position.qty_open)
        position.qty_open -= reduce_by
        if position.qty_open <= 0:
            position.qty_open = 0
            position.status = "CLOSED"
            position.exit_reason = "all_tps_filled"
        else:
            position.status = "PARTIAL"
        return _ok(f"processed_{event.lower()}", signal, position, reduced_by=reduce_by)

    # ---- CLOSE50 ---------------------------------------------------------
    if event == "CLOSE50":
        # v20.80 sends close_qty = half_qty already computed. Honor it.
        # If close_qty missing, fall back to ceil(qty_open / 2).
        cq = getattr(signal, "close_qty", None)
        if cq is not None and cq > 0:
            reduce_by = min(int(cq), position.qty_open)
        else:
            reduce_by = ceil(position.qty_open / 2)
        position.qty_open -= reduce_by
        if position.qty_open <= 0:
            position.qty_open = 0
            position.status = "CLOSED"
            position.exit_reason = "close_half_to_zero"
        else:
            position.status = "PARTIAL"
        return _ok("closed_half", signal, position, reduced_by=reduce_by)

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
# Legacy (no trade_id) — same behavior as Phase 1 executor.
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
