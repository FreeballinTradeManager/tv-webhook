"""
Phase 5b executor — stateful + broker-delegated.

State machine + validation lives here. Every side-effect (placing
orders, modifying stops, closing positions) goes through the
BrokerAdapter returned by `get_broker()`.

When no broker credentials are configured the SimulatedAdapter is used
and behavior matches the previous phase (Position state still
advances, no real orders sent). When TRADOVATE_USERNAME/PASSWORD/CID/
SECRET are present, TradovateAdapter is used automatically.

Events (TM_Compact_20.80.pine Trade Engine block):
    ENTRY          create Position(OPEN) + broker.open_position
    STOP_UPDATE    update Position.stop + log to stop_updates +
                   broker.modify_stop
    TP1/TP2/TP3    reduce qty_open by close_qty + broker.close_partial
    CLOSE50        reduce qty_open by close_qty + broker.close_partial
    STOP_HIT       close + broker.close_position + cancel stop
    EMA_EXIT       close + broker.close_position
    MASTER_CLOSE   close + broker.close_position
    CLOSE_FALLBACK close + broker.close_position
    TEST           backward-compat ping
"""

from datetime import datetime
from math import ceil
from typing import Any

from sqlalchemy.orm import Session

from .brokers import get_broker
from .brokers.base import BrokerResult
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
        "status": "executed_sim" if (position.broker or "simulated") == "simulated" else "executed",
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
        "broker": position.broker,
        "broker_order_id": position.broker_order_id,
        "broker_stop_order_id": position.broker_stop_order_id,
        "avg_fill_price": position.avg_fill_price,
        "broker_error": position.broker_error,
        "timestamp": _now_iso(),
        **extra,
    }


def _close_qty(signal) -> int:
    cq = getattr(signal, "close_qty", None)
    if cq is not None and cq > 0:
        return int(cq)
    return int(signal.qty)


def _apply_broker_result(position: Position, result: BrokerResult, *, persist_ids: bool = True) -> None:
    """Persist broker IDs / fill price / error onto the Position row."""
    if not result.success:
        position.broker_error = result.message or "broker call failed"
        return
    # Successful call clears any prior error message.
    position.broker_error = None
    if persist_ids:
        if result.order_id and not position.broker_order_id:
            position.broker_order_id = result.order_id
        if result.stop_order_id:
            position.broker_stop_order_id = result.stop_order_id
        if result.fill_price is not None and position.avg_fill_price is None:
            position.avg_fill_price = result.fill_price


_CLOSE_EVENTS = {"MASTER_CLOSE", "CLOSE_FALLBACK", "EMA_EXIT", "STOP_HIT"}
_TP_EVENTS = {"TP1", "TP2", "TP3"}
_TERMINAL = {"CLOSED", "CANCELLED"}
_ACTIVE = {"OPEN", "PARTIAL", "PENDING"}


def execute_trade(signal, db: Session | None = None, *, observe_only: bool = False) -> dict[str, Any]:
    """Run the state machine + (unless observe_only) drive the broker.

    observe_only=True forces SimulatedAdapter regardless of the active
    broker — used by the /api/webhook/pmt-compat endpoint so that
    secondary "observability" alerts can never accidentally place real
    orders even if env vars later activate PMT/TradeSyncer/Tradovate.
    """
    event = (signal.event or "").upper()
    trade_id = getattr(signal, "trade_id", None)

    # Backward-compat: no trade_id → legacy simulated executor (no state).
    if not trade_id or db is None:
        return _legacy_execute(signal, event)

    if observe_only:
        # Hard guarantee: this signal CANNOT touch a real broker.
        from .brokers.simulated import SimulatedAdapter
        broker = SimulatedAdapter()
    else:
        broker = get_broker()
    broker_name = f"{broker.name}-{broker.env}" if broker.env not in ("sim", "unknown") else broker.name

    position = (
        db.query(Position).filter(Position.trade_id == trade_id).first()
    )

    # ---- ENTRY -----------------------------------------------------------
    if event == "ENTRY":
        if position is None:
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
                broker=broker_name,
            )
            db.add(position)
            db.flush()

            # Side-effect: place real entry + stop at the broker.
            result = broker.open_position(
                ticker=signal.ticker,
                side=signal.side,
                qty=signal.qty,
                stop_px=getattr(signal, "stop_px", None),
                entry_px_hint=getattr(signal, "entry_px", None),
            )
            _apply_broker_result(position, result)
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

        db.add(StopUpdate(
            trade_id=trade_id,
            ticker=signal.ticker,
            side=signal.side,
            old_stop=old_stop,
            new_stop=new_stop,
            source=source,
        ))

        # Side-effect: actually move the stop order at the broker.
        result = broker.modify_stop(
            broker_stop_order_id=position.broker_stop_order_id,
            new_stop_px=new_stop,
            ticker=signal.ticker,
            side=signal.side,
            qty_open=position.qty_open,
        )
        _apply_broker_result(position, result)
        return _ok("updated_stop", signal, position, old_stop=old_stop, new_stop=new_stop)

    # ---- TP1 / TP2 / TP3 -------------------------------------------------
    if event in _TP_EVENTS:
        reduce_by = min(_close_qty(signal), position.qty_open)
        # Broker side: opposite-side market for reduce_by.
        result = broker.close_partial(
            ticker=signal.ticker,
            side=signal.side,
            close_qty=reduce_by,
            entry_px_hint=position.entry_price,
        )
        _apply_broker_result(position, result, persist_ids=False)

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
        cq = getattr(signal, "close_qty", None)
        if cq is not None and cq > 0:
            reduce_by = min(int(cq), position.qty_open)
        else:
            reduce_by = ceil(position.qty_open / 2)

        result = broker.close_partial(
            ticker=signal.ticker,
            side=signal.side,
            close_qty=reduce_by,
            entry_px_hint=position.entry_price,
        )
        _apply_broker_result(position, result, persist_ids=False)

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
        prev_open = position.qty_open
        result = broker.close_position(
            ticker=signal.ticker,
            side=signal.side,
            qty_open=prev_open,
            broker_stop_order_id=position.broker_stop_order_id,
            broker_order_id=position.broker_order_id,
        )
        _apply_broker_result(position, result, persist_ids=False)

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
