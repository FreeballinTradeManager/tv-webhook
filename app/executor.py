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


# ---------------------------------------------------------------------------
# Phase 1.2: rotation trigger on position close
# ---------------------------------------------------------------------------
# Called whenever a Position transitions to CLOSED. Updates the account's
# win/loss counters (using stop-vs-entry as a WIN/LOSS proxy since real
# fill-based PnL isn't wired yet) then applies any group rotation rules:
#
#   - Group.rotate_after_wins: after N cycle wins → account state="cooled"
#   - Group.rotate_after_losses: after N cycle losses → account state="stopped"
#   - After transition, promote the highest-priority "benched" member of
#     the same group to "active" so the fan-out slot stays full.
#
# Runs inline in the executor's DB session — no async background job.

def _classify_win_loss(position) -> str:
    """Return 'win' | 'loss' | 'unknown'."""
    if position.realized_pnl is not None:
        return "win" if position.realized_pnl > 0 else "loss"
    if position.exit_reason == "all_tps_filled":
        return "win"
    if position.exit_reason == "stop_hit":
        return "loss"
    # Proxy: stop position vs entry. LONG win = stop >= entry, LOSS = stop < entry.
    if position.stop_price is not None and position.entry_price is not None:
        if (position.side or "").upper() == "LONG":
            return "win" if position.stop_price >= position.entry_price else "loss"
        else:
            return "win" if position.stop_price <= position.entry_price else "loss"
    return "unknown"


def _apply_rotation_on_close(position, db: Session) -> dict:
    """Increment account counters + apply group rotation rules if any.

    Returns a dict describing what happened (surfaces in execution result).
    """
    if position.account_id is None:
        return {"rotation_check": "skipped_no_account"}

    # Deferred import to avoid circular reference at module load.
    from .models import Account, Group, GroupMember

    acct = db.query(Account).filter(Account.id == position.account_id).first()
    if acct is None:
        return {"rotation_check": "skipped_account_missing"}

    verdict = _classify_win_loss(position)
    if verdict == "win":
        acct.wins_cycle = (acct.wins_cycle or 0) + 1
        acct.wins_today = (acct.wins_today or 0) + 1
    elif verdict == "loss":
        acct.losses_cycle = (acct.losses_cycle or 0) + 1
        acct.losses_today = (acct.losses_today or 0) + 1
    else:
        return {"rotation_check": "skipped_unknown_verdict"}

    # Track cumulative $ PnL for this cycle so we can rotate on dollar
    # thresholds ("turn off after $500 profit"). Uses realized_pnl if
    # available, otherwise the locked-stop proxy (stop vs entry × qty × pv).
    trade_pnl = position.realized_pnl or 0.0
    if not trade_pnl and position.stop_price is not None and position.entry_price is not None:
        from .assets import point_value
        pv = point_value(position.ticker) or 0.0
        sign = 1.0 if (position.side or "").upper() == "LONG" else -1.0
        trade_pnl = (position.stop_price - position.entry_price) * sign * (position.qty_total or 0) * pv
    acct.pnl_cycle = (acct.pnl_cycle or 0.0) + trade_pnl
    acct.pnl_today = (acct.pnl_today or 0.0) + trade_pnl

    result = {
        "verdict": verdict,
        "wins_cycle": acct.wins_cycle,
        "losses_cycle": acct.losses_cycle,
        "pnl_cycle": round(acct.pnl_cycle, 2),
        "trade_pnl": round(trade_pnl, 2),
    }

    if not position.group_name:
        return {**result, "rotation_check": "no_group"}

    grp = db.query(Group).filter(Group.name == position.group_name).first()
    if grp is None:
        return {**result, "rotation_check": "group_missing"}

    # Find this account's membership in the group.
    mem = (
        db.query(GroupMember)
        .filter(
            GroupMember.group_id == grp.id,
            GroupMember.account_id == acct.id,
        )
        .first()
    )
    if mem is None or not mem.active:
        return {**result, "rotation_check": "not_a_group_member"}

    new_state = None
    rotation_reason = None
    if grp.rotate_after_wins and acct.wins_cycle >= grp.rotate_after_wins:
        new_state = "cooled"
        rotation_reason = f"hit {grp.rotate_after_wins} wins"
    elif grp.rotate_after_losses and acct.losses_cycle >= grp.rotate_after_losses:
        new_state = "stopped"
        rotation_reason = f"hit {grp.rotate_after_losses} losses"
    elif grp.rotate_after_profit and acct.pnl_cycle >= grp.rotate_after_profit:
        new_state = "cooled"
        rotation_reason = f"hit profit cap ${grp.rotate_after_profit:.0f}"
    elif grp.rotate_after_loss_pnl and acct.pnl_cycle <= -abs(grp.rotate_after_loss_pnl):
        new_state = "stopped"
        rotation_reason = f"hit loss cap -${abs(grp.rotate_after_loss_pnl):.0f}"

    if new_state is None:
        return {**result, "rotation_check": "no_threshold_hit"}

    # Transition current account off the active rotation.
    acct.state = new_state
    acct.wins_cycle = 0
    acct.losses_cycle = 0
    acct.pnl_cycle = 0.0
    result["state_change"] = f"active→{new_state}"
    result["rotation_reason"] = rotation_reason

    # Promote next benched account to keep the fan-out slot full.
    promoted = None
    if grp.min_active_count:
        active_count = (
            db.query(Account)
            .join(GroupMember, GroupMember.account_id == Account.id)
            .filter(
                GroupMember.group_id == grp.id,
                GroupMember.active == True,  # noqa: E712
                Account.state == "active",
                Account.active == True,  # noqa: E712
            )
            .count()
        )
        if active_count < grp.min_active_count:
            # Pull highest-priority benched member.
            candidate = (
                db.query(Account)
                .join(GroupMember, GroupMember.account_id == Account.id)
                .filter(
                    GroupMember.group_id == grp.id,
                    GroupMember.active == True,  # noqa: E712
                    Account.state == "benched",
                    Account.active == True,  # noqa: E712
                )
                .order_by(GroupMember.priority.asc(), Account.id.asc())
                .first()
            )
            if candidate is not None:
                candidate.state = "active"
                candidate.wins_cycle = 0
                candidate.losses_cycle = 0
                promoted = {"account_id": candidate.id, "name": candidate.name}

    result["promoted"] = promoted
    return result


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


def execute_trade(signal, db: Session | None = None, *,
                  observe_only: bool = False,
                  account=None,           # Account row, when routing to a specific fan-out target
                  group_name=None,        # Group name that owned this fan-out (stored on Position)
                  ) -> dict[str, Any]:
    """Run the state machine + (unless observe_only) drive the broker.

    observe_only=True forces SimulatedAdapter regardless of the active
    broker — used by the /api/webhook/pmt-compat endpoint so that
    secondary "observability" alerts can never accidentally place real
    orders even if env vars later activate PMT/TradeSyncer/Tradovate.

    account/group_name are set by the webhook handler's fan-out loop
    (one call per group member). When account is provided:
      - We look up an account-specific broker adapter via that account's
        broker kind (falls back to get_broker() for now — full per-
        account broker resolution comes in a later slice).
      - Position row is tagged with account_id + group_name so the
        dashboard can filter/aggregate per account and per group.
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
    elif account is not None and (not account.active or account.paused):
        # Account is disabled/paused → observe-only for this fan-out leg.
        from .brokers.simulated import SimulatedAdapter
        broker = SimulatedAdapter()
    else:
        broker = get_broker()
    broker_name = f"{broker.name}-{broker.env}" if broker.env not in ("sim", "unknown") else broker.name
    if account is not None:
        # Prefer the account's own name so the dashboard shows
        # "Lucid 50K" instead of just "simulated".
        broker_name = f"{account.broker}:{account.name}"

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
                account_id=account.id if account is not None else None,
                group_name=group_name,
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
        rotation_info = None
        if position.qty_open <= 0:
            position.qty_open = 0
            position.status = "CLOSED"
            position.exit_reason = "all_tps_filled"
            rotation_info = _apply_rotation_on_close(position, db)
        else:
            position.status = "PARTIAL"
        return _ok(f"processed_{event.lower()}", signal, position, reduced_by=reduce_by, rotation=rotation_info)

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
        rotation_info = None
        if position.qty_open <= 0:
            position.qty_open = 0
            position.status = "CLOSED"
            position.exit_reason = "close_half_to_zero"
            rotation_info = _apply_rotation_on_close(position, db)
        else:
            position.status = "PARTIAL"
        return _ok("closed_half", signal, position, reduced_by=reduce_by, rotation=rotation_info)

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
        rotation_info = _apply_rotation_on_close(position, db)
        return _ok("closed_all", signal, position, rotation=rotation_info)

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
