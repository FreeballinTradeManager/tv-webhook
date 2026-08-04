import os
import json
from typing import Optional

from datetime import datetime, timedelta, timezone
from pathlib import Path
import uuid as _uuid
from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, UploadFile, File, Request
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func as sa_func

from .db import get_db, run_migrations
# Import models so SQLAlchemy registers tables before run_migrations() runs.
from . import models  # noqa: F401
from .models import (
    WebhookSignal, Position, StopUpdate, Account, Group, GroupMember, BROKER_KINDS,
    Strategy, TradeAlert, UserSettings, Goal, VaultEntry, WebhookRetry,
)
from .executor import execute_trade
from .ws import manager as ws_manager
from .assets import locked_pnl, live_pnl, point_value, asset_root
from .quote_store import store as quote_store
from .brokers import get_broker
from .db import SessionLocal
from .reconciliation import reconcile_loop, recent_warnings
from .dedup import is_duplicate, mark_seen, synth_entry_trade_id, synth_event_id
from .pmt_compat import PMTWebhook, pmt_to_trade_engine, PMT_COMPAT_KEY

import asyncio
import logging
from datetime import datetime, timezone

log = logging.getLogger("tv-webhook.main")

app = FastAPI()


# ---------------------------------------------------------------------------
# Task #39: Midnight reset background job
# ---------------------------------------------------------------------------
# Zeros wins_today / losses_today / pnl_today on every account at UTC
# midnight. Without this the "today" counters accumulate forever which
# breaks daily-DD guardian checks + goal progress + prop firm compliance.

async def weekend_flat_loop() -> None:
    """Task #70: Friday 3:45pm ET auto-flat for prop firm compliance.
    Runs continuously — sleeps until next Friday 3:45pm ET, then flattens
    all open positions on accounts with weekend_close_required=true.

    3:45pm ET buffer is intentional: futures/CME session closes at 4:00pm,
    prop firms often measure 'held over weekend' as anything open at 4:00pm.
    Flattening 15 min early gives fills time to settle."""
    import datetime as _dt
    try:
        import zoneinfo
        et = zoneinfo.ZoneInfo("America/New_York")
    except Exception:
        et = timezone.utc

    while True:
        try:
            now = datetime.now(et)
            # Find next Friday 3:45pm ET
            target = now.replace(hour=15, minute=45, second=0, microsecond=0)
            # weekday(): Mon=0 ... Fri=4, Sat=5, Sun=6
            days_until_fri = (4 - now.weekday()) % 7
            if days_until_fri == 0 and now >= target:
                days_until_fri = 7   # already past this Friday's target
            target = target + _dt.timedelta(days=days_until_fri)
            wait_s = max(30, (target - now).total_seconds())
            log.info("weekend_flat_loop: next trigger at %s (in %.0fs)",
                     target.isoformat(), wait_s)
            await asyncio.sleep(wait_s)

            # Flatten every account flagged weekend_close_required
            from .executor import _flatten_account_positions
            with SessionLocal() as db:
                flagged = db.query(Account).filter(
                    Account.weekend_close_required == True  # noqa
                ).all()
                total_flat = 0
                for a in flagged:
                    total_flat += _flatten_account_positions(a, db)
                db.commit()
                log.info("weekend_flat: flattened %d positions across %d accounts",
                         total_flat, len(flagged))
        except Exception as e:
            log.warning("weekend_flat_loop error: %s — sleeping 10min", e)
            await asyncio.sleep(600)


async def midnight_reset_loop() -> None:
    """Sleep until next UTC midnight, then reset all accounts' today
    counters, then repeat. Safe on server restart — worst case is
    we reset a few minutes late."""
    while True:
        try:
            now = datetime.now(timezone.utc)
            # Next UTC midnight
            tomorrow = now.replace(hour=0, minute=0, second=0, microsecond=0) + \
                       __import__("datetime").timedelta(days=1)
            wait_s = max(30, (tomorrow - now).total_seconds())
            await asyncio.sleep(wait_s)

            # Reset all accounts
            with SessionLocal() as db:
                accts = db.query(Account).all()
                for a in accts:
                    a.wins_today = 0
                    a.losses_today = 0
                    a.pnl_today = 0.0
                db.commit()
                log.info("midnight_reset: zeroed today counters on %d accounts", len(accts))
        except Exception as e:
            log.warning("midnight_reset_loop error: %s — sleeping 5min", e)
            await asyncio.sleep(300)


@app.on_event("startup")
async def on_startup() -> None:
    # Idempotent: creates tables if missing, adds new columns if missing.
    run_migrations()

    # Task #39: midnight reset always runs, regardless of broker
    asyncio.create_task(midnight_reset_loop())
    # Task #70: weekend flat cron — runs regardless of broker so we
    # always mark server-side positions closed; broker-side flatten
    # happens when a real broker is armed (#44).
    asyncio.create_task(weekend_flat_loop())

    # If we have a real broker (Tradovate), kick off the MD WebSocket
    # subscription + the reconciliation loop as background tasks.
    broker = get_broker()
    if broker.name == "tradovate":
        # Build the subscribed-tickers set lazily — it's mutated as
        # positions open/close. We pre-populate from any currently OPEN
        # positions so a restart doesn't drop the MD feed.
        subscribed: set[str] = set()
        with SessionLocal() as db:
            for p in db.query(Position).filter(Position.status.in_(["OPEN", "PARTIAL"])).all():
                root = asset_root(p.ticker)
                if root:
                    subscribed.add(root)

        # The webhook handler appends to this set whenever a new
        # position is opened — see _track_for_md() below.
        app.state.md_subscribed_tickers = subscribed

        from .brokers.tradovate_md import md_ws_loop
        asyncio.create_task(md_ws_loop(
            client=broker.client,
            quote_store=quote_store,
            ws_manager=ws_manager,
            subscribed_tickers=subscribed,
        ))
        asyncio.create_task(reconcile_loop(
            broker=broker, session_factory=SessionLocal,
        ))
        log.info("background tasks started: md_ws_loop + reconcile_loop")
    else:
        app.state.md_subscribed_tickers = set()
        log.info("broker=%s (no MD task)", broker.name)


def _track_for_md(ticker: str | None) -> None:
    """Called from the webhook handler when a new position opens, so the
    MD task picks up the symbol for subscription on its next sweep."""
    if not ticker:
        return
    root = asset_root(ticker)
    if not root:
        return
    s = getattr(app.state, "md_subscribed_tickers", None)
    if s is not None:
        s.add(root)


@app.websocket("/ws/live")
async def ws_live(websocket: WebSocket) -> None:
    """Dashboards open one of these and we push a 'state_changed' event
    whenever a webhook commits. The client re-fetches /api/positions and
    /api/stop-updates to refresh — no full-page reload, no polling."""
    await ws_manager.connect(websocket)
    try:
        # Send an initial hello so the client knows the connection is live.
        await websocket.send_json({"type": "hello", "version": "phase-3a"})
        while True:
            # We don't expect client messages yet, but consuming keeps the
            # connection alive and lets us detect close cleanly.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await ws_manager.disconnect(websocket)


class TradeEngineWebhook(BaseModel):
    event: str
    ticker: str
    side: str
    qty: int
    key: str

    # Phase 1: optional duplicate-protection fields. Backward-compatible —
    # legacy TradingView alerts that don't send these still work.
    trade_id: Optional[str] = None
    event_id: Optional[str] = None

    # Phase 2: optional price fields. When present, stored on the position.
    entry_px: Optional[float] = None
    stop_px: Optional[float] = None

    # Phase 2.5 — matches TM_Compact_20.80.pine Trade Engine payload:
    # ENTRY snapshot
    tp1_px: Optional[float] = None
    tp1_qty: Optional[int] = None
    tp2_px: Optional[float] = None
    tp2_qty: Optional[int] = None
    tp3_px: Optional[float] = None
    tp3_qty: Optional[int] = None
    runner_qty: Optional[int] = None
    # Sent on TP1/TP2/TP3/CLOSE50/STOP_HIT/EMA_EXIT/MASTER_CLOSE
    close_qty: Optional[int] = None
    remaining_qty: Optional[int] = None
    # Sent on ENTRY + STOP_UPDATE — Pine's stop_src (BASE / BE / JUMP / TRAIL / RESYNC / MASTER)
    source: Optional[str] = None

    # Phase 1.1: fan-out target. When set, server routes the signal to
    # every active member of the named group. When absent, server runs
    # the existing single-position path (broker from get_broker(), one
    # Position row).
    group: Optional[str] = None


@app.get("/")
def root():
    return {"status": "running"}


@app.get("/api/warnings")
def list_warnings():
    """Recent reconciliation warnings (broker-vs-server drift)."""
    return list(recent_warnings)


@app.get("/api/broker-status")
def broker_status():
    """Which adapter is active and (when Tradovate) whether auth works.
    Used by the dashboard hero card + as a quick ops check."""
    b = get_broker()
    info = {
        "broker": b.name,
        "env": b.env,
    }
    # If the adapter exposes a richer health check, surface it.
    client = getattr(b, "client", None)
    if client is not None and hasattr(client, "get_account_health"):
        try:
            info.update(client.get_account_health())
        except Exception as e:
            info["error"] = str(e)
    return info


@app.get("/dashboard", response_class=HTMLResponse)
def dashboard(db: Session = Depends(get_db)):
    signals = db.query(WebhookSignal).order_by(WebhookSignal.id.desc()).limit(50).all()
    active_positions = (
        db.query(Position)
        .filter(Position.status.in_(["PENDING", "OPEN", "PARTIAL"]))
        .order_by(Position.updated_at.desc())
        .all()
    )
    closed_positions = (
        db.query(Position)
        .filter(Position.status.in_(["CLOSED", "CANCELLED"]))
        .order_by(Position.updated_at.desc())
        .limit(25)
        .all()
    )
    # Phase 2.5: real-time stop-update ledger — latest 50 across all trades.
    recent_stop_updates = (
        db.query(StopUpdate)
        .order_by(StopUpdate.id.desc())
        .limit(50)
        .all()
    )

    # Phase A: per-position stop history for Trade Cards.
    # One-shot fetch of ALL stop updates whose trade_id matches any
    # currently-active position — we bucket them client-side by trade_id.
    active_trade_ids = [p.trade_id for p in active_positions if p.trade_id]
    active_stops_by_trade: dict[str, list[StopUpdate]] = {}
    if active_trade_ids:
        rows = (
            db.query(StopUpdate)
            .filter(StopUpdate.trade_id.in_(active_trade_ids))
            .order_by(StopUpdate.id.asc())
            .all()
        )
        for su in rows:
            active_stops_by_trade.setdefault(su.trade_id, []).append(su)

    # Phase A: TP-hit lookup for Trade Cards — parse recent signals.
    # For each active position, figure out which TPs have been fired
    # (TP1/TP2/TP3 events on that trade_id).
    tp_hits_by_trade: dict[str, set[str]] = {}
    if active_trade_ids:
        tp_rows = (
            db.query(WebhookSignal)
            .filter(
                WebhookSignal.trade_id.in_(active_trade_ids),
                WebhookSignal.event.in_(["TP1", "TP2", "TP3"]),
            )
            .all()
        )
        for r in tp_rows:
            tp_hits_by_trade.setdefault(r.trade_id, set()).add(r.event)

    # --- Signal rows --------------------------------------------------------
    signal_rows = ""
    for s in signals:
        status_class = "status-default"
        event_upper = (s.event or "").upper()

        execution_action = ""
        execution_status = ""
        position_status_after = ""
        try:
            # raw_payload may be a JSON string (Text column) or already a
            # dict (JSONB column). Handle both — the column type drifted
            # at some point in the project history.
            rp = s.raw_payload
            if isinstance(rp, str):
                payload = json.loads(rp) if rp else {}
            elif isinstance(rp, dict):
                payload = rp
            else:
                payload = {}
            execution = payload.get("execution", {}) or {}
            execution_action = execution.get("action", "") or ""
            execution_status = execution.get("status", "") or ""
            position_status_after = execution.get("position_status", "") or ""
        except Exception:
            pass

        if event_upper == "ENTRY":
            status_class = "status-entry"
        elif "STOP" in event_upper:
            status_class = "status-stop"
        elif "TP" in event_upper:
            status_class = "status-tp"
        elif "CLOSE" in event_upper or "MASTER" in event_upper:
            status_class = "status-close"

        exec_display = execution_action or "-"
        if execution_status and execution_status not in ("executed_sim",):
            exec_display = f"{execution_status}"

        signal_rows += f"""
        <tr>
            <td>{s.id}</td>
            <td><span class="badge {status_class}">{s.event}</span></td>
            <td>{s.ticker}</td>
            <td>{s.side}</td>
            <td>{s.qty}</td>
            <td>{exec_display}</td>
            <td>{position_status_after or "-"}</td>
            <td>{s.trade_id or "-"}</td>
            <td>{s.event_id or "-"}</td>
            <td>{s.created_at}</td>
        </tr>
        """

    # --- Active position rows -----------------------------------------------
    def _pnl_html(value, css_classes: str) -> str:
        if value is None:
            return "—"
        cls = "pnl-pos" if value >= 0 else "pnl-neg"
        return f'<span class="{cls} {css_classes}">${value:,.2f}</span>'

    def _pos_row(p: Position) -> str:
        side_class = "side-long" if (p.side or "").upper() == "LONG" else "side-short"
        locked = locked_pnl(p.side, p.qty_open, p.entry_price, p.stop_price, p.ticker)
        last = quote_store.last_price(p.ticker)
        live = live_pnl(p.side, p.qty_open, p.entry_price, last, p.ticker)
        broker_badge = ""
        if p.broker_error:
            broker_badge = f' <span class="badge status-stop" title="{p.broker_error}">!</span>'
        return f"""
        <tr data-trade-id="{p.trade_id}" data-ticker="{p.ticker}" data-entry="{p.entry_price or ''}" data-side="{p.side}" data-qty-open="{p.qty_open}">
            <td>{p.id}</td>
            <td>{p.trade_id}{broker_badge}</td>
            <td>{p.ticker}</td>
            <td><span class="badge {side_class}">{p.side}</span></td>
            <td><span class="badge status-{p.status.lower()}">{p.status}</span></td>
            <td>{p.qty_open}/{p.qty_total}</td>
            <td>{p.entry_price if p.entry_price is not None else "-"}</td>
            <td>{p.stop_price if p.stop_price is not None else "-"}</td>
            <td>{p.stop_source or "-"}</td>
            <td>{_pnl_html(locked, '')}</td>
            <td class="live-pnl-cell">{_pnl_html(live, '')}</td>
            <td>{p.exit_reason or "-"}</td>
            <td>{p.updated_at}</td>
        </tr>
        """

    active_rows = "".join(_pos_row(p) for p in active_positions)

    # --- Phase A: Rich Trade Cards -----------------------------------------
    # For each active position, render a card with time-in-trade, TP ladder,
    # locked PnL, stop history (with $ impact), and live PnL if MD is ready.
    def _fmt_duration(start_dt) -> str:
        if start_dt is None:
            return "—"
        try:
            now = datetime.now(timezone.utc)
            if start_dt.tzinfo is None:
                start_dt = start_dt.replace(tzinfo=timezone.utc)
            secs = int((now - start_dt).total_seconds())
        except Exception:
            return "—"
        if secs < 0:
            secs = 0
        h = secs // 3600
        m = (secs % 3600) // 60
        s = secs % 60
        if h:
            return f"{h}h {m:02d}m"
        return f"{m}m {s:02d}s"

    def _tp_row(label: str, hit: bool, px: float | None, qty: int | None,
                side: str, entry: float | None, pv: float | None) -> str:
        if px is None or not qty:
            return f'<div class="tp-row tp-off">— {label} disabled</div>'
        icon = "✅" if hit else "⏳"
        cls = "tp-row tp-hit" if hit else "tp-row"
        # Estimated $ per TP: (tp - entry) * side * qty * pv
        dollars = ""
        if entry is not None and pv is not None:
            sign = 1.0 if (side or "").upper() == "LONG" else -1.0
            d = (px - entry) * sign * qty * pv
            dollars = f'<span class="tp-dollars">${d:,.2f}</span>'
        state = "hit" if hit else "pending"
        return f"""
        <div class="{cls}">
            <span class="tp-icon">{icon}</span>
            <span class="tp-name">{label}</span>
            <span class="tp-px">{px}</span>
            <span class="tp-qty">×{qty}</span>
            {dollars}
            <span class="tp-state">{state}</span>
        </div>
        """

    def _stop_hist_row(su: StopUpdate, entry: float | None, side: str,
                       qty_total: int | None, pv: float | None) -> str:
        # Compute $ impact if we can — (new_stop - entry) * side * qty * pv
        dollars = "—"
        if entry is not None and pv is not None and qty_total:
            sign = 1.0 if (side or "").upper() == "LONG" else -1.0
            d = (su.new_stop - entry) * sign * qty_total * pv
            cls = "pnl-pos" if d >= 0 else "pnl-neg"
            dollars = f'<span class="{cls}">${d:,.2f}</span>'
        delta = ""
        if su.old_stop is not None:
            diff = su.new_stop - su.old_stop
            sign_str = "+" if diff > 0 else ""
            delta = f'<span class="hint">({sign_str}{diff:.2f})</span>'
        return f"""
        <div class="stop-hist-row">
            <span class="badge status-stop">{su.source or "—"}</span>
            <span>{su.old_stop if su.old_stop is not None else "—"} → <strong>{su.new_stop}</strong> {delta}</span>
            <span class="tp-dollars">{dollars}</span>
            <span class="hint">{su.created_at.strftime("%H:%M:%S") if su.created_at else ""}</span>
        </div>
        """

    def _trade_card(p: Position) -> str:
        pv = point_value(p.ticker)
        locked = locked_pnl(p.side, p.qty_open, p.entry_price, p.stop_price, p.ticker)
        last = quote_store.last_price(p.ticker)
        live = live_pnl(p.side, p.qty_open, p.entry_price, last, p.ticker)

        hit_set = tp_hits_by_trade.get(p.trade_id, set())
        stop_history = active_stops_by_trade.get(p.trade_id, [])

        side_class = "side-long" if (p.side or "").upper() == "LONG" else "side-short"
        status_class = f"status-{p.status.lower()}"

        # Slippage line (only shown if broker actually filled)
        slip_html = ""
        if p.avg_fill_price is not None and p.entry_price is not None and pv is not None:
            slip_pts = p.avg_fill_price - p.entry_price
            slip_side = 1.0 if (p.side or "").upper() == "LONG" else -1.0
            slip_dollars = slip_pts * slip_side * (p.qty_total or p.qty_open or 0) * pv
            cls = "pnl-neg" if slip_dollars < 0 else "pnl-pos"
            slip_html = f'<div class="tc-line"><span class="tc-k">Slippage</span><span class="tc-v">{slip_pts:+.2f} pts <span class="{cls}">${slip_dollars:+,.2f}</span></span></div>'

        # Broker error banner
        error_banner = ""
        if p.broker_error:
            error_banner = f'<div class="tc-error">⚠️ Broker error: {p.broker_error}</div>'

        # TP ladder rows
        tp_html = "".join([
            _tp_row("TP1", "TP1" in hit_set, p.tp1_px, p.tp1_qty, p.side, p.entry_price, pv),
            _tp_row("TP2", "TP2" in hit_set, p.tp2_px, p.tp2_qty, p.side, p.entry_price, pv),
            _tp_row("TP3", "TP3" in hit_set, p.tp3_px, p.tp3_qty, p.side, p.entry_price, pv),
        ])
        runner_line = ""
        if p.runner_qty:
            runner_line = f'<div class="tp-row tp-runner"><span class="tp-icon">🏃</span><span class="tp-name">Runner</span><span class="tp-qty">×{p.runner_qty}</span><span class="tp-state">trail-managed</span></div>'

        # Stop history rows (chronological, oldest first)
        if stop_history:
            stop_html = "".join(_stop_hist_row(su, p.entry_price, p.side, p.qty_total, pv) for su in stop_history)
        else:
            stop_html = '<div class="empty">No stop moves yet — position at BASE stop</div>'

        # Live vs Locked PnL block
        def _pnl_v(v):
            if v is None:
                return "—"
            cls = "pnl-pos" if v >= 0 else "pnl-neg"
            return f'<span class="{cls}">${v:,.2f}</span>'

        locked_line = f'<div class="tc-pnl-line"><span class="tc-k">Locked (if stop hits)</span><span class="tc-v tc-pnl-big">{_pnl_v(locked)}</span></div>'
        live_line = ""
        if live is not None:
            live_line = f'<div class="tc-pnl-line tc-pnl-live"><span class="tc-k">Live (@ {last})</span><span class="tc-v tc-pnl-big">{_pnl_v(live)}</span></div>'

        return f"""
        <div class="trade-card">
            <div class="tc-header">
                <div class="tc-title">
                    <span class="tc-ticker">{p.ticker}</span>
                    <span class="badge {side_class}">{p.side}</span>
                    <span class="badge {status_class}">{p.status}</span>
                </div>
                <div class="tc-meta">
                    <span class="hint">Trade {p.trade_id}</span>
                    <span class="hint">·</span>
                    <span class="hint">{_fmt_duration(p.created_at)} in trade</span>
                </div>
            </div>
            {error_banner}
            <div class="tc-grid">
                <div class="tc-left">
                    <div class="tc-line"><span class="tc-k">Entry</span><span class="tc-v"><strong>{p.entry_price if p.entry_price is not None else "—"}</strong></span></div>
                    <div class="tc-line"><span class="tc-k">Stop</span><span class="tc-v"><strong>{p.stop_price if p.stop_price is not None else "—"}</strong> <span class="hint">{p.stop_source or "BASE"}</span></span></div>
                    <div class="tc-line"><span class="tc-k">Qty open / total</span><span class="tc-v">{p.qty_open}/{p.qty_total}</span></div>
                    {slip_html}
                    <div class="tc-line"><span class="tc-k">Broker</span><span class="tc-v"><span class="hint">{p.broker or "—"}</span></span></div>
                </div>
                <div class="tc-right">
                    <div class="tc-pnl-panel">
                        {live_line}
                        {locked_line}
                    </div>
                </div>
            </div>
            <div class="tc-section">
                <div class="tc-section-title">TP Ladder</div>
                <div class="tp-ladder">
                    {tp_html}
                    {runner_line}
                </div>
            </div>
            <div class="tc-section">
                <div class="tc-section-title">Stop History <span class="hint">(chronological — includes $ impact if stop had hit at that level)</span></div>
                <div class="stop-hist">
                    {stop_html}
                </div>
            </div>
        </div>
        """

    trade_cards_html = "".join(_trade_card(p) for p in active_positions)

    # --- Phase 1.1: Accounts + Groups data for the two new panels -----------
    from .models import Account, Group, GroupMember
    from datetime import date as _date
    _all_accounts = db.query(Account).order_by(Account.id.asc()).all()
    _all_groups = (
        db.query(Group)
        .order_by(Group.id.asc())
        .all()
    )

    # Today's realized PnL per account — sum of realized_pnl on positions
    # closed today (or since UTC midnight).
    from datetime import datetime as _dt
    _today_utc = _dt.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    _todays_realized_by_acct: dict[int, float] = {}
    if _all_accounts:
        acct_ids = [a.id for a in _all_accounts]
        _today_positions = (
            db.query(Position)
            .filter(
                Position.account_id.in_(acct_ids),
                Position.status.in_(["CLOSED", "CANCELLED"]),
                Position.updated_at >= _today_utc,
            )
            .all()
        )
        for p in _today_positions:
            if p.realized_pnl is not None:
                _todays_realized_by_acct[p.account_id] = (
                    _todays_realized_by_acct.get(p.account_id, 0.0) + float(p.realized_pnl)
                )

    def _acct_row(a: Account) -> str:
        # Realized today
        today = _todays_realized_by_acct.get(a.id, 0.0)
        today_cls = "pnl-pos" if today >= 0 else "pnl-neg"
        today_html = f'<span class="{today_cls}">${today:,.2f}</span>'

        # Daily limit progress bar (0-100%)
        limit_html = "—"
        if a.daily_loss_limit and a.daily_loss_limit > 0:
            used = min(abs(min(today, 0.0)), a.daily_loss_limit)
            pct = int((used / a.daily_loss_limit) * 100)
            bar_cls = "limit-bar-safe" if pct < 60 else ("limit-bar-warn" if pct < 90 else "limit-bar-danger")
            limit_html = f"""
            <div class="limit-bar-wrap">
                <div class="limit-bar {bar_cls}" style="width:{pct}%"></div>
                <div class="limit-bar-text">${used:,.0f} / ${a.daily_loss_limit:,.0f}</div>
            </div>
            """

        active_badge = '<span class="badge status-open">ACTIVE</span>' if a.active else '<span class="badge status-closed">OFF</span>'
        paused_badge = ' <span class="badge status-stop">PAUSED</span>' if a.paused else ''

        state = (a.state or "active")
        state_map = {
            "active":  '<span class="chip">ACTIVE</span>',
            "benched": '<span class="chip chip-benched">BENCHED</span>',
            "cooled":  '<span class="chip chip-cooled">COOLED</span>',
            "stopped": '<span class="chip chip-stopped">STOPPED</span>',
        }
        state_html = state_map.get(state, f'<span class="chip">{state}</span>')

        cycles_html = f'<span class="hint">W:{a.wins_cycle or 0}/L:{a.losses_cycle or 0}/${a.pnl_cycle or 0:,.0f}</span>'

        # Quick-action buttons per row: activate, bench, reset cycle
        btns = ' '.join([
            f'<button type="button" class="btn-mini" onclick="setAccountState({a.id},\'active\')">Activate</button>',
            f'<button type="button" class="btn-mini" onclick="setAccountState({a.id},\'benched\')">Bench</button>',
            f'<button type="button" class="btn-mini" onclick="setAccountState({a.id},\'active\')">Reset</button>',
        ])

        return f"""
        <tr>
            <td>{a.id}</td>
            <td><strong>{a.name}</strong></td>
            <td><span class="hint">{a.broker}</span></td>
            <td>{a.env}</td>
            <td>{a.account_id or "—"}</td>
            <td>{a.multiplier}×</td>
            <td>{state_html}<br>{cycles_html}</td>
            <td>{today_html}</td>
            <td>{limit_html}</td>
            <td>{active_badge}{paused_badge}</td>
            <td>{btns}</td>
        </tr>
        """

    accounts_html = "".join(_acct_row(a) for a in _all_accounts)

    # Build id → name lookup for the "Next Group" cascade selector
    _all_group_ids = [(g.id, g.name) for g in _all_groups]

    def _group_row(g: Group) -> str:
        members_html = "<span class='hint'>no members yet</span>"
        if g.members:
            active_members = [m for m in g.members if m.active]
            if active_members:
                chips = []
                for m in sorted(active_members, key=lambda x: x.priority):
                    a = m.account
                    if a is None:
                        continue
                    state = (a.state or "active")
                    state_cls = {
                        "active": "chip",
                        "benched": "chip chip-benched",
                        "cooled": "chip chip-cooled",
                        "stopped": "chip chip-stopped",
                    }.get(state, "chip")
                    chips.append(
                        f'<span class="{state_cls}">{a.name} <span class="hint">×{m.multiplier}</span> '
                        f'<span class="hint">[{state[:3]}]</span></span>'
                    )
                members_html = " ".join(chips) if chips else members_html
        active_badge = '<span class="badge status-open">ACTIVE</span>' if g.active else '<span class="badge status-closed">OFF</span>'

        # Next-group selector — <option> per known group + a None option
        next_options = '<option value="">— none —</option>'
        for gid, gname in _all_group_ids:
            if gid == g.id:
                continue
            sel = " selected" if g.next_group_id == gid else ""
            next_options += f'<option value="{gid}"{sel}>{gname}</option>'

        # Compact view: shows rotation summary. Click "Edit" to expand form.
        rot_summary = []
        if g.rotate_after_wins:   rot_summary.append(f'{g.rotate_after_wins}W')
        if g.rotate_after_losses: rot_summary.append(f'{g.rotate_after_losses}L')
        if g.rotate_after_profit: rot_summary.append(f'+${g.rotate_after_profit:.0f}')
        if g.rotate_after_loss_pnl: rot_summary.append(f'-${g.rotate_after_loss_pnl:.0f}')
        rot_txt = " / ".join(rot_summary) if rot_summary else "—"
        cascade_txt = ""
        if g.next_group_id:
            nx_name = next((n for i, n in _all_group_ids if i == g.next_group_id), None)
            cascade_txt = f' → <span class="chip">{nx_name}</span>' if nx_name else ""

        return f"""
        <tr class="group-row" id="group-row-{g.id}">
            <td>{g.id}</td>
            <td><strong>{g.name}</strong></td>
            <td>{g.description or "—"}</td>
            <td>{members_html}</td>
            <td>{rot_txt}{cascade_txt}</td>
            <td>{active_badge}</td>
            <td>
                <button type="button" class="btn-mini" onclick="toggleGroupEdit({g.id})">Edit</button>
            </td>
        </tr>
        <tr class="group-edit-row" id="group-edit-{g.id}" style="display:none">
            <td colspan="7">
                <form onsubmit="return saveGroup(event, {g.id})">
                    <div class="edit-grid">
                        <label>Rotate after wins <input type="number" name="rotate_after_wins" value="{g.rotate_after_wins or ''}" min="1"></label>
                        <label>Rotate after losses <input type="number" name="rotate_after_losses" value="{g.rotate_after_losses or ''}" min="1"></label>
                        <label>Rotate after profit $ <input type="number" step="any" name="rotate_after_profit" value="{g.rotate_after_profit or ''}"></label>
                        <label>Rotate after loss $ <input type="number" step="any" name="rotate_after_loss_pnl" value="{g.rotate_after_loss_pnl or ''}"></label>
                        <label>Min active count <input type="number" name="min_active_count" value="{g.min_active_count or 1}" min="1"></label>
                        <label>Next group (cascade)
                            <select name="next_group_id">{next_options}</select>
                        </label>
                        <label>Description
                            <input type="text" name="description" value="{(g.description or '').replace('"','&quot;')}">
                        </label>
                    </div>
                    <div class="edit-actions">
                        <button type="submit" class="btn-save">Save</button>
                        <button type="button" class="btn-cancel" onclick="toggleGroupEdit({g.id})">Cancel</button>
                    </div>
                </form>
            </td>
        </tr>
        """

    groups_html = "".join(_group_row(g) for g in _all_groups)
    closed_rows = "".join(_pos_row(p) for p in closed_positions)

    # --- Stop update ledger rows --------------------------------------------
    def _stop_row(s: StopUpdate) -> str:
        old_disp = f"{s.old_stop}" if s.old_stop is not None else "—"
        delta = ""
        if s.old_stop is not None and s.new_stop is not None:
            d = s.new_stop - s.old_stop
            sign = "+" if d > 0 else ""
            delta = f"<span class='hint'>({sign}{d:.2f})</span>"
        return f"""
        <tr>
            <td>{s.id}</td>
            <td>{s.created_at}</td>
            <td>{s.trade_id}</td>
            <td>{s.ticker}</td>
            <td>{s.side}</td>
            <td>{old_disp}</td>
            <td><strong>{s.new_stop}</strong> {delta}</td>
            <td><span class="badge status-stop">{s.source or "—"}</span></td>
        </tr>
        """
    stop_rows = "".join(_stop_row(s) for s in recent_stop_updates)

    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>Freeballin Trade Dashboard</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
            body {{
                margin: 0;
                font-family: Inter, Arial, sans-serif;
                background: #0b1020;
                color: #f5f7fb;
            }}
            .wrap {{
                max-width: 1280px;
                margin: 0 auto;
                padding: 32px 20px;
            }}
            .hero {{
                background: linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03));
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 24px;
                padding: 24px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.25);
                margin-bottom: 24px;
            }}
            .eyebrow {{
                color: #8ea0c9;
                font-size: 12px;
                text-transform: uppercase;
                letter-spacing: 0.2em;
                margin-bottom: 8px;
            }}
            h1 {{ margin: 0 0 8px 0; font-size: 32px; }}
            .sub {{ color: #9fb0d3; font-size: 14px; }}
            .stats {{
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
                gap: 16px;
                margin-top: 20px;
            }}
            .card {{
                background: rgba(255,255,255,0.04);
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 20px;
                padding: 18px;
            }}
            .card-label {{
                color: #8ea0c9;
                font-size: 12px;
                text-transform: uppercase;
                letter-spacing: 0.14em;
            }}
            .card-value {{
                margin-top: 10px;
                font-size: 28px;
                font-weight: 700;
            }}
            .panel {{
                background: rgba(255,255,255,0.04);
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 24px;
                padding: 20px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.2);
                margin-bottom: 20px;
            }}
            .panel-head {{
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 16px;
            }}
            .panel-title {{ font-size: 22px; font-weight: 700; }}
            .hint {{ color: #8ea0c9; font-size: 13px; }}
            table {{
                width: 100%;
                border-collapse: collapse;
                overflow: hidden;
            }}
            th, td {{
                text-align: left;
                padding: 12px 10px;
                border-bottom: 1px solid rgba(255,255,255,0.08);
                font-size: 13px;
            }}
            th {{
                color: #8ea0c9;
                font-size: 11px;
                text-transform: uppercase;
                letter-spacing: 0.14em;
            }}
            tr:hover {{ background: rgba(255,255,255,0.03); }}
            .badge {{
                display: inline-block;
                padding: 4px 10px;
                border-radius: 999px;
                font-size: 11px;
                font-weight: 700;
            }}
            .status-entry  {{ background: rgba(59,130,246,0.18); color: #93c5fd; }}
            .status-stop   {{ background: rgba(239,68,68,0.18);  color: #fca5a5; }}
            .status-tp     {{ background: rgba(34,197,94,0.18);  color: #86efac; }}
            .status-close  {{ background: rgba(168,85,247,0.18); color: #d8b4fe; }}
            .status-default{{ background: rgba(148,163,184,0.18);color: #cbd5e1; }}
            .status-open    {{ background: rgba(34,197,94,0.18);  color: #86efac; }}
            .status-partial {{ background: rgba(234,179,8,0.18);  color: #fde68a; }}
            .status-closed  {{ background: rgba(148,163,184,0.18);color: #cbd5e1; }}
            .status-pending {{ background: rgba(59,130,246,0.18); color: #93c5fd; }}
            .status-cancelled{{ background: rgba(239,68,68,0.18); color: #fca5a5; }}
            .side-long   {{ background: rgba(34,197,94,0.18);  color: #86efac; }}
            .side-short  {{ background: rgba(239,68,68,0.18);  color: #fca5a5; }}

            /* ---- Phase A: Trade Cards ---------------------------------- */
            .trade-card {{
                background: rgba(255,255,255,0.04);
                border: 1px solid rgba(255,255,255,0.10);
                border-radius: 20px;
                padding: 18px 20px;
                margin-bottom: 16px;
                box-shadow: 0 6px 24px rgba(0,0,0,0.20);
            }}
            .tc-header {{
                display: flex;
                justify-content: space-between;
                align-items: baseline;
                gap: 12px;
                flex-wrap: wrap;
                margin-bottom: 12px;
            }}
            .tc-title {{
                display: flex; align-items: center; gap: 10px; font-size: 20px; font-weight: 700;
            }}
            .tc-ticker {{ color: #f5f7fb; }}
            .tc-meta {{ display: flex; gap: 8px; align-items: center; font-size: 13px; }}
            .tc-error {{
                background: rgba(239,68,68,0.18);
                border: 1px solid rgba(239,68,68,0.4);
                border-radius: 12px;
                padding: 10px 14px;
                margin: 8px 0 12px 0;
                color: #fca5a5;
                font-weight: 600;
            }}
            .tc-grid {{
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 20px;
                margin-bottom: 14px;
            }}
            @media (max-width: 720px) {{
                .tc-grid {{ grid-template-columns: 1fr; }}
            }}
            .tc-line {{
                display: flex; justify-content: space-between; align-items: baseline; padding: 6px 0;
                border-bottom: 1px dashed rgba(255,255,255,0.06);
            }}
            .tc-k {{ color: #8ea0c9; font-size: 13px; }}
            .tc-v {{ font-size: 15px; }}
            .tc-pnl-panel {{
                background: rgba(255,255,255,0.02);
                border: 1px solid rgba(255,255,255,0.06);
                border-radius: 14px;
                padding: 14px 16px;
                height: 100%;
            }}
            .tc-pnl-line {{
                display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px;
            }}
            .tc-pnl-live {{
                border-bottom: 1px solid rgba(255,255,255,0.08);
                padding-bottom: 10px;
                margin-bottom: 10px;
            }}
            .tc-pnl-big {{ font-size: 24px; font-weight: 700; }}
            .tc-section {{ margin-top: 14px; }}
            .tc-section-title {{
                color: #8ea0c9; font-size: 12px; text-transform: uppercase; letter-spacing: 0.14em;
                margin-bottom: 8px;
            }}
            .tp-ladder {{ display: flex; flex-direction: column; gap: 4px; }}
            .tp-row {{
                display: grid;
                grid-template-columns: 30px 60px 90px 60px 1fr auto;
                gap: 12px;
                align-items: center;
                padding: 8px 12px;
                background: rgba(255,255,255,0.03);
                border-radius: 10px;
                font-size: 14px;
            }}
            .tp-row.tp-hit {{ background: rgba(34,197,94,0.12); border: 1px solid rgba(34,197,94,0.25); }}
            .tp-row.tp-off {{ background: transparent; color: rgba(255,255,255,0.35); font-style: italic; }}
            .tp-row.tp-runner {{ background: rgba(168,85,247,0.12); border: 1px solid rgba(168,85,247,0.30); }}
            .tp-icon {{ text-align: center; }}
            .tp-dollars {{ color: #86efac; font-weight: 600; }}
            .tp-state {{ color: #8ea0c9; font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; }}
            .stop-hist {{ display: flex; flex-direction: column; gap: 4px; }}
            .stop-hist-row {{
                display: grid;
                grid-template-columns: auto 1fr auto auto;
                gap: 14px;
                align-items: center;
                padding: 8px 12px;
                background: rgba(255,255,255,0.03);
                border-radius: 10px;
                font-size: 13px;
            }}

            /* ---- Phase 1.1: Accounts + Groups panels ------------------ */
            .chip {{
                display: inline-block;
                padding: 3px 10px;
                margin: 2px 4px 2px 0;
                background: rgba(59,130,246,0.15);
                border: 1px solid rgba(59,130,246,0.35);
                border-radius: 12px;
                font-size: 12px;
            }}
            .limit-bar-wrap {{
                position: relative;
                width: 160px;
                height: 20px;
                background: rgba(255,255,255,0.06);
                border-radius: 6px;
                overflow: hidden;
            }}
            .limit-bar {{
                height: 100%;
                transition: width 0.4s ease;
            }}
            .limit-bar-safe   {{ background: rgba(34,197,94,0.55); }}
            .limit-bar-warn   {{ background: rgba(250,204,21,0.55); }}
            .limit-bar-danger {{ background: rgba(239,68,68,0.65); }}
            .limit-bar-text {{
                position: absolute; inset: 0;
                display: flex; align-items: center; justify-content: center;
                font-size: 11px; color: #fff; font-weight: 600;
            }}
            .status-open {{
                background: rgba(34,197,94,0.18); color: #86efac;
            }}
            .status-closed {{
                background: rgba(148,163,184,0.18); color: #cbd5e1;
            }}
            /* Phase 1.3: chip color per account state */
            .chip-benched  {{ background: rgba(250,204,21,0.15); border-color: rgba(250,204,21,0.35); }}
            .chip-cooled   {{ background: rgba(59,130,246,0.15); border-color: rgba(59,130,246,0.35); }}
            .chip-stopped  {{ background: rgba(239,68,68,0.15); border-color: rgba(239,68,68,0.35); }}

            /* Phase 1.3: inline edit forms */
            .btn-mini {{
                padding: 4px 10px; font-size: 12px;
                background: rgba(59,130,246,0.20); border: 1px solid rgba(59,130,246,0.40);
                border-radius: 6px; color: #dbeafe; cursor: pointer;
            }}
            .btn-mini:hover {{ background: rgba(59,130,246,0.35); }}
            .btn-save {{
                padding: 6px 14px; font-size: 13px; font-weight: 600;
                background: rgba(34,197,94,0.30); border: 1px solid rgba(34,197,94,0.55);
                border-radius: 6px; color: #ecfdf5; cursor: pointer;
            }}
            .btn-cancel {{
                padding: 6px 14px; font-size: 13px;
                background: rgba(148,163,184,0.15); border: 1px solid rgba(148,163,184,0.35);
                border-radius: 6px; color: #cbd5e1; cursor: pointer;
                margin-left: 8px;
            }}
            .edit-grid {{
                display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 10px 16px; padding: 12px;
                background: rgba(255,255,255,0.03); border-radius: 12px;
            }}
            .edit-grid label {{
                display: flex; flex-direction: column; gap: 4px;
                font-size: 12px; color: #8ea0c9; text-transform: uppercase; letter-spacing: 0.08em;
            }}
            .edit-grid input, .edit-grid select {{
                padding: 6px 10px; font-size: 14px;
                background: rgba(0,0,0,0.30); color: #f5f7fb;
                border: 1px solid rgba(255,255,255,0.15); border-radius: 6px;
            }}
            .edit-actions {{ padding: 10px 12px 4px 12px; }}
            .pnl-pos     {{ color: #86efac; font-weight: 700; }}
            .pnl-neg     {{ color: #fca5a5; font-weight: 700; }}
            .live-dot {{
                display: inline-block;
                width: 8px; height: 8px;
                border-radius: 50%;
                background: #86efac;
                margin-right: 6px;
                vertical-align: middle;
                box-shadow: 0 0 0 0 rgba(134,239,172,0.7);
                animation: live-pulse 1.6s infinite;
            }}
            .live-dot.dead {{ background: #fca5a5; animation: none; }}
            @keyframes live-pulse {{
                0%   {{ box-shadow: 0 0 0 0 rgba(134,239,172,0.7); }}
                70%  {{ box-shadow: 0 0 0 10px rgba(134,239,172,0); }}
                100% {{ box-shadow: 0 0 0 0 rgba(134,239,172,0); }}
            }}
            .footer-links {{ margin-top: 18px; display: flex; gap: 12px; flex-wrap: wrap; }}
            .footer-links a {{
                color: #c7d2fe;
                text-decoration: none;
                background: rgba(255,255,255,0.05);
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 999px;
                padding: 10px 14px;
                font-size: 13px;
            }}
            .empty {{ color: #8ea0c9; padding: 22px 0 8px 0; }}
        </style>
    </head>
    <body>
        <!-- Sticky top nav — quick jump between panels -->
        <div class="topnav">
            <div class="topnav-inner">
                <div class="topnav-brand">
                    <span class="topnav-logo">🎯</span>
                    <span class="topnav-title">Trade Engine</span>
                    <span id="live-dot" class="live-dot"></span>
                    <span id="live-text" class="hint">Live</span>
                </div>
                <div class="topnav-links">
                    <a href="#overview">Overview</a>
                    <a href="#accounts">Accounts</a>
                    <a href="#groups">Groups</a>
                    <a href="#trades">Live Trades</a>
                    <a href="#positions">Positions</a>
                    <a href="#history">History</a>
                    <a href="/docs" target="_blank" class="topnav-external">API Docs ↗</a>
                </div>
            </div>
        </div>

        <div class="wrap">
            <!-- OVERVIEW -->
            <div class="hero" id="overview">
                <div class="eyebrow">Freeballin · Trade Engine · Phase 1.3</div>
                <h1>Trading Dashboard</h1>
                <div class="stats">
                    <div class="card">
                        <div class="card-label">Signals Logged</div>
                        <div class="card-value">{len(signals)}</div>
                    </div>
                    <div class="card">
                        <div class="card-label">Active Positions</div>
                        <div class="card-value">{len(active_positions)}</div>
                    </div>
                    <div class="card">
                        <div class="card-label">Closed (recent)</div>
                        <div class="card-value">{len(closed_positions)}</div>
                    </div>
                    <div class="card">
                        <div class="card-label">Broker</div>
                        <div class="card-value" style="font-size:18px;">{get_broker().name.title()} · <span style="opacity:.7">{get_broker().env}</span></div>
                    </div>
                    <div class="card">
                        <div class="card-label">Accounts</div>
                        <div class="card-value">{sum(1 for a in _all_accounts if a.state == 'active')} <span class="hint" style="font-size:14px;">active / {len(_all_accounts)} total</span></div>
                    </div>
                    <div class="card">
                        <div class="card-label">Groups</div>
                        <div class="card-value">{sum(1 for g in _all_groups if g.active)} <span class="hint" style="font-size:14px;">active</span></div>
                    </div>
                </div>
            </div>

            <!-- SECTION 1: MANAGEMENT (Accounts + Groups) — controls live at the top -->
            <div class="section-header">
                <h2>⚙ Management</h2>
                <span class="hint">Configure broker accounts and fan-out groups</span>
            </div>

            <div class="panel" id="accounts">
                <div class="panel-head">
                    <div class="panel-title">💼 Accounts</div>
                    <div class="panel-actions">
                        <span class="hint">Broker connections with rotation state + today's PnL</span>
                        <button class="btn-mini" onclick="togglePanel('accounts')">Collapse</button>
                    </div>
                </div>
                <div class="panel-body">
                {f'''
                <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Name</th>
                            <th>Broker</th>
                            <th>Env</th>
                            <th>Account ID</th>
                            <th>Mult</th>
                            <th>State / Cycle</th>
                            <th>Today Realized</th>
                            <th>Daily Loss Used</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>{accounts_html}</tbody>
                </table>
                </div>
                ''' if _all_accounts else '<div class="empty">No accounts yet. <code>POST /api/accounts?key=trading123</code> to add one.</div>'}
                </div>
            </div>

            <div class="panel" id="groups">
                <div class="panel-head">
                    <div class="panel-title">👥 Groups</div>
                    <div class="panel-actions">
                        <span class="hint">Fan-out targets · one Pine signal → all active members</span>
                        <button class="btn-mini" onclick="togglePanel('groups')">Collapse</button>
                    </div>
                </div>
                <div class="panel-body">
                {f'''
                <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Name</th>
                            <th>Description</th>
                            <th>Members (state)</th>
                            <th>Rotation → Cascade</th>
                            <th>Status</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>{groups_html}</tbody>
                </table>
                </div>
                ''' if _all_groups else '<div class="empty">No groups yet. <code>POST /api/groups?key=trading123</code> to create one.</div>'}
                </div>
            </div>

            <!-- SECTION 2: LIVE TRADES — the main event -->
            <div class="section-header">
                <h2>🎯 Live Trades</h2>
                <span class="hint">Rich per-trade view · full context on entry, TPs, stops, PnL</span>
            </div>

            <div class="panel" id="trades">
                <div class="panel-head">
                    <div class="panel-title">Active trade cards</div>
                    <div class="panel-actions">
                        <span class="hint">{len(active_positions)} open</span>
                        <button class="btn-mini" onclick="togglePanel('trades')">Collapse</button>
                    </div>
                </div>
                <div class="panel-body">
                {trade_cards_html if trade_cards_html else '<div class="empty">No live trades right now.</div>'}
                </div>
            </div>

            <!-- SECTION 3: POSITIONS (compact tables — Active + Closed) -->
            <div class="section-header">
                <h2>📊 Positions</h2>
                <span class="hint">Compact table view of all positions past + present</span>
            </div>

            <div class="panel" id="positions">
                <div class="panel-head">
                    <div class="panel-title">Active Positions</div>
                    <div class="panel-actions">
                        <span class="hint">PENDING · OPEN · PARTIAL</span>
                        <button class="btn-mini" onclick="togglePanel('positions')">Collapse</button>
                    </div>
                </div>
                <div class="panel-body">
                {f'''
                <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Trade ID</th>
                            <th>Ticker</th>
                            <th>Side</th>
                            <th>Status</th>
                            <th>Qty Open</th>
                            <th>Entry</th>
                            <th>Stop</th>
                            <th>Stop Source</th>
                            <th>Locked PnL</th>
                            <th>Live PnL</th>
                            <th>Exit Reason</th>
                            <th>Updated</th>
                        </tr>
                    </thead>
                    <tbody>{active_rows}</tbody>
                </table>
                </div>
                ''' if active_positions else '<div class="empty">No active positions.</div>'}
                </div>
            </div>

            <div class="panel" id="closed">
                <div class="panel-head">
                    <div class="panel-title">Closed Positions</div>
                    <div class="panel-actions">
                        <span class="hint">Last 25</span>
                        <button class="btn-mini" onclick="togglePanel('closed')">Collapse</button>
                    </div>
                </div>
                <div class="panel-body panel-body-collapsed">
                {f'''
                <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Trade ID</th>
                            <th>Ticker</th>
                            <th>Side</th>
                            <th>Status</th>
                            <th>Qty Open</th>
                            <th>Entry</th>
                            <th>Stop</th>
                            <th>Stop Source</th>
                            <th>Locked PnL</th>
                            <th>Live PnL</th>
                            <th>Exit Reason</th>
                            <th>Updated</th>
                        </tr>
                    </thead>
                    <tbody>{closed_rows}</tbody>
                </table>
                </div>
                ''' if closed_positions else '<div class="empty">No closed positions yet.</div>'}
                </div>
            </div>

            <!-- SECTION 4: HISTORY (Stop Updates + Signals — collapsed by default) -->
            <div class="section-header">
                <h2>📜 History</h2>
                <span class="hint">Stop ledger + webhook signal log</span>
            </div>

            <div class="panel" id="history">
                <div class="panel-head">
                    <div class="panel-title">Stop Updates</div>
                    <div class="panel-actions">
                        <span class="hint">BE · JUMP · TRAIL · RESYNC · MASTER · drag — last 50</span>
                        <button class="btn-mini" onclick="togglePanel('history')">Collapse</button>
                    </div>
                </div>
                <div class="panel-body panel-body-collapsed">
                {f'''
                <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Time</th>
                            <th>Trade ID</th>
                            <th>Ticker</th>
                            <th>Side</th>
                            <th>Old Stop</th>
                            <th>New Stop</th>
                            <th>Source</th>
                        </tr>
                    </thead>
                    <tbody>{stop_rows}</tbody>
                </table>
                </div>
                ''' if recent_stop_updates else '<div class="empty">No stop updates yet.</div>'}
                </div>
            </div>

            <div class="panel" id="signals">
                <div class="panel-head">
                    <div class="panel-title">Recent Signals</div>
                    <div class="panel-actions">
                        <span class="hint">Latest 50 webhook events</span>
                        <button class="btn-mini" onclick="togglePanel('signals')">Collapse</button>
                    </div>
                </div>
                <div class="panel-body panel-body-collapsed">
                {f'''
                <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Event</th>
                            <th>Ticker</th>
                            <th>Side</th>
                            <th>Qty</th>
                            <th>Action</th>
                            <th>Pos Status</th>
                            <th>Trade ID</th>
                            <th>Event ID</th>
                            <th>Time</th>
                        </tr>
                    </thead>
                    <tbody>{signal_rows}</tbody>
                </table>
                </div>
                ''' if signals else '<div class="empty">No signals yet.</div>'}

                <div class="footer-links">
                    <a href="/docs">API Docs</a>
                    <a href="/api/signals">Raw Signals JSON</a>
                    <a href="/api/positions">Positions JSON</a>
                    <a href="/api/stop-updates">Stop Updates JSON</a>
                    <a href="/api/accounts">Accounts JSON</a>
                    <a href="/api/groups">Groups JSON</a>
                </div>
                </div>
            </div>
        </div>

        <script>
        // ─── Live update layer ─────────────────────────────────────────────
        // Opens a WebSocket to /ws/live. On every "state_changed" event the
        // server pushes (after each webhook commit), we softly reload the
        // page. Using full reload keeps the JS tiny and guarantees every
        // panel reflects the latest server state — no client-side cache
        // to drift.
        //
        // The live dot in the header turns red if the WS drops; we also
        // auto-reconnect with backoff.
        (function () {{
            const proto = location.protocol === "https:" ? "wss:" : "ws:";
            const url   = proto + "//" + location.host + "/ws/live";
            let backoff = 500, reloadTimer = null;
            const dot   = document.getElementById("live-dot");
            const text  = document.getElementById("live-text");

            function markDead(msg) {{
                if (dot)  dot.classList.add("dead");
                if (text) text.textContent = msg;
            }}
            function markLive() {{
                if (dot)  dot.classList.remove("dead");
                if (text) text.textContent = "Live — auto-updating";
            }}

            // Asset point values mirrored from server (small table).
            const POINT_VALUES = {{
                MNQ:2, NQ:20, MES:5, ES:50, M2K:5, RTY:50, MYM:0.5, YM:5,
                MGC:10, GC:100, CL:1000, MNG:1000, NG:10000
            }};
            function assetRoot(t) {{
                if (!t) return "";
                t = t.toUpperCase().trim();
                if (t.endsWith("1!")) t = t.slice(0, -2);
                // strip month-coded suffix (MNQM2026 -> MNQ)
                if (t.length >= 5 && "FGHJKMNQUVXZ".includes(t[t.length-5]) &&
                    /^\\d{{4}}$/.test(t.slice(-4))) {{ t = t.slice(0, -5); }}
                return t;
            }}
            function fmtMoney(v) {{
                const sign = v < 0 ? "-" : "";
                return sign + "$" + Math.abs(v).toLocaleString(undefined,
                    {{minimumFractionDigits:2, maximumFractionDigits:2}});
            }}
            function applyPnlTick(quotes) {{
                document.querySelectorAll("tr[data-trade-id]").forEach((row) => {{
                    const ticker = row.dataset.ticker;
                    const entry  = parseFloat(row.dataset.entry);
                    const side   = (row.dataset.side || "").toUpperCase();
                    const qty    = parseInt(row.dataset.qtyOpen || "0", 10);
                    const cell   = row.querySelector(".live-pnl-cell");
                    if (!cell || !ticker || isNaN(entry) || !qty) return;
                    const root   = assetRoot(ticker);
                    const q      = quotes[root];
                    if (!q) return;
                    const last   = q.last || ((q.bid && q.ask) ? (q.bid+q.ask)/2 : null);
                    const pv     = POINT_VALUES[root];
                    if (last == null || pv == null) return;
                    const sign   = side === "LONG" ? 1 : -1;
                    const pnl    = (last - entry) * sign * qty * pv;
                    const cls    = pnl >= 0 ? "pnl-pos" : "pnl-neg";
                    cell.innerHTML = '<span class="' + cls + '">' + fmtMoney(pnl) + '</span>';
                }});
            }}
            function connect() {{
                const ws = new WebSocket(url);
                ws.onopen = () => {{ backoff = 500; markLive(); }};
                ws.onmessage = (ev) => {{
                    let msg;
                    try {{ msg = JSON.parse(ev.data); }} catch (_) {{ return; }}
                    if (msg.type === "state_changed") {{
                        // Debounce — burst webhooks reload only once.
                        if (reloadTimer) clearTimeout(reloadTimer);
                        reloadTimer = setTimeout(() => location.reload(), 250);
                    }} else if (msg.type === "pnl_tick") {{
                        // Live PnL ticks — update cells in place, no
                        // full reload. quotes shape: {{ROOT: {{last, ...}}}}
                        applyPnlTick(msg.quotes || {{}});
                    }}
                }};
                ws.onclose = () => {{
                    markDead("Reconnecting…");
                    setTimeout(connect, backoff);
                    backoff = Math.min(backoff * 2, 8000);
                }};
                ws.onerror = () => {{ try {{ ws.close(); }} catch (_) {{}} }};
            }}
            connect();
        }})();

        // Phase 1.3: Group edit forms + account state controls
        function toggleGroupEdit(id) {{
            const row = document.getElementById('group-edit-' + id);
            if (!row) return;
            row.style.display = (row.style.display === 'none' || !row.style.display) ? 'table-row' : 'none';
        }}
        async function saveGroup(ev, id) {{
            ev.preventDefault();
            const form = ev.target;
            const fd = new FormData(form);
            const body = {{}};
            for (const [k, v] of fd.entries()) {{
                if (v === '' || v === null) continue;
                if (k === 'description') {{ body[k] = v; continue; }}
                const num = Number(v);
                body[k] = Number.isFinite(num) ? num : v;
            }}
            // 'next_group_id' + all rotate_* fields: allow explicit clear via a checkbox trick? For now empty=skip.
            try {{
                const resp = await fetch(`/api/groups/${{id}}?key=trading123`, {{
                    method: 'PATCH',
                    headers: {{'Content-Type': 'application/json'}},
                    body: JSON.stringify(body),
                }});
                if (!resp.ok) {{
                    const t = await resp.text();
                    alert('Save failed: ' + resp.status + ' ' + t);
                    return false;
                }}
                location.reload();
            }} catch (e) {{
                alert('Save error: ' + e);
            }}
            return false;
        }}
        async function patchAccount(id, body) {{
            try {{
                const resp = await fetch(`/api/accounts/${{id}}?key=trading123`, {{
                    method: 'PATCH',
                    headers: {{'Content-Type': 'application/json'}},
                    body: JSON.stringify(body),
                }});
                if (!resp.ok) {{
                    alert('Failed: ' + resp.status + ' ' + await resp.text());
                    return;
                }}
                location.reload();
            }} catch (e) {{ alert('Error: ' + e); }}
        }}
        function setAccountState(id, state) {{ patchAccount(id, {{state, wins_cycle: 0, losses_cycle: 0, pnl_cycle: 0}}); }}
        function pauseAccount(id, val)    {{ patchAccount(id, {{paused: !!val}}); }}
        </script>
    </body>
    </html>
    """

    return HTMLResponse(content=html)


@app.post("/api/webhook/pmt-compat")
def webhook_pmt_compat(data: PMTWebhook, db: Session = Depends(get_db)):
    """Observability sink for PMT-shaped webhooks (e.g. v17.9.16 automation).

    The user keeps their existing TradingView alert pointing directly
    at PMT for execution. They ALSO create a second alert with the same
    conditions, webhook URL = this endpoint. The PMT JSON arrives here,
    we translate to internal TradeEngine shape, run the dedup +
    state-machine pipeline, and save a Position row to the dashboard.

    This endpoint is HARDCODED to observe_only=True — even if PMT or
    TradeSyncer env vars get set later, this path will NEVER place a
    real broker order. Eliminates double-execution risk.
    """
    # Translate PMT shape → internal Trade Engine shape.
    translated = pmt_to_trade_engine(data)
    te_payload = TradeEngineWebhook(**translated)

    # Content-hash dedup against the same 60s store. If TradingView spams
    # the alert (which it sometimes does on re-evaluations), we collapse
    # to a single Position row just like the main endpoint.
    payload_dict = te_payload.model_dump()
    dup, payload_h = is_duplicate(payload_dict)
    if dup:
        return {
            "message": "duplicate ignored (content hash)",
            "status": "duplicate_ignored",
            "source": "pmt-compat",
            "dedupe_hash": payload_h,
            "event": te_payload.event,
            "ticker": te_payload.ticker,
        }
    mark_seen(payload_h)

    # Synthesize trade_id / event_id the same way the main endpoint does
    # (Phase 5e).
    if not te_payload.trade_id:
        event_upper = (te_payload.event or "").upper()
        if event_upper == "ENTRY":
            te_payload.trade_id = synth_entry_trade_id(te_payload.ticker, te_payload.side)
        else:
            active = (
                db.query(Position)
                .filter(
                    Position.ticker == te_payload.ticker,
                    Position.status.in_(["OPEN", "PARTIAL", "PENDING"]),
                )
                .order_by(Position.updated_at.desc())
                .first()
            )
            if active is not None:
                te_payload.trade_id = active.trade_id
                te_payload.side = active.side  # CLOSE didn't carry side
    if not te_payload.event_id and te_payload.trade_id:
        te_payload.event_id = synth_event_id(te_payload.trade_id, te_payload.event)

    # DB-level dedup (UNIQUE index on event_id).
    if te_payload.event_id:
        existing = (
            db.query(WebhookSignal)
            .filter(WebhookSignal.event_id == te_payload.event_id)
            .first()
        )
        if existing:
            return {
                "message": "duplicate ignored",
                "status": "duplicate_ignored",
                "source": "pmt-compat",
                "id": existing.id,
                "event_id": existing.event_id,
                "trade_id": existing.trade_id,
                "event": existing.event,
                "ticker": existing.ticker,
            }

    # State machine — forced observe_only so NO broker call ever happens.
    execution_result = execute_trade(te_payload, db, observe_only=True)
    execution_result["source"] = "pmt-compat"

    signal = WebhookSignal(
        event=te_payload.event,
        ticker=te_payload.ticker,
        side=te_payload.side,
        qty=te_payload.qty,
        key=te_payload.key,
        trade_id=te_payload.trade_id,
        event_id=te_payload.event_id,
        raw_payload=json.dumps({
            "signal": te_payload.model_dump(),
            "pmt_raw": data.model_dump(),
            "execution": execution_result,
        }),
    )
    db.add(signal)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = (
            db.query(WebhookSignal)
            .filter(WebhookSignal.event_id == te_payload.event_id)
            .first()
        )
        return {
            "message": "duplicate ignored",
            "status": "duplicate_ignored",
            "source": "pmt-compat",
            "id": existing.id if existing else None,
            "event_id": te_payload.event_id,
            "trade_id": te_payload.trade_id,
            "event": te_payload.event,
            "ticker": te_payload.ticker,
        }
    db.refresh(signal)

    ws_manager.broadcast_threadsafe({
        "type": "state_changed",
        "trigger": {
            "event": signal.event,
            "ticker": signal.ticker,
            "trade_id": signal.trade_id,
            "event_id": signal.event_id,
            "position_status": execution_result.get("position_status"),
            "action": execution_result.get("action"),
            "source": "pmt-compat",
        },
    })

    return {
        "message": "pmt-compat observed",
        "status": "observed",
        "id": signal.id,
        "event": signal.event,
        "ticker": signal.ticker,
        "trade_id": signal.trade_id,
        "event_id": signal.event_id,
        "execution": execution_result,
    }


# ---------------------------------------------------------------------------
# Phase 1.2a: source-specific webhook endpoints
# ---------------------------------------------------------------------------
# Two thin wrappers that inject a default group name based on which URL the
# Pine indicator posts to. Lets user run BOTH the automation and the manual
# TM on the same server, same asset, without any Pine edits — just point
# each indicator at its own URL.
#
#   Automation (v2.68 + 6.24)  →  /api/webhook/trade-engine/auto     (group defaults to "auto")
#   Manual TM  (v20.88)        →  /api/webhook/trade-engine/manual   (group defaults to "manual")
#
# If the payload already carries a `group` field, that wins — the URL only
# provides a default.

@app.post("/api/webhook/trade-engine/auto")
def webhook_auto(data: TradeEngineWebhook, db: Session = Depends(get_db)):
    if not data.group:
        data.group = "auto"
    return webhook(data, db)


@app.post("/api/webhook/trade-engine/manual")
def webhook_manual(data: TradeEngineWebhook, db: Session = Depends(get_db)):
    if not data.group:
        data.group = "manual"
    return webhook(data, db)


@app.post("/api/webhook/trade-engine/group/{group_name}")
def webhook_by_group(group_name: str, data: TradeEngineWebhook, db: Session = Depends(get_db)):
    """Dynamic group routing — TradingView alert URL includes the group
    name. Lets user run N alerts across N groups without any Pine edits.

    Example URLs the user configures in TradingView:
        .../api/webhook/trade-engine/group/group1_auto
        .../api/webhook/trade-engine/group/group2_auto
        .../api/webhook/trade-engine/group/group3_manual

    Each URL points at the same server but auto-tags the signal with a
    different group name → fans out to that group's active members.
    """
    if not data.group:
        data.group = group_name
    return webhook(data, db)


# ----- Task #172: Demo webhook (trial sandbox) -----------------------------
# Public sandbox endpoint. Anyone with a trial_key can POST here from a
# TradingView demo indicator; we log the payload and NEVER route to a real
# broker. Paired with GET /api/webhook/demo/{trial_key}/events which the
# Demo page polls to render a live "what would happen" preview.
#
# Auth model: trial_key itself is the credential — pick anything hard to
# guess, share it in the trial link. No admin key required.

@app.post("/api/webhook/demo/{trial_key}")
async def demo_webhook(trial_key: str, request: Request, db: Session = Depends(get_db)):
    """Sandbox — accepts any JSON, logs it, returns a preview of what
    TradeCore's fan-out + safety layer WOULD have done in real trading."""
    if not trial_key or len(trial_key) < 4:
        raise HTTPException(status_code=400, detail="trial_key too short (min 4 chars)")
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    payload_str = json.dumps(payload) if payload else (await request.body()).decode("utf-8", "ignore")

    event_type = str(payload.get("event") or payload.get("action") or payload.get("data") or "DEMO").upper()
    ticker = str(payload.get("ticker") or payload.get("symbol") or "?")
    side = str(payload.get("side") or payload.get("direction") or "?")
    qty = int(payload.get("quantity") or payload.get("qty") or 0)

    row = WebhookSignal(
        event=f"DEMO_{event_type}"[:60],
        ticker=ticker[:40],
        side=side[:20],
        qty=qty,
        key=f"demo:{trial_key}"[:60],
        raw_payload=payload_str,
        trade_id=f"DEMO-{trial_key}",
    )
    db.add(row); db.commit(); db.refresh(row)

    return {
        "accepted": True,
        "note": "This is a demo endpoint. No real broker order was sent.",
        "would_have_done": {
            "event": event_type,
            "ticker": ticker,
            "side": side,
            "qty": qty,
            "fan_out_target": "sandbox — no accounts touched",
            "safety_gates_run": ["kill_switch", "guardian", "time_window", "max_positions", "preflight"],
        },
        "trial_key": trial_key,
        "event_id": row.id,
        "logged_at": row.created_at.isoformat() if row.created_at else None,
    }


@app.get("/api/webhook/demo/{trial_key}/events")
def demo_webhook_events(trial_key: str, limit: int = 50, db: Session = Depends(get_db)):
    """Recent demo events for the given trial_key. Feeds the /Demo page's
    live 'what would happen' preview panel."""
    if not trial_key or len(trial_key) < 4:
        raise HTTPException(status_code=400, detail="trial_key too short (min 4 chars)")
    rows = (
        db.query(WebhookSignal)
        .filter(WebhookSignal.key == f"demo:{trial_key}")
        .order_by(WebhookSignal.id.desc())
        .limit(min(limit, 200))
        .all()
    )
    return {
        "trial_key": trial_key,
        "count": len(rows),
        "events": [
            {
                "id": r.id,
                "ts": r.created_at.isoformat() if r.created_at else None,
                "event": r.event,
                "ticker": r.ticker,
                "side": r.side,
                "qty": r.qty,
                "raw_payload": r.raw_payload,
            }
            for r in rows
        ],
    }


@app.delete("/api/webhook/demo/{trial_key}/events")
def demo_webhook_clear(trial_key: str, db: Session = Depends(get_db)):
    """Clear demo events for a trial_key — 'reset the sandbox'."""
    if not trial_key or len(trial_key) < 4:
        raise HTTPException(status_code=400, detail="trial_key too short (min 4 chars)")
    n = db.query(WebhookSignal).filter(WebhookSignal.key == f"demo:{trial_key}").delete()
    db.commit()
    return {"cleared": n, "trial_key": trial_key}


# ----- Task #139 + #59: General signal log + copy-trade audit ledger -------
# Feeds the Logs page. Returns recent rows from webhook_signals so the
# frontend can render + filter by kind (observe / demo / PMT / entry /
# close / SL) and expand each raw payload. This is READ-only.

@app.get("/api/webhook-signals")
def list_webhook_signals(limit: int = 200, kind: Optional[str] = None, db: Session = Depends(get_db)):
    """Recent webhook signals across every intake path (observe, demo,
    PMT-compat, trade-engine). Feeds the Logs page + copy-trade ledger.
    Filter by kind: observe / demo / pmt / entry / close / sl.
    """
    q = db.query(WebhookSignal).order_by(WebhookSignal.id.desc())
    k = (kind or "").lower()
    if k == "observe":
        q = q.filter(WebhookSignal.key.like("observe:%"))
    elif k == "demo":
        q = q.filter(WebhookSignal.key.like("demo:%"))
    elif k == "pmt":
        q = q.filter(WebhookSignal.event.like("%PMT%") | WebhookSignal.key.like("%pmt%"))
    elif k == "entry":
        q = q.filter((WebhookSignal.event.like("%BUY%")) | (WebhookSignal.event.like("%SELL%")))
    elif k == "close":
        q = q.filter(WebhookSignal.event.like("%CLOSE%"))
    elif k == "sl":
        q = q.filter(WebhookSignal.event.like("SL%"))

    rows = q.limit(min(max(limit, 1), 500)).all()
    return {
        "count": len(rows),
        "events": [
            {
                "id": r.id,
                "ts": r.created_at.isoformat() if r.created_at else None,
                "event": r.event,
                "ticker": r.ticker,
                "side": r.side,
                "qty": r.qty,
                "key": r.key,
                "trade_id": r.trade_id,
                "event_id": r.event_id,
                "raw_payload": r.raw_payload,
            }
            for r in rows
        ],
    }


# ----- Task #134: Webhook retry queue --------------------------------------
# List / inspect / manually retry / dead-letter management for outbound
# webhook deliveries that failed. The queue itself (WebhookRetry rows)
# is populated by the executor when a broker call errors; a background
# drain task processes pending rows with exponential backoff.

@app.get("/api/webhook-retries")
def list_webhook_retries(status: Optional[str] = None, limit: int = 100, db: Session = Depends(get_db)):
    """List queued outbound webhook retries. Filter by status:
    pending / in_flight / delivered / dead."""
    q = db.query(WebhookRetry).order_by(WebhookRetry.next_attempt_at.asc(), WebhookRetry.id.desc())
    if status:
        q = q.filter(WebhookRetry.status == status.lower())
    rows = q.limit(min(max(limit, 1), 500)).all()
    return {
        "count": len(rows),
        "retries": [
            {
                "id": r.id,
                "target_url": r.target_url,
                "method": r.method,
                "attempts": r.attempts,
                "max_attempts": r.max_attempts,
                "status": r.status,
                "next_attempt_at": r.next_attempt_at.isoformat() if r.next_attempt_at else None,
                "last_http_status": r.last_http_status,
                "last_error": r.last_error,
                "origin_signal_id": r.origin_signal_id,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "delivered_at": r.delivered_at.isoformat() if r.delivered_at else None,
            }
            for r in rows
        ],
    }


@app.post("/api/webhook-retries/{retry_id}/retry-now")
def retry_now(retry_id: int, db: Session = Depends(get_db)):
    """Force a queued retry to fire on the next drain tick (bump
    next_attempt_at to NOW, reset status → pending)."""
    row = db.query(WebhookRetry).filter(WebhookRetry.id == retry_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="retry not found")
    row.next_attempt_at = datetime.now(timezone.utc)
    row.status = "pending"
    row.last_error = None
    db.commit(); db.refresh(row)
    return {"ok": True, "id": row.id, "status": row.status, "next_attempt_at": row.next_attempt_at.isoformat()}


@app.post("/api/webhook-retries/{retry_id}/kill")
def kill_retry(retry_id: int, db: Session = Depends(get_db)):
    """Give up on a retry — mark it dead so it stops trying. Useful when
    you fixed the underlying config manually and don't want a stale
    payload replayed later."""
    row = db.query(WebhookRetry).filter(WebhookRetry.id == retry_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="retry not found")
    row.status = "dead"
    db.commit()
    return {"ok": True, "id": row.id, "status": row.status}


# Helper: enqueue a retry. Called by the executor when a broker webhook
# POST fails. Uses exponential backoff: 30s · 2m · 8m · 30m · 2h.
BACKOFF_SECONDS = [30, 120, 480, 1800, 7200]

def enqueue_webhook_retry(db: Session, target_url: str, payload_str: str,
                          headers: Optional[dict] = None, method: str = "POST",
                          origin_signal_id: Optional[int] = None,
                          initial_error: Optional[str] = None) -> int:
    """Add a failed outbound webhook to the retry queue. Returns row id."""
    row = WebhookRetry(
        target_url=target_url,
        method=method,
        payload=payload_str,
        headers=headers,
        origin_signal_id=origin_signal_id,
        attempts=0,
        max_attempts=len(BACKOFF_SECONDS),
        next_attempt_at=datetime.now(timezone.utc) + timedelta(seconds=BACKOFF_SECONDS[0]),
        status="pending",
        last_error=initial_error,
    )
    db.add(row); db.commit(); db.refresh(row)
    return row.id


# ----- Task #186: Observe webhook (log-only, no forwarding) ----------------
# Companion endpoint for observe-mode accounts (PMT / TradersPost).
# The user's TradingView alert keeps firing at PMT/TradersPost for execution
# and ALSO fires a copy at this URL. We just log the payload — TradeCore
# NEVER routes orders in observe mode. The observed stream powers journal,
# analytics, rules checklist, rotation stats, live position display, and
# timelines. See tradecore_pmt_observe_mode.md for the design lock.
#
# URL shape mirrors the demo endpoint so the frontend can build it the
# same way in BrokerCredentialsModal.tradecoreWebhook(acctId):
#     .../api/webhook/observe/{account_key}
#
# account_key = Account.id (preferred) or Account.name — either resolves.
# If neither matches a real account, we still log (so misconfig is visible
# in the events feed) but flag matched=false in the response.

def _resolve_observe_account(db: Session, account_key: str):
    """Look up an Account by id or name. Returns Account or None."""
    if not account_key:
        return None
    # Try id first (numeric or string)
    try:
        acct = db.query(Account).filter(Account.id == int(account_key)).first()
        if acct:
            return acct
    except (ValueError, TypeError):
        pass
    # Fall back to exact name match
    return db.query(Account).filter(Account.name == account_key).first()


@app.post("/api/webhook/observe/{account_key}")
async def observe_webhook(account_key: str, request: Request, db: Session = Depends(get_db)):
    """OBSERVE-ONLY sink. Logs the payload, NEVER routes to a broker.
    Called from a second webhook on the user's TradingView alert while
    the primary webhook stays wired to PMT / TradersPost for execution."""
    if not account_key or len(account_key) < 1:
        raise HTTPException(status_code=400, detail="account_key required")

    try:
        payload = await request.json()
    except Exception:
        payload = {}
    raw_body = (await request.body()).decode("utf-8", "ignore") if not payload else json.dumps(payload)

    # Pull the same fields we extract from other webhook shapes so the
    # events feed reads consistently across observe / demo / direct.
    event_type = str(
        payload.get("event") or payload.get("action") or payload.get("data")
        or payload.get("strategy_name") or "OBSERVE"
    ).upper()
    ticker = str(payload.get("ticker") or payload.get("symbol") or "?")
    side = str(payload.get("side") or payload.get("direction") or payload.get("data") or "?")
    try:
        qty = int(payload.get("quantity") or payload.get("qty") or 0)
    except (TypeError, ValueError):
        qty = 0

    acct = _resolve_observe_account(db, account_key)

    row = WebhookSignal(
        event=f"OBSERVE_{event_type}"[:60],
        ticker=ticker[:40],
        side=side[:20],
        qty=qty,
        key=f"observe:{account_key}"[:60],
        raw_payload=raw_body,
        trade_id=f"OBSERVE-{account_key}"[:80] if acct is None else f"OBSERVE-{acct.id}",
    )
    db.add(row); db.commit(); db.refresh(row)

    return {
        "accepted": True,
        "mode": "observe",
        "note": "OBSERVE-ONLY. No broker order was sent by TradeCore.",
        "matched": acct is not None,
        "account_id": acct.id if acct else None,
        "account_name": acct.name if acct else None,
        "event_id": row.id,
        "event": event_type,
        "ticker": ticker,
        "side": side,
        "qty": qty,
        "logged_at": row.created_at.isoformat() if row.created_at else None,
    }


@app.get("/api/webhook/observe/{account_key}/events")
def observe_webhook_events(account_key: str, limit: int = 50, db: Session = Depends(get_db)):
    """Recent observe events for an account_key. Feeds the account card's
    'last signal' timestamp and the observed-signals timeline."""
    if not account_key:
        raise HTTPException(status_code=400, detail="account_key required")
    rows = (
        db.query(WebhookSignal)
        .filter(WebhookSignal.key == f"observe:{account_key}")
        .order_by(WebhookSignal.id.desc())
        .limit(min(limit, 200))
        .all()
    )
    return {
        "account_key": account_key,
        "count": len(rows),
        "last_signal_at": rows[0].created_at.isoformat() if rows and rows[0].created_at else None,
        "events": [
            {
                "id": r.id,
                "ts": r.created_at.isoformat() if r.created_at else None,
                "event": r.event,
                "ticker": r.ticker,
                "side": r.side,
                "qty": r.qty,
                "raw_payload": r.raw_payload,
            }
            for r in rows
        ],
    }


@app.delete("/api/webhook/observe/{account_key}/events")
def observe_webhook_clear(account_key: str, db: Session = Depends(get_db)):
    """Clear observed events for an account_key. Useful when re-testing
    the wiring or handing an account off between users."""
    if not account_key:
        raise HTTPException(status_code=400, detail="account_key required")
    n = db.query(WebhookSignal).filter(WebhookSignal.key == f"observe:{account_key}").delete()
    db.commit()
    return {"cleared": n, "account_key": account_key}


@app.post("/api/webhook/strategy/{slug}")
def webhook_by_strategy(slug: str, data: TradeEngineWebhook, db: Session = Depends(get_db)):
    """Task #119: strategy-scoped webhook URL. Each Strategy has its own
    unique webhook_slug. TradingView alert URL:
        .../api/webhook/strategy/6-24-base
        .../api/webhook/strategy/v2-72
        .../api/webhook/strategy/tm-v20-88

    This unlocks 'run same asset on multiple strategies simultaneously'
    (task #147) — each strategy tags positions with its own strategy_id
    so 6.24 MNQ trade ≠ TM MNQ trade in our DB, even on the same
    account (unlike PMT which collapses them).

    Auth is per-strategy: data.key must match strategy.webhook_key
    (falls back to global USER_KEY for backwards-compat if strategy
    doesn't have its own key set).
    """
    strat = db.query(Strategy).filter(Strategy.webhook_slug == slug).first()
    if not strat:
        raise HTTPException(status_code=404, detail=f"strategy slug '{slug}' not found")
    if not strat.is_active:
        raise HTTPException(status_code=403, detail=f"strategy '{strat.name}' is inactive")

    # Auth: prefer strategy's own key; fall back to global USER_KEY
    expected_key = strat.webhook_key or os.getenv("USER_KEY", "trading123")
    if data.key != expected_key:
        raise HTTPException(status_code=401, detail="Invalid webhook key")

    # Route into the strategy's designated group, if bound
    if not data.group and strat.default_group_id:
        grp = db.query(Group).filter(Group.id == strat.default_group_id).first()
        if grp:
            data.group = grp.name

    # Stamp strategy metadata so downstream position insert can tag it.
    # We hijack the `source` field of the payload as a low-touch way to
    # carry strategy_id through the existing dedup + executor path
    # without a new schema field. The webhook handler will surface it
    # when it builds the Position row.
    data.source = f"strategy:{strat.id}:{strat.name}"

    return webhook(data, db)


@app.post("/api/webhook/trade-engine")
def webhook(data: TradeEngineWebhook, db: Session = Depends(get_db)):
    if data.key != os.getenv("USER_KEY", "trading123"):
        raise HTTPException(status_code=401, detail="Invalid webhook key")

    # ---- Phase 5e: content-hash dedup (absorbs Pine spam) ---------------
    # When the indicator re-fires the same alert within 60s (recompile,
    # alert.freq_all re-evaluation, etc.) we drop the duplicate at the
    # door — no Position mutation, no broadcast, no row written.
    payload_dict = data.model_dump()
    dup, payload_h = is_duplicate(payload_dict)
    if dup:
        return {
            "message": "duplicate ignored (content hash)",
            "status": "duplicate_ignored",
            "dedupe_hash": payload_h,
            "event": data.event,
            "ticker": data.ticker,
        }
    mark_seen(payload_h)

    # ---- Phase 5e: auto-synthesize trade_id + event_id ------------------
    # The TM v20.80 doesn't send trade_id/event_id natively (v20.81 patch
    # adds them). Until that patch lands we synthesize from payload data
    # so the state machine still works:
    #   ENTRY  → AUTO-<ticker>-<minute>-<side>
    #   other  → look up most recent OPEN position for ticker, reuse its id
    if not data.trade_id:
        event_upper = (data.event or "").upper()
        if event_upper == "ENTRY":
            data.trade_id = synth_entry_trade_id(data.ticker, data.side)
        else:
            # Look up the most recent OPEN/PARTIAL position on this ticker.
            # That's the trade these STOP_UPDATE / TPx / CLOSE events
            # belong to.
            active = (
                db.query(Position)
                .filter(
                    Position.ticker == data.ticker,
                    Position.status.in_(["OPEN", "PARTIAL", "PENDING"]),
                )
                .order_by(Position.updated_at.desc())
                .first()
            )
            if active is not None:
                data.trade_id = active.trade_id
    if not data.event_id and data.trade_id:
        data.event_id = synth_event_id(data.trade_id, data.event)

    # ---- Phase 1: duplicate protection (UNIQUE index on event_id) -------
    if data.event_id:
        existing = (
            db.query(WebhookSignal)
            .filter(WebhookSignal.event_id == data.event_id)
            .first()
        )
        if existing:
            return {
                "message": "duplicate ignored",
                "status": "duplicate_ignored",
                "id": existing.id,
                "event_id": existing.event_id,
                "trade_id": existing.trade_id,
                "event": existing.event,
                "ticker": existing.ticker,
            }

    # ---- Phase 1.1: fan-out to group members (opt-in) -------------------
    # When the webhook payload includes group=<name>, we look up that
    # group's active members and run execute_trade once per member — each
    # with its own trade_id suffix so their state machines don't collide.
    # Backward-compat: when group is None, we run the classic single-
    # position path below.
    if getattr(data, "group", None):
        group_obj = db.query(Group).filter(Group.name == data.group, Group.active.is_(True)).first()
        if not group_obj:
            raise HTTPException(status_code=404, detail=f"group '{data.group}' not found or inactive")

        # Phase 1.3: cascade. If the requested group is exhausted (no
        # active AND no benched to promote), follow next_group_id
        # recursively. When we cascade to a new group, auto-promote its
        # highest-priority benched members up to min_active_count so
        # the new group has someone to fire on. Cycle-guarded.
        def _active_count(g):
            return sum(
                1 for m in g.members
                if m.active and m.account and m.account.active
                and not m.account.paused
                and (m.account.state or "active") == "active"
            )
        def _benched_count(g):
            return sum(
                1 for m in g.members
                if m.active and m.account and m.account.active
                and (m.account.state or "active") == "benched"
            )
        cascade_chain = [group_obj.name]
        seen_ids = {group_obj.id}
        while _active_count(group_obj) == 0 and _benched_count(group_obj) == 0 and group_obj.next_group_id:
            nxt = db.query(Group).filter(Group.id == group_obj.next_group_id).first()
            if not nxt or nxt.id in seen_ids:
                break
            seen_ids.add(nxt.id)
            cascade_chain.append(nxt.name)
            nxt.active = True
            benched = sorted(
                [m for m in nxt.members
                 if m.active and m.account and m.account.active
                 and (m.account.state or "active") == "benched"],
                key=lambda x: (x.priority, x.id),
            )
            for m in benched[: (nxt.min_active_count or 1)]:
                m.account.state = "active"
                m.account.wins_cycle = 0
                m.account.losses_cycle = 0
                m.account.pnl_cycle = 0.0
            db.flush()
            group_obj = nxt

        # Only fan out to members whose account is in the "active" rotation
        # state. benched/cooled/stopped accounts are skipped — they get
        # promoted to active automatically when someone else rotates out.
        members = [
            m for m in group_obj.members
            if m.active
            and m.account
            and m.account.active
            and not m.account.paused
            and (m.account.state or "active") == "active"
        ]
        if not members:
            raise HTTPException(
                status_code=400,
                detail=f"group '{data.group}' has no active members (cascade tried: {' → '.join(cascade_chain)})",
            )

        leg_results: list[dict] = []
        base_trade_id = data.trade_id
        base_event_id = data.event_id
        base_qty = data.qty

        for m in sorted(members, key=lambda x: x.priority):
            acct = m.account
            # Effective size = base * account.multiplier * member.multiplier
            eff_qty = max(1, int(round(base_qty * (acct.multiplier or 1.0) * (m.multiplier or 1.0))))
            # Per-account trade_id + event_id so each leg's state machine is
            # independent. Same base id → easy to link legs on dashboard.
            leg_trade_id = f"{base_trade_id}#acc{acct.id}"
            leg_event_id = f"{base_event_id}#acc{acct.id}" if base_event_id else None

            # Build a per-leg signal by cloning payload + overriding fields.
            leg_payload = data.model_dump()
            leg_payload.update({
                "qty": eff_qty,
                "trade_id": leg_trade_id,
                "event_id": leg_event_id,
            })
            leg_signal = TradeEngineWebhook(**leg_payload)

            try:
                leg_result = execute_trade(leg_signal, db, account=acct, group_name=group_obj.name)
            except Exception as e:
                leg_result = {"status": "error", "action": "leg_failed", "error": str(e),
                              "account_id": acct.id, "account_name": acct.name}
            leg_result["account_id"] = acct.id
            leg_result["account_name"] = acct.name
            leg_result["leg_qty"] = eff_qty
            leg_result["leg_trade_id"] = leg_trade_id
            leg_results.append(leg_result)

        execution_result = {
            "status": "executed_fan_out",
            "action": "fan_out",
            "group": group_obj.name,
            "leg_count": len(leg_results),
            "legs": leg_results,
        }
    else:
        # ---- Phase 2: stateful execution (single-broker path) -----------
        # No group specified. Use the default broker from get_broker() and
        # spawn one Position row. This is the backward-compat path that
        # matches how the server behaved before Phase 1.1.
        execution_result = execute_trade(data, db)

    signal = WebhookSignal(
        event=data.event,
        ticker=data.ticker,
        side=data.side,
        qty=data.qty,
        key=data.key,
        trade_id=data.trade_id,
        event_id=data.event_id,
        raw_payload=json.dumps({
            "signal": data.model_dump(),
            "execution": execution_result
        })
    )

    db.add(signal)
    try:
        db.commit()
    except IntegrityError:
        # Race: two webhooks with same event_id (or same trade_id ENTRY)
        # arrived simultaneously. The unique index rejected the second one.
        db.rollback()
        existing = (
            db.query(WebhookSignal)
            .filter(WebhookSignal.event_id == data.event_id)
            .first()
            if data.event_id else None
        )
        return {
            "message": "duplicate ignored",
            "status": "duplicate_ignored",
            "id": existing.id if existing else None,
            "event_id": data.event_id,
            "trade_id": data.trade_id,
            "event": data.event,
            "ticker": data.ticker,
        }

    db.refresh(signal)

    # Tell the MD task about this symbol so it subscribes on next sweep.
    if signal.event == "ENTRY":
        _track_for_md(signal.ticker)

    # Push a notification to every connected dashboard so they re-fetch
    # without manual reload.
    ws_manager.broadcast_threadsafe({
        "type": "state_changed",
        "trigger": {
            "event": signal.event,
            "ticker": signal.ticker,
            "trade_id": signal.trade_id,
            "event_id": signal.event_id,
            "position_status": execution_result.get("position_status"),
            "action": execution_result.get("action"),
        },
    })

    return {
        "message": "webhook saved",
        "id": signal.id,
        "event": signal.event,
        "ticker": signal.ticker,
        "trade_id": signal.trade_id,
        "event_id": signal.event_id,
        "execution": execution_result,
    }


@app.get("/api/signals")
def list_signals(db: Session = Depends(get_db)):
    signals = db.query(WebhookSignal).order_by(WebhookSignal.id.desc()).limit(50).all()
    return [
        {
            "id": s.id,
            "event": s.event,
            "ticker": s.ticker,
            "side": s.side,
            "qty": s.qty,
            "trade_id": s.trade_id,
            "event_id": s.event_id,
            "created_at": s.created_at,
            "raw_payload": s.raw_payload,
        }
        for s in signals
    ]


def _position_to_dict(p: Position) -> dict:
    last = quote_store.last_price(p.ticker)
    return {
        "id": p.id,
        "trade_id": p.trade_id,
        "ticker": p.ticker,
        "side": p.side,
        "status": p.status,
        "qty_open": p.qty_open,
        "qty_total": p.qty_total,
        "entry_price": p.entry_price,
        "stop_price": p.stop_price,
        "stop_source": p.stop_source,
        "exit_reason": p.exit_reason,
        "tp1_px": p.tp1_px,
        "tp1_qty": p.tp1_qty,
        "tp2_px": p.tp2_px,
        "tp2_qty": p.tp2_qty,
        "tp3_px": p.tp3_px,
        "tp3_qty": p.tp3_qty,
        "runner_qty": p.runner_qty,
        "broker": p.broker,
        "broker_order_id": p.broker_order_id,
        "broker_stop_order_id": p.broker_stop_order_id,
        "avg_fill_price": p.avg_fill_price,
        "realized_pnl": p.realized_pnl,
        "broker_error": p.broker_error,
        # PnL trio:
        #   locked = if-stop-hits-now on qty_open
        #   live   = unrealized at current MD price (None if no quote)
        "locked_pnl": locked_pnl(p.side, p.qty_open, p.entry_price, p.stop_price, p.ticker),
        "live_pnl":   live_pnl(p.side, p.qty_open, p.entry_price, last, p.ticker),
        "last_price": last,
        "point_value": point_value(p.ticker),
        "created_at": p.created_at,
        "updated_at": p.updated_at,
    }


def _stop_update_to_dict(s: StopUpdate) -> dict:
    return {
        "id": s.id,
        "trade_id": s.trade_id,
        "ticker": s.ticker,
        "side": s.side,
        "old_stop": s.old_stop,
        "new_stop": s.new_stop,
        "source": s.source,
        "created_at": s.created_at,
    }


@app.get("/api/positions")
def list_positions(db: Session = Depends(get_db), status: Optional[str] = None):
    """
    Return positions. Optional ?status=OPEN|PARTIAL|CLOSED|CANCELLED|PENDING
    or ?status=active (PENDING+OPEN+PARTIAL) / closed (CLOSED+CANCELLED).
    """
    q = db.query(Position)
    if status:
        s = status.upper()
        if s == "ACTIVE":
            q = q.filter(Position.status.in_(["PENDING", "OPEN", "PARTIAL"]))
        elif s == "DONE":
            q = q.filter(Position.status.in_(["CLOSED", "CANCELLED"]))
        elif s in ("OPEN", "PARTIAL", "PENDING", "CLOSED", "CANCELLED"):
            q = q.filter(Position.status == s)
    positions = q.order_by(Position.updated_at.desc()).limit(200).all()
    return [_position_to_dict(p) for p in positions]


@app.get("/api/positions/{trade_id}")
def get_position(trade_id: str, db: Session = Depends(get_db)):
    p = db.query(Position).filter(Position.trade_id == trade_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="position not found")
    return _position_to_dict(p)


@app.get("/api/stop-updates")
def list_stop_updates(db: Session = Depends(get_db), trade_id: Optional[str] = None):
    """Real-time ledger of every STOP_UPDATE — BE / JUMP / TRAIL / RESYNC / MASTER / drag.
    Optional ?trade_id= to filter to one trade."""
    q = db.query(StopUpdate)
    if trade_id:
        q = q.filter(StopUpdate.trade_id == trade_id)
    rows = q.order_by(StopUpdate.id.desc()).limit(200).all()
    return [_stop_update_to_dict(r) for r in rows]


@app.get("/api/stop-updates/{trade_id}")
def list_stop_updates_for_trade(trade_id: str, db: Session = Depends(get_db)):
    rows = (
        db.query(StopUpdate)
        .filter(StopUpdate.trade_id == trade_id)
        .order_by(StopUpdate.id.asc())  # chronological for per-trade view
        .all()
    )
    return [_stop_update_to_dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Phase 1.1: Accounts + Groups admin API
# ---------------------------------------------------------------------------
# These endpoints manage the multi-account fan-out config. Auth is via
# the same USER_KEY env var used for the webhook — passed as a query
# param or header on admin requests. Simple bearer-token style so we
# don't need a full auth system for the personal-use phase.

def _admin_check(key: Optional[str]) -> None:
    expected = os.getenv("USER_KEY", "trading123")
    if key != expected:
        raise HTTPException(status_code=401, detail="Invalid admin key")


class AccountCreate(BaseModel):
    name: str
    broker: str                                        # one of BROKER_KINDS
    account_id: Optional[str] = None
    env: str = "demo"
    multiplier: float = 1.0
    daily_loss_limit: float = 0.0
    active: bool = True
    paused: bool = False
    config: Optional[dict] = None
    # Tasks #71 + #72 + #151: preflight-gate safety fields
    max_concurrent_positions: Optional[int] = 0
    max_trades_today: Optional[int] = 0
    time_windows: Optional[list] = None
    # Task #70: weekend auto-flat
    weekend_close_required: Optional[bool] = False


class AccountUpdate(BaseModel):
    name: Optional[str] = None
    account_id: Optional[str] = None
    env: Optional[str] = None
    multiplier: Optional[float] = None
    daily_loss_limit: Optional[float] = None
    active: Optional[bool] = None
    paused: Optional[bool] = None
    config: Optional[dict] = None
    # Phase 1.2: rotation state overrides (manual reset / promote / bench)
    state: Optional[str] = None                 # active | benched | cooled | stopped
    wins_cycle: Optional[int] = None            # allow manual reset to 0
    losses_cycle: Optional[int] = None
    pnl_cycle: Optional[float] = None
    # Tasks #71 + #72 + #151: preflight-gate safety fields
    max_concurrent_positions: Optional[int] = None
    max_trades_today: Optional[int] = None
    time_windows: Optional[list] = None
    # Task #70: weekend auto-flat
    weekend_close_required: Optional[bool] = None


class GroupCreate(BaseModel):
    name: str
    description: Optional[str] = None
    active: bool = True
    # Phase 1.2: rotation rules (all optional, null = disabled)
    rotate_after_wins: Optional[int] = None
    rotate_after_losses: Optional[int] = None
    rotate_after_profit: Optional[float] = None
    rotate_after_loss_pnl: Optional[float] = None
    min_active_count: int = 1
    # Phase 1.3: cascade — chain to another group when exhausted
    next_group_id: Optional[int] = None
    # Tasks #69 + #151 + #152: time windows for scheduling
    time_windows: Optional[list] = None
    schedule_label: Optional[str] = None


class GroupUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    active: Optional[bool] = None
    # Phase 1.2: rotation rules
    rotate_after_wins: Optional[int] = None
    rotate_after_losses: Optional[int] = None
    rotate_after_profit: Optional[float] = None
    rotate_after_loss_pnl: Optional[float] = None
    min_active_count: Optional[int] = None
    # Phase 1.3: cascade
    next_group_id: Optional[int] = None
    time_windows: Optional[list] = None
    schedule_label: Optional[str] = None
    # Allow clearing next_group_id via explicit null. Pydantic v2:
    # any None in the payload triggers the None default — so we treat
    # setting = null as "clear the FK" by checking the raw dict at PATCH time.


class GroupMemberCreate(BaseModel):
    account_id: int
    multiplier: float = 1.0
    priority: int = 0
    active: bool = True


class GroupMemberUpdate(BaseModel):
    multiplier: Optional[float] = None
    priority: Optional[int] = None
    active: Optional[bool] = None


def _account_to_dict(a: Account) -> dict:
    return {
        "id": a.id,
        "name": a.name,
        "broker": a.broker,
        "account_id": a.account_id,
        "env": a.env,
        "multiplier": a.multiplier,
        "daily_loss_limit": a.daily_loss_limit,
        "active": a.active,
        "paused": a.paused,
        "config": a.config,
        # Phase 1.2 rotation fields
        "state": getattr(a, "state", None),
        "wins_cycle": getattr(a, "wins_cycle", 0),
        "losses_cycle": getattr(a, "losses_cycle", 0),
        "wins_today": getattr(a, "wins_today", 0),
        "losses_today": getattr(a, "losses_today", 0),
        # Tasks #71 + #72 + #151: preflight-gate safety fields
        "max_concurrent_positions": getattr(a, "max_concurrent_positions", 0),
        "max_trades_today": getattr(a, "max_trades_today", 0),
        "time_windows": getattr(a, "time_windows", None) or [],
        "weekend_close_required": getattr(a, "weekend_close_required", False),
        "pnl_cycle": getattr(a, "pnl_cycle", 0.0),
        "pnl_today": getattr(a, "pnl_today", 0.0),
        "created_at": a.created_at,
        "updated_at": a.updated_at,
    }


def _group_to_dict(g: Group, include_members: bool = True) -> dict:
    out = {
        "id": g.id,
        "name": g.name,
        "description": g.description,
        "active": g.active,
        # Phase 1.2 rotation rules
        "rotate_after_wins": getattr(g, "rotate_after_wins", None),
        "rotate_after_losses": getattr(g, "rotate_after_losses", None),
        "rotate_after_profit": getattr(g, "rotate_after_profit", None),
        "rotate_after_loss_pnl": getattr(g, "rotate_after_loss_pnl", None),
        "min_active_count": getattr(g, "min_active_count", 1),
        # Phase 1.3 cascade
        "next_group_id": getattr(g, "next_group_id", None),
        # Tasks #69 + #151 + #152: time windows
        "time_windows": getattr(g, "time_windows", None) or [],
        "schedule_label": getattr(g, "schedule_label", None),
        "created_at": g.created_at,
        "updated_at": g.updated_at,
    }
    if include_members:
        out["members"] = [_gm_to_dict(m) for m in g.members]
    return out


def _gm_to_dict(m: GroupMember) -> dict:
    return {
        "id": m.id,
        "group_id": m.group_id,
        "account_id": m.account_id,
        "account_name": m.account.name if m.account else None,
        "multiplier": m.multiplier,
        "priority": m.priority,
        "active": m.active,
    }


@app.get("/api/accounts")
def list_accounts(db: Session = Depends(get_db)):
    """Public list — no admin key required, just don't expose secrets."""
    accounts = db.query(Account).order_by(Account.id.asc()).all()
    return [_account_to_dict(a) for a in accounts]


@app.post("/api/accounts")
def create_account(data: AccountCreate, key: str = "", db: Session = Depends(get_db)):
    _admin_check(key)
    if data.broker not in BROKER_KINDS:
        raise HTTPException(status_code=400, detail=f"broker must be one of {BROKER_KINDS}")
    a = Account(
        name=data.name,
        broker=data.broker,
        account_id=data.account_id,
        env=data.env,
        multiplier=data.multiplier,
        daily_loss_limit=data.daily_loss_limit,
        active=data.active,
        paused=data.paused,
        config=data.config,
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return _account_to_dict(a)


@app.patch("/api/accounts/{account_id}")
def update_account(account_id: int, data: AccountUpdate, key: str = "", db: Session = Depends(get_db)):
    _admin_check(key)
    a = db.query(Account).filter(Account.id == account_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="account not found")
    for field in ("name", "account_id", "env", "multiplier", "daily_loss_limit",
                   "active", "paused", "config",
                   # Phase 1.2 rotation overrides
                   "state", "wins_cycle", "losses_cycle", "pnl_cycle"):
        v = getattr(data, field, None)
        if v is not None:
            setattr(a, field, v)
    db.commit()
    db.refresh(a)
    return _account_to_dict(a)


@app.delete("/api/accounts/{account_id}")
def delete_account(account_id: int, key: str = "", db: Session = Depends(get_db)):
    _admin_check(key)
    a = db.query(Account).filter(Account.id == account_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="account not found")
    db.delete(a)
    db.commit()
    return {"deleted": True, "id": account_id}


@app.get("/api/groups")
def list_groups(db: Session = Depends(get_db)):
    groups = db.query(Group).order_by(Group.id.asc()).all()
    return [_group_to_dict(g) for g in groups]


@app.post("/api/groups")
def create_group(data: GroupCreate, key: str = "", db: Session = Depends(get_db)):
    _admin_check(key)
    if db.query(Group).filter(Group.name == data.name).first():
        raise HTTPException(status_code=409, detail=f"group '{data.name}' already exists")
    g = Group(
        name=data.name,
        description=data.description,
        active=data.active,
        rotate_after_wins=data.rotate_after_wins,
        rotate_after_losses=data.rotate_after_losses,
        rotate_after_profit=data.rotate_after_profit,
        rotate_after_loss_pnl=data.rotate_after_loss_pnl,
        min_active_count=data.min_active_count,
        next_group_id=data.next_group_id,
    )
    db.add(g)
    db.commit()
    db.refresh(g)
    return _group_to_dict(g)


@app.patch("/api/groups/{group_id}")
def update_group(group_id: int, data: GroupUpdate, key: str = "", db: Session = Depends(get_db)):
    _admin_check(key)
    g = db.query(Group).filter(Group.id == group_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="group not found")
    for field in (
        "name", "description", "active",
        # Phase 1.2 rotation rules
        "rotate_after_wins", "rotate_after_losses",
        "rotate_after_profit", "rotate_after_loss_pnl",
        "min_active_count",
        # Phase 1.3 cascade
        "next_group_id",
        # Tasks #69 + #151 + #152: time windows
        "time_windows", "schedule_label",
    ):
        v = getattr(data, field, None)
        if v is not None:
            setattr(g, field, v)
    db.commit()
    db.refresh(g)
    return _group_to_dict(g)


@app.delete("/api/groups/{group_id}")
def delete_group(group_id: int, key: str = "", db: Session = Depends(get_db)):
    _admin_check(key)
    g = db.query(Group).filter(Group.id == group_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="group not found")
    db.delete(g)
    db.commit()
    return {"deleted": True, "id": group_id}


@app.post("/api/groups/{group_id}/members")
def add_group_member(group_id: int, data: GroupMemberCreate, key: str = "", db: Session = Depends(get_db)):
    _admin_check(key)
    g = db.query(Group).filter(Group.id == group_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="group not found")
    a = db.query(Account).filter(Account.id == data.account_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="account not found")
    # Enforce unique (group_id, account_id) pair
    existing = (
        db.query(GroupMember)
        .filter(GroupMember.group_id == group_id, GroupMember.account_id == data.account_id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="account already in this group")
    m = GroupMember(
        group_id=group_id,
        account_id=data.account_id,
        multiplier=data.multiplier,
        priority=data.priority,
        active=data.active,
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return _gm_to_dict(m)


@app.patch("/api/groups/{group_id}/members/{member_id}")
def update_group_member(group_id: int, member_id: int, data: GroupMemberUpdate,
                        key: str = "", db: Session = Depends(get_db)):
    _admin_check(key)
    m = db.query(GroupMember).filter(GroupMember.id == member_id, GroupMember.group_id == group_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="member not found")
    for field in ("multiplier", "priority", "active"):
        v = getattr(data, field)
        if v is not None:
            setattr(m, field, v)
    db.commit()
    db.refresh(m)
    return _gm_to_dict(m)


@app.delete("/api/groups/{group_id}/members/{member_id}")
def delete_group_member(group_id: int, member_id: int, key: str = "", db: Session = Depends(get_db)):
    _admin_check(key)
    m = db.query(GroupMember).filter(GroupMember.id == member_id, GroupMember.group_id == group_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="member not found")
    db.delete(m)
    db.commit()
    return {"deleted": True, "id": member_id}


# ---------------------------------------------------------------------------
# Phase 2.1 — Base44 entity endpoints (Strategy / Alert / Trades / Analytics /
# Upload / User). Powers the React frontend at frontend/src.
# ---------------------------------------------------------------------------

# ----- Strategy CRUD -------------------------------------------------------

class StrategyIn(BaseModel):
    name: str
    description: Optional[str] = None
    rules: Optional[str] = None
    timeframe: Optional[str] = "15m"
    preferred_session: Optional[str] = None
    preferred_pairs: Optional[list] = None
    win_rate: Optional[float] = 0.0
    total_trades: Optional[int] = 0
    total_profit: Optional[float] = 0.0
    is_active: Optional[bool] = True
    # Task #119: webhook binding — server auto-generates if not provided
    webhook_slug: Optional[str] = None
    webhook_key: Optional[str] = None
    default_group_id: Optional[int] = None
    # Task #127: alert JSON + broker format
    broker_format: Optional[str] = "futures"
    alert_json_template: Optional[str] = None
    alert_description: Optional[str] = None


class StrategyPatch(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    rules: Optional[str] = None
    timeframe: Optional[str] = None
    preferred_session: Optional[str] = None
    preferred_pairs: Optional[list] = None
    win_rate: Optional[float] = None
    total_trades: Optional[int] = None
    total_profit: Optional[float] = None
    is_active: Optional[bool] = None
    webhook_slug: Optional[str] = None
    webhook_key: Optional[str] = None
    default_group_id: Optional[int] = None
    broker_format: Optional[str] = None
    alert_json_template: Optional[str] = None
    alert_description: Optional[str] = None


# Task #127: pre-canned alert JSON templates per broker format + event.
# Rendered on demand via /api/strategies/{id}/alert-templates so the
# Strategies page can show a "Copy JSON" button. {{placeholders}} get
# replaced with strategy-specific values at render time.

def _webhook_url_for(slug: str) -> str:
    base = (os.getenv("RAILWAY_PUBLIC_DOMAIN") or "").rstrip("/")
    if base and not base.startswith("http"):
        base = f"https://{base}"
    return f"{base}/api/webhook/strategy/{slug}" if base else f"/api/webhook/strategy/{slug}"


def _alert_templates(strategy: Strategy) -> dict:
    """Return { event_type: { url, json_body, description } } for the
    strategy's broker_format. Each entry is ready to paste into a
    TradingView alert."""
    slug = strategy.webhook_slug or "STRATEGY_SLUG"
    key = strategy.webhook_key or "STRATEGY_KEY"
    fmt = (strategy.broker_format or "futures").lower()
    url = _webhook_url_for(slug)

    # Common fields across all formats
    common = {"key": key, "strategy": strategy.name}

    if fmt in ("futures", "tradovate"):
        # Futures — Tradovate/Rithmic. qty is CONTRACTS.
        return {
            "ENTRY": {
                "url": url, "method": "POST",
                "description": f"Open a new {fmt} position. qty = contracts. Fires from Pine on setup.",
                "json_body": {
                    **common, "event": "ENTRY",
                    "ticker": "{{ticker}}", "side": "{{strategy.order.action}}",
                    "qty": 1,
                    "entry_px": "{{close}}",
                    "stop_px": "{{plot('stop')}}",
                    "tp1_px": "{{plot('tp1')}}", "tp1_qty": 1,
                    "trade_id": f"{slug}-{{{{time}}}}-{{{{strategy.order.action}}}}",
                },
            },
            "STOP_UPDATE": {
                "url": url, "method": "POST",
                "description": "Move the stop loss on the open position (BE / trail / jump).",
                "json_body": {
                    **common, "event": "STOP_UPDATE",
                    "ticker": "{{ticker}}", "stop_px": "{{plot('stop')}}",
                    "stop_source": "TRAIL",
                    "trade_id": "{{plot('trade_id')}}",
                },
            },
            "FLAT": {
                "url": url, "method": "POST",
                "description": "Close the entire position (STOP_HIT / MASTER_CLOSE / manual FLAT).",
                "json_body": {
                    **common, "event": "FLAT",
                    "ticker": "{{ticker}}",
                    "trade_id": "{{plot('trade_id')}}",
                },
            },
        }

    elif fmt in ("mt5", "mt4", "forex"):
        # MT4/5 or forex — volume in LOTS (0.01 = micro, 0.1 = mini, 1.0 = standard)
        return {
            "ENTRY": {
                "url": url, "method": "POST",
                "description": f"Open a new {fmt} position. volume in lots (0.01 micro / 0.1 mini / 1.0 std).",
                "json_body": {
                    **common, "event": "ENTRY",
                    "ticker": "{{ticker}}", "side": "{{strategy.order.action}}",
                    "volume": 0.10,
                    "entry_px": "{{close}}",
                    "stop_px": "{{plot('stop')}}",
                    "tp1_px": "{{plot('tp1')}}",
                    "trade_id": f"{slug}-{{{{time}}}}-{{{{strategy.order.action}}}}",
                    "broker_format": fmt,
                },
            },
            "STOP_UPDATE": {
                "url": url, "method": "POST",
                "description": "Move the stop loss on the open MT4/5 order.",
                "json_body": {
                    **common, "event": "STOP_UPDATE",
                    "ticker": "{{ticker}}", "stop_px": "{{plot('stop')}}",
                    "trade_id": "{{plot('trade_id')}}",
                    "broker_format": fmt,
                },
            },
            "FLAT": {
                "url": url, "method": "POST",
                "description": "Close the MT4/5 order.",
                "json_body": {
                    **common, "event": "FLAT",
                    "ticker": "{{ticker}}",
                    "trade_id": "{{plot('trade_id')}}",
                    "broker_format": fmt,
                },
            },
        }

    elif fmt in ("stocks", "alpaca", "ibkr"):
        # Stocks / equities — qty in SHARES
        return {
            "ENTRY": {
                "url": url, "method": "POST",
                "description": "Open a stock position. qty = shares.",
                "json_body": {
                    **common, "event": "ENTRY",
                    "ticker": "{{ticker}}", "side": "{{strategy.order.action}}",
                    "qty": 100,
                    "entry_px": "{{close}}",
                    "stop_px": "{{plot('stop')}}",
                    "trade_id": f"{slug}-{{{{time}}}}-{{{{strategy.order.action}}}}",
                    "broker_format": fmt,
                },
            },
            "FLAT": {
                "url": url, "method": "POST",
                "description": "Close the stock position (sell shares).",
                "json_body": {
                    **common, "event": "FLAT",
                    "ticker": "{{ticker}}",
                    "trade_id": "{{plot('trade_id')}}",
                    "broker_format": fmt,
                },
            },
        }

    # Default fallback = generic Trade Engine shape
    return {
        "ENTRY": {
            "url": url, "method": "POST",
            "description": "Generic entry. qty semantics depend on broker adapter.",
            "json_body": {
                **common, "event": "ENTRY",
                "ticker": "{{ticker}}", "side": "{{strategy.order.action}}", "qty": 1,
                "trade_id": f"{slug}-{{{{time}}}}-{{{{strategy.order.action}}}}",
            },
        },
    }


def _slugify(text: str) -> str:
    """Turn a strategy name into a URL-safe slug for the webhook URL.
    'Freeballin 6.24 base' → 'freeballin-6-24-base'"""
    import re
    s = (text or "").lower().strip()
    s = re.sub(r'[^a-z0-9]+', '-', s)
    s = re.sub(r'-+', '-', s).strip('-')
    return s or "strategy"


def _strategy_to_dict(s: Strategy, request_base_url: str = "") -> dict:
    d = {
        "id": s.id, "name": s.name, "description": s.description, "rules": s.rules,
        "timeframe": s.timeframe, "preferred_session": s.preferred_session,
        "preferred_pairs": s.preferred_pairs, "win_rate": s.win_rate,
        "total_trades": s.total_trades, "total_profit": s.total_profit,
        "is_active": s.is_active,
        "webhook_slug": getattr(s, "webhook_slug", None),
        "webhook_key": getattr(s, "webhook_key", None),
        "default_group_id": getattr(s, "default_group_id", None),
        "broker_format": getattr(s, "broker_format", "futures") or "futures",
        "alert_json_template": getattr(s, "alert_json_template", None),
        "alert_description": getattr(s, "alert_description", None),
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }
    # Convenience: full webhook URL + auto-generated templates the trader
    # can paste into TradingView.
    if d["webhook_slug"]:
        d["webhook_url"] = _webhook_url_for(d["webhook_slug"])
        d["alert_templates"] = _alert_templates(s)
    return d


@app.get("/api/strategies/{sid}/alert-templates")
def strategy_alert_templates(sid: int, db: Session = Depends(get_db)):
    """Return pre-canned TradingView alert JSON blocks for the strategy's
    broker_format (futures/mt5/forex/stocks). One entry per event type
    (ENTRY/STOP_UPDATE/FLAT). Frontend renders 'Copy' buttons for each.
    Switching broker_format on the strategy changes the templates —
    useful for moving the same Pine indicator from a Tradovate futures
    prop firm to an MT5 forex prop firm without editing Pine."""
    s = db.query(Strategy).filter(Strategy.id == sid).first()
    if not s: raise HTTPException(status_code=404, detail="strategy not found")
    return {
        "strategy": {"id": s.id, "name": s.name, "broker_format": s.broker_format or "futures"},
        "webhook_url": _webhook_url_for(s.webhook_slug or ""),
        "templates": _alert_templates(s),
    }


@app.get("/api/strategies")
def list_strategies(db: Session = Depends(get_db)):
    return [_strategy_to_dict(s) for s in db.query(Strategy).order_by(Strategy.id).all()]


@app.post("/api/strategies")
def create_strategy(data: StrategyIn, key: str = "", db: Session = Depends(get_db)):
    _admin_check(key)
    payload = data.dict(exclude_unset=True)
    # Auto-generate webhook_slug + webhook_key if not provided
    if not payload.get("webhook_slug"):
        base_slug = _slugify(payload.get("name", "strategy"))
        # Ensure uniqueness — append suffix if collision
        slug = base_slug
        n = 1
        while db.query(Strategy).filter(Strategy.webhook_slug == slug).first():
            n += 1
            slug = f"{base_slug}-{n}"
        payload["webhook_slug"] = slug
    if not payload.get("webhook_key"):
        payload["webhook_key"] = _uuid.uuid4().hex
    s = Strategy(**payload)
    db.add(s); db.commit(); db.refresh(s)
    return _strategy_to_dict(s)


@app.get("/api/strategies/{sid}")
def get_strategy(sid: int, db: Session = Depends(get_db)):
    s = db.query(Strategy).filter(Strategy.id == sid).first()
    if not s: raise HTTPException(status_code=404, detail="strategy not found")
    return _strategy_to_dict(s)


@app.patch("/api/strategies/{sid}")
def update_strategy(sid: int, data: StrategyPatch, key: str = "", db: Session = Depends(get_db)):
    _admin_check(key)
    s = db.query(Strategy).filter(Strategy.id == sid).first()
    if not s: raise HTTPException(status_code=404, detail="strategy not found")
    for k, v in data.dict(exclude_unset=True).items():
        setattr(s, k, v)
    db.commit(); db.refresh(s)
    return _strategy_to_dict(s)


@app.delete("/api/strategies/{sid}")
def delete_strategy(sid: int, key: str = "", db: Session = Depends(get_db)):
    _admin_check(key)
    s = db.query(Strategy).filter(Strategy.id == sid).first()
    if not s: raise HTTPException(status_code=404, detail="strategy not found")
    db.delete(s); db.commit()
    return {"deleted": True, "id": sid}


# ----- TradeAlert CRUD -----------------------------------------------------

class AlertIn(BaseModel):
    symbol: str
    alert_type: str
    target_price: Optional[float] = None
    message: Optional[str] = None
    notify_sound: Optional[bool] = True
    notify_email: Optional[bool] = False
    is_active: Optional[bool] = True


class AlertPatch(BaseModel):
    symbol: Optional[str] = None
    alert_type: Optional[str] = None
    target_price: Optional[float] = None
    message: Optional[str] = None
    is_triggered: Optional[bool] = None
    notify_sound: Optional[bool] = None
    notify_email: Optional[bool] = None
    is_active: Optional[bool] = None


def _alert_to_dict(a: TradeAlert) -> dict:
    return {
        "id": a.id, "symbol": a.symbol, "alert_type": a.alert_type,
        "target_price": a.target_price, "message": a.message,
        "is_triggered": a.is_triggered,
        "triggered_at": a.triggered_at.isoformat() if a.triggered_at else None,
        "notify_sound": a.notify_sound, "notify_email": a.notify_email,
        "is_active": a.is_active,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


@app.get("/api/alerts")
def list_alerts(db: Session = Depends(get_db)):
    return [_alert_to_dict(a) for a in db.query(TradeAlert).order_by(TradeAlert.id.desc()).all()]


@app.post("/api/alerts")
def create_alert(data: AlertIn, key: str = "", db: Session = Depends(get_db)):
    _admin_check(key)
    a = TradeAlert(**data.dict(exclude_unset=True))
    db.add(a); db.commit(); db.refresh(a)
    return _alert_to_dict(a)


@app.patch("/api/alerts/{aid}")
def update_alert(aid: int, data: AlertPatch, key: str = "", db: Session = Depends(get_db)):
    _admin_check(key)
    a = db.query(TradeAlert).filter(TradeAlert.id == aid).first()
    if not a: raise HTTPException(status_code=404, detail="alert not found")
    for k, v in data.dict(exclude_unset=True).items():
        setattr(a, k, v)
    db.commit(); db.refresh(a)
    return _alert_to_dict(a)


@app.delete("/api/alerts/{aid}")
def delete_alert(aid: int, key: str = "", db: Session = Depends(get_db)):
    _admin_check(key)
    a = db.query(TradeAlert).filter(TradeAlert.id == aid).first()
    if not a: raise HTTPException(status_code=404, detail="alert not found")
    db.delete(a); db.commit()
    return {"deleted": True, "id": aid}


# ----- Trades = Positions in Base44 shape ----------------------------------
# The React NewTrade form and Trades page speak the Base44 Trade schema.
# Under the hood we store rows in the same `positions` table — those new
# columns (direction/session/pips/etc.) came in via the Phase 2.1b migration.

class TradeIn(BaseModel):
    account_id: Optional[int] = None
    symbol: str
    direction: str = "long"      # long / short
    entry_price: float
    exit_price: Optional[float] = None
    stop_loss: Optional[float] = None
    take_profit_1: Optional[float] = None
    take_profit_2: Optional[float] = None
    take_profit_3: Optional[float] = None
    lot_size: Optional[float] = None
    risk_percentage: Optional[float] = None
    risk_amount: Optional[float] = None
    profit_loss: Optional[float] = None
    pips: Optional[float] = None
    entry_time: Optional[str] = None
    exit_time: Optional[str] = None
    session: Optional[str] = None
    strategy_id: Optional[int] = None
    trailing_stop_used: Optional[bool] = False
    trailing_stop_distance: Optional[float] = None
    status: Optional[str] = "CLOSED"
    notes: Optional[str] = None
    screenshot_url: Optional[str] = None


def _trade_to_dict(p: Position) -> dict:
    """Position row → Base44 Trade shape (what the React pages expect)."""
    return {
        "id": p.id,
        "trade_id": p.trade_id,
        "account_id": p.account_id,
        "symbol": p.ticker,
        "direction": (p.direction or ("long" if (p.side or "").upper() == "LONG" else "short")),
        "entry_price": p.entry_price,
        "exit_price": p.avg_fill_price if p.status == "CLOSED" else None,
        "stop_loss": p.stop_price,
        "take_profit_1": p.tp1_px, "take_profit_2": p.tp2_px, "take_profit_3": p.tp3_px,
        "lot_size": p.lot_size,
        "risk_percentage": p.risk_percentage,
        "risk_amount": p.risk_amount,
        "profit_loss": p.realized_pnl,
        "pips": p.pips,
        "entry_time": p.entry_time.isoformat() if p.entry_time else (p.created_at.isoformat() if p.created_at else None),
        "exit_time": p.exit_time.isoformat() if p.exit_time else None,
        "session": p.session,
        "strategy_id": p.strategy_id,
        "trailing_stop_used": p.trailing_stop_used,
        "trailing_stop_distance": p.trailing_stop_distance,
        "status": (p.status or "").lower() if p.status else "closed",
        "notes": p.notes,
        "screenshot_url": p.screenshot_url,
        "group_name": p.group_name,
        "broker": p.broker,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


@app.get("/api/trades")
def list_trades(limit: int = 200, db: Session = Depends(get_db)):
    q = db.query(Position).order_by(Position.id.desc()).limit(limit).all()
    return [_trade_to_dict(p) for p in q]


@app.post("/api/trades")
def create_trade(data: TradeIn, key: str = "", db: Session = Depends(get_db)):
    _admin_check(key)
    # Generate a synthetic trade_id for manual entries so the unique constraint
    # holds. Manual entries prefix with MAN- so they're distinguishable in logs.
    trade_id = f"MAN-{_uuid.uuid4().hex[:12]}"
    entry_time = None
    exit_time = None
    if data.entry_time:
        try: entry_time = datetime.fromisoformat(data.entry_time.replace("Z", "+00:00"))
        except Exception: pass
    if data.exit_time:
        try: exit_time = datetime.fromisoformat(data.exit_time.replace("Z", "+00:00"))
        except Exception: pass

    side = "LONG" if (data.direction or "long").lower() == "long" else "SHORT"
    qty = int(data.lot_size or 1)
    p = Position(
        trade_id=trade_id, ticker=data.symbol, side=side, direction=data.direction,
        qty_total=qty, qty_open=qty if not data.exit_price else 0,
        entry_price=data.entry_price, stop_price=data.stop_loss,
        tp1_px=data.take_profit_1, tp2_px=data.take_profit_2, tp3_px=data.take_profit_3,
        status=(data.status or "CLOSED").upper(),
        account_id=data.account_id, strategy_id=data.strategy_id,
        lot_size=data.lot_size, risk_percentage=data.risk_percentage,
        risk_amount=data.risk_amount, realized_pnl=data.profit_loss,
        pips=data.pips, session=data.session, entry_time=entry_time, exit_time=exit_time,
        trailing_stop_used=data.trailing_stop_used or False,
        trailing_stop_distance=data.trailing_stop_distance,
        notes=data.notes, screenshot_url=data.screenshot_url,
        avg_fill_price=data.exit_price, broker="manual",
    )
    db.add(p); db.commit(); db.refresh(p)
    return _trade_to_dict(p)


@app.patch("/api/trades/{tid}")
def update_trade(tid: int, data: TradeIn, key: str = "", db: Session = Depends(get_db)):
    _admin_check(key)
    p = db.query(Position).filter(Position.id == tid).first()
    if not p: raise HTTPException(status_code=404, detail="trade not found")
    # Only fields explicitly set get updated
    payload = data.dict(exclude_unset=True)
    for k, v in payload.items():
        if k == "symbol": p.ticker = v
        elif k in ("entry_time", "exit_time") and v:
            try: setattr(p, k, datetime.fromisoformat(v.replace("Z", "+00:00")))
            except Exception: pass
        elif k == "profit_loss": p.realized_pnl = v
        elif k == "exit_price": p.avg_fill_price = v
        elif k == "stop_loss": p.stop_price = v
        elif k == "take_profit_1": p.tp1_px = v
        elif k == "take_profit_2": p.tp2_px = v
        elif k == "take_profit_3": p.tp3_px = v
        elif k == "status" and v: p.status = v.upper()
        elif hasattr(p, k): setattr(p, k, v)
    db.commit(); db.refresh(p)
    return _trade_to_dict(p)


@app.delete("/api/trades/{tid}")
def delete_trade(tid: int, key: str = "", db: Session = Depends(get_db)):
    _admin_check(key)
    p = db.query(Position).filter(Position.id == tid).first()
    if not p: raise HTTPException(status_code=404, detail="trade not found")
    db.delete(p); db.commit()
    return {"deleted": True, "id": tid}


# ----- Task #162: Trade Timeline -------------------------------------------

@app.get("/api/trades/{tid}/timeline")
def trade_timeline(tid: int, db: Session = Depends(get_db)):
    """Per-trade lifecycle events merged + sorted. Answers 'what actually happened
    in this trade?' — entry → PMT ack → TP hits → SL moves → close."""
    import json as _json

    p = db.query(Position).filter(Position.id == tid).first()
    if not p:
        raise HTTPException(status_code=404, detail="trade not found")

    trade_id = p.trade_id
    events = []

    # (1) WebhookSignal events for this trade — entry, TP hits, close, etc.
    signals = (
        db.query(WebhookSignal)
        .filter(WebhookSignal.trade_id == trade_id)
        .order_by(WebhookSignal.created_at.asc())
        .all()
    )
    for s in signals:
        detail = ""
        # Try to pull useful fields out of the raw payload
        try:
            payload = _json.loads(s.raw_payload) if s.raw_payload else {}
        except Exception:
            payload = {}

        etype = (s.event or "").upper()
        # Human labels + tones
        LABELS = {
            "ENTRY":         ("Entry filled",     "blue"),
            "TP1":           ("TP1 hit",          "green"),
            "TP2":           ("TP2 hit",          "green"),
            "TP3":           ("TP3 hit",          "green"),
            "STOP_HIT":      ("Stop hit",         "red"),
            "STOP_UPDATE":   ("Stop update",      "amber"),
            "MASTER_CLOSE":  ("Master close",     "red"),
            "EMA_EXIT":      ("EMA exit",         "red"),
            "CLOSE50":       ("Close 50%",        "amber"),
            "CLOSE_FALLBACK":("Close (fallback)", "red"),
            "ALL_TPS":       ("All TPs filled",   "green"),
            "TEST":          ("Test webhook",     "muted"),
        }
        label, tone = LABELS.get(etype, (etype.title() or "Event", "muted"))

        # Extract common fields from the payload
        px = payload.get("entry_px") or payload.get("stop_px") or payload.get("close_qty_price")
        qty = payload.get("close_qty") or payload.get("qty") or s.qty
        if etype == "ENTRY":
            e = payload.get("entry_px")
            st = payload.get("stop_px")
            parts = []
            if e is not None: parts.append(f"@ {e}")
            if s.qty: parts.append(f"{s.qty}ct")
            if st is not None: parts.append(f"stop {st}")
            detail = " · ".join(parts)
        elif etype in ("TP1", "TP2", "TP3"):
            cq = payload.get("close_qty")
            rem = payload.get("remaining_qty")
            parts = []
            if cq: parts.append(f"banked {cq}ct")
            if rem is not None: parts.append(f"remain {rem}ct")
            detail = " · ".join(parts)
        elif etype in ("STOP_HIT", "MASTER_CLOSE", "EMA_EXIT", "CLOSE_FALLBACK"):
            cq = payload.get("close_qty")
            parts = []
            if cq: parts.append(f"closed {cq}ct")
            detail = " · ".join(parts)
        elif etype == "CLOSE50":
            cq = payload.get("close_qty")
            rem = payload.get("remaining_qty")
            parts = []
            if cq: parts.append(f"closed {cq}ct")
            if rem is not None: parts.append(f"remain {rem}ct")
            detail = " · ".join(parts)

        events.append({
            "ts": s.created_at.isoformat() if s.created_at else None,
            "type": etype,
            "label": label,
            "tone": tone,
            "detail": detail,
            "source": "webhook",
        })

    # (2) StopUpdate rows for this trade — every SL move
    stops = (
        db.query(StopUpdate)
        .filter(StopUpdate.trade_id == trade_id)
        .order_by(StopUpdate.created_at.asc())
        .all()
    )
    for u in stops:
        # Skip the very first "initial" stop — matches ENTRY
        label = "Stop moved"
        src = (u.source or "").upper()
        # Tone by source
        tone = "amber"
        if src.startswith("BE"):
            label = "Stop → BE"
            tone = "blue"
        elif src.startswith("JUMP"):
            label = f"Stop → {src}"
            tone = "green"
        elif src == "CREEP":
            label = "Stop creep"
            tone = "green"
        elif src in ("SWING", "TICKS", "EMA+ATR"):
            label = f"Trail ({src})"
            tone = "amber"
        elif src == "MASTER":
            label = "Stop → Master"
            tone = "red"
        elif src == "RESYNC":
            label = "Stop resync"
            tone = "muted"

        detail_parts = []
        if u.old_stop is not None and u.new_stop is not None:
            detail_parts.append(f"{u.old_stop:g} → {u.new_stop:g}")
        elif u.new_stop is not None:
            detail_parts.append(f"→ {u.new_stop:g}")
        detail = " · ".join(detail_parts)

        events.append({
            "ts": u.created_at.isoformat() if u.created_at else None,
            "type": "STOP_UPDATE",
            "label": label,
            "tone": tone,
            "detail": detail,
            "source": u.source or "STOP",
        })

    # (3) Sort merged events chronologically. Fall back to zero-string for unknown.
    events.sort(key=lambda e: e["ts"] or "")

    return {
        "trade_id": trade_id,
        "symbol": p.ticker,
        "side": p.side,
        "qty_total": p.qty_total,
        "qty_open": p.qty_open,
        "entry_price": p.entry_price,
        "current_stop": p.stop_price,
        "status": p.status,
        "exit_reason": p.exit_reason,
        "entry_time": p.entry_time.isoformat() if p.entry_time else None,
        "exit_time": p.exit_time.isoformat() if p.exit_time else None,
        "events": events,
    }


# ----- Analytics -----------------------------------------------------------

@app.get("/api/analytics")
def analytics(account_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Win rate, session breakdown, equity curve + task #87 advanced
    ratios (Sharpe, Sortino, Calmar, Kelly)."""
    q = db.query(Position).filter(Position.status == "CLOSED")
    if account_id:
        q = q.filter(Position.account_id == account_id)
    q = q.filter(Position.realized_pnl.isnot(None))
    q = q.order_by(Position.created_at.asc())
    rows = q.all()

    if not rows:
        return {"total_trades": 0, "win_rate": 0, "net_profit": 0,
                "profit_factor": 0, "expectancy": 0, "avg_win": 0, "avg_loss": 0,
                "equity_curve": [], "session_breakdown": {},
                "sharpe": 0, "sortino": 0, "calmar": 0, "kelly_pct": 0,
                "max_drawdown": 0, "current_streak": 0, "longest_win_streak": 0,
                "longest_loss_streak": 0,
                "today_pnl": 0, "today_wins": 0, "today_losses": 0, "today_win_rate": 0,
                "week_pnl": 0, "week_wins": 0, "week_losses": 0, "week_win_rate": 0}

    wins = [p for p in rows if (p.realized_pnl or 0) > 0]
    losses = [p for p in rows if (p.realized_pnl or 0) < 0]
    total_win = sum(p.realized_pnl or 0 for p in wins)
    total_loss = sum(p.realized_pnl or 0 for p in losses)
    total = len(rows)
    win_rate = len(wins) / total * 100 if total else 0
    net_profit = total_win + total_loss
    profit_factor = abs(total_win / total_loss) if total_loss else float("inf")
    avg_win = total_win / len(wins) if wins else 0
    avg_loss = abs(total_loss / len(losses)) if losses else 0
    expectancy = (win_rate / 100 * avg_win) - ((100 - win_rate) / 100 * avg_loss)

    equity = 0
    equity_curve = []
    peak = 0
    max_dd = 0
    for i, p in enumerate(rows):
        equity += p.realized_pnl or 0
        peak = max(peak, equity)
        dd = peak - equity
        max_dd = max(max_dd, dd)
        equity_curve.append({"name": f"Trade {i+1}", "equity": round(equity, 2)})

    session_breakdown = {}
    for p in rows:
        s = p.session or "unknown"
        session_breakdown.setdefault(s, {"profit": 0, "count": 0})
        session_breakdown[s]["profit"] += p.realized_pnl or 0
        session_breakdown[s]["count"] += 1

    # Task #87: Advanced performance ratios
    pnls = [p.realized_pnl or 0 for p in rows]
    n = len(pnls)
    mean_r = sum(pnls) / n if n else 0
    # Sharpe = mean / stddev (per trade — no risk-free adjustment)
    var = sum((r - mean_r) ** 2 for r in pnls) / n if n else 0
    std = var ** 0.5
    sharpe = (mean_r / std) if std > 0 else 0
    # Sortino = mean / downside stddev
    downside = [r for r in pnls if r < 0]
    d_var = sum(r ** 2 for r in downside) / n if n else 0
    d_std = d_var ** 0.5
    sortino = (mean_r / d_std) if d_std > 0 else 0
    # Calmar = net_profit / max_drawdown
    calmar = (net_profit / max_dd) if max_dd > 0 else 0
    # Kelly criterion — optimal position % of capital
    # f* = W - (1-W)/R  where W=win_rate as decimal, R=avg_win/avg_loss
    kelly = 0
    if avg_loss > 0:
        w = win_rate / 100
        r = avg_win / avg_loss
        kelly = w - (1 - w) / r if r > 0 else 0
        kelly = max(0, min(1, kelly))  # clamp to [0, 1]

    # Task #78: streak tracking
    current_streak = 0
    longest_win_streak = 0
    longest_loss_streak = 0
    win_streak = 0
    loss_streak = 0
    last_verdict = None
    for p in rows:
        pnl = p.realized_pnl or 0
        v = "W" if pnl > 0 else "L" if pnl < 0 else "N"
        if v == "W":
            win_streak += 1; loss_streak = 0
            longest_win_streak = max(longest_win_streak, win_streak)
        elif v == "L":
            loss_streak += 1; win_streak = 0
            longest_loss_streak = max(longest_loss_streak, loss_streak)
        last_verdict = v
    if last_verdict == "W":
        current_streak = win_streak       # positive number = win streak
    elif last_verdict == "L":
        current_streak = -loss_streak     # negative = loss streak

    # Task #159: today + week cuts for the ops panel
    # Uses UTC boundary — matches midnight_reset_loop() convention.
    now_utc = datetime.now(timezone.utc)
    today_start = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=now_utc.weekday())  # Monday 00:00 UTC
    def _bucket(rows_):
        pnl = sum(r.realized_pnl or 0 for r in rows_)
        w = sum(1 for r in rows_ if (r.realized_pnl or 0) > 0)
        l = sum(1 for r in rows_ if (r.realized_pnl or 0) < 0)
        rate = round(w / (w + l) * 100, 2) if (w + l) else 0
        return pnl, w, l, rate
    today_rows = [r for r in rows if r.exit_time and r.exit_time >= today_start]
    week_rows = [r for r in rows if r.exit_time and r.exit_time >= week_start]
    # Fallback to created_at when exit_time is missing (legacy rows)
    if not today_rows:
        today_rows = [r for r in rows if r.created_at and r.created_at >= today_start]
    if not week_rows:
        week_rows = [r for r in rows if r.created_at and r.created_at >= week_start]
    today_pnl, today_w, today_l, today_rate = _bucket(today_rows)
    week_pnl, week_w, week_l, week_rate = _bucket(week_rows)

    return {
        "total_trades": total,
        "win_rate": round(win_rate, 2),
        "net_profit": round(net_profit, 2),
        "profit_factor": round(profit_factor, 2) if profit_factor != float("inf") else None,
        "expectancy": round(expectancy, 2),
        "avg_win": round(avg_win, 2),
        "avg_loss": round(avg_loss, 2),
        "equity_curve": equity_curve,
        "session_breakdown": session_breakdown,
        # Task #87 — advanced ratios
        "sharpe": round(sharpe, 2),
        "sortino": round(sortino, 2),
        "calmar": round(calmar, 2),
        "kelly_pct": round(kelly * 100, 2),  # as percentage
        "max_drawdown": round(max_dd, 2),
        # Task #78 — streaks
        "current_streak": current_streak,
        "longest_win_streak": longest_win_streak,
        "longest_loss_streak": longest_loss_streak,
        # Task #159 — today + week cuts for the ops panel
        "today_pnl": round(today_pnl, 2),
        "today_wins": today_w,
        "today_losses": today_l,
        "today_win_rate": today_rate,
        "week_pnl": round(week_pnl, 2),
        "week_wins": week_w,
        "week_losses": week_l,
        "week_win_rate": week_rate,
    }


# ----- Task #174: Monthly P&L pivot (Lucid-style stats) --------------------

@app.get("/api/analytics/monthly")
def analytics_monthly(
    group_by: str = "strategy",         # strategy | asset | account | session
    db: Session = Depends(get_db),
):
    """Pivot matrix: rows = groups (strategies / assets / accounts / sessions),
    cols = months. Each cell has $ pnl + wins + losses + win rate. Also returns
    per-month column totals and grand totals. Feeds the Stats page (Lucid-style)."""
    if group_by not in {"strategy", "asset", "account", "session"}:
        raise HTTPException(
            status_code=400,
            detail=f"group_by must be one of strategy|asset|account|session, got {group_by!r}",
        )

    rows = (
        db.query(Position)
        .filter(Position.status == "CLOSED")
        .filter(Position.realized_pnl.isnot(None))
        .order_by(Position.exit_time.asc().nulls_last(), Position.created_at.asc())
        .all()
    )
    if not rows:
        return {"group_by": group_by, "periods": [], "groups": [], "totals_by_month": {}, "grand_total": {"pnl": 0, "wins": 0, "losses": 0, "trades": 0, "win_rate": 0}}

    # Resolve label lookups so keys are human-readable
    strat_names = {s.id: s.name for s in db.query(Strategy).all()}
    acct_names = {a.id: a.name for a in db.query(Account).all()}

    def key_and_label(p: Position) -> tuple[str, str]:
        if group_by == "strategy":
            sid = p.strategy_id
            if not sid:
                return ("unassigned", "Unassigned")
            return (f"strategy_{sid}", strat_names.get(sid, f"Strategy #{sid}"))
        if group_by == "asset":
            t = p.ticker or "?"
            # Normalize the futures continuation contract suffix
            for stem in ("MNQ", "NQ", "MES", "ES", "M2K", "RTY", "MYM", "YM", "MGC", "GC", "CL", "MNG", "NG", "6E"):
                if t.upper().startswith(stem):
                    return (stem, stem)
            return (t, t)
        if group_by == "account":
            aid = p.account_id
            if not aid:
                return ("unassigned", "Unassigned")
            return (f"account_{aid}", acct_names.get(aid, f"Account #{aid}"))
        # session
        return (p.session or "unknown", (p.session or "unknown").replace("_", " ").title())

    # Bucket into (group_key, month) → aggregate
    def month_of(p: Position) -> str:
        d = p.exit_time or p.created_at
        return d.strftime("%Y-%m") if d else "unknown"

    periods_set = set()
    groups: dict[str, dict] = {}   # {key: {label, months: {"YYYY-MM": {pnl, wins, losses, trades}}}}
    totals_by_month: dict[str, dict] = {}

    for p in rows:
        gk, gl = key_and_label(p)
        m = month_of(p)
        periods_set.add(m)

        g = groups.setdefault(gk, {"key": gk, "label": gl, "months": {}, "totals": {"pnl": 0.0, "wins": 0, "losses": 0, "trades": 0}})
        cell = g["months"].setdefault(m, {"pnl": 0.0, "wins": 0, "losses": 0, "trades": 0})
        col = totals_by_month.setdefault(m, {"pnl": 0.0, "wins": 0, "losses": 0, "trades": 0})

        pnl = p.realized_pnl or 0.0
        w = 1 if pnl > 0 else 0
        l = 1 if pnl < 0 else 0

        for bucket in (cell, g["totals"], col):
            bucket["pnl"] += pnl
            bucket["wins"] += w
            bucket["losses"] += l
            bucket["trades"] += 1

    # Compute win_rate everywhere
    def add_rate(d: dict) -> dict:
        wl = d["wins"] + d["losses"]
        d["win_rate"] = round(d["wins"] / wl * 100, 1) if wl else 0
        d["pnl"] = round(d["pnl"], 2)
        return d

    for g in groups.values():
        for m in g["months"].values():
            add_rate(m)
        add_rate(g["totals"])
    for m in totals_by_month.values():
        add_rate(m)

    grand = {"pnl": 0.0, "wins": 0, "losses": 0, "trades": 0}
    for m in totals_by_month.values():
        grand["pnl"] += m["pnl"]
        grand["wins"] += m["wins"]
        grand["losses"] += m["losses"]
        grand["trades"] += m["trades"]
    add_rate(grand)

    periods = sorted(periods_set)
    # Sort groups by total pnl descending — biggest earners first
    groups_out = sorted(groups.values(), key=lambda g: g["totals"]["pnl"], reverse=True)

    return {
        "group_by": group_by,
        "periods": periods,
        "groups": groups_out,
        "totals_by_month": totals_by_month,
        "grand_total": grand,
    }


# Task #48: CSV export for tax + tape review
@app.get("/api/trades.csv")
def trades_csv(account_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Download full trade journal as CSV. All fields the tax software /
    prop firm compliance report / manual review would need."""
    from fastapi.responses import Response
    import csv, io

    q = db.query(Position).order_by(Position.created_at.desc())
    if account_id:
        q = q.filter(Position.account_id == account_id)
    rows = q.all()

    accts = {a.id: a for a in db.query(Account).all()}

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([
        "trade_id", "created_at", "entry_time", "exit_time",
        "symbol", "direction", "side", "status",
        "qty_total", "lot_size",
        "entry_price", "exit_price", "stop_price",
        "tp1_px", "tp2_px", "tp3_px",
        "realized_pnl", "pips", "risk_percentage", "risk_amount",
        "session", "strategy_id", "trailing_stop_used",
        "account_id", "account_name", "broker", "group_name",
        "exit_reason", "stop_source", "notes",
    ])
    for p in rows:
        acct = accts.get(p.account_id) if p.account_id else None
        w.writerow([
            p.trade_id,
            p.created_at.isoformat() if p.created_at else "",
            p.entry_time.isoformat() if p.entry_time else "",
            p.exit_time.isoformat() if p.exit_time else "",
            p.ticker, p.direction or "", p.side or "", p.status or "",
            p.qty_total or 0, p.lot_size or "",
            p.entry_price or "", p.avg_fill_price or "", p.stop_price or "",
            p.tp1_px or "", p.tp2_px or "", p.tp3_px or "",
            p.realized_pnl if p.realized_pnl is not None else "",
            p.pips or "", p.risk_percentage or "", p.risk_amount or "",
            p.session or "", p.strategy_id or "", bool(p.trailing_stop_used),
            p.account_id or "", (acct.name if acct else ""),
            p.broker or "", p.group_name or "",
            p.exit_reason or "", p.stop_source or "",
            (p.notes or "").replace("\n", " ").replace("\r", " "),
        ])
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=trades_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"},
    )


# ----- Task #173: Trade Journal — bulk clear/reset -------------------------

@app.delete("/api/trades")
def clear_trades(
    scope: str = "closed_only",           # "closed_only" | "all"
    account_id: Optional[int] = None,     # optional per-account scope
    before_date: Optional[str] = None,    # ISO date, deletes exit_time <= this
    key: str = "",
    db: Session = Depends(get_db),
):
    """Bulk-delete positions from the journal. Frontend enforces export-first +
    typed-confirm before hitting this. Server-side safety: NEVER touches OPEN
    positions unless scope=='all' is explicitly requested."""
    _admin_check(key)

    q = db.query(Position)
    if scope == "closed_only":
        # Only fully closed trades — never touch a live one from here
        q = q.filter(Position.status.in_(["CLOSED", "CANCELLED"]))
    elif scope != "all":
        raise HTTPException(status_code=400, detail=f"scope must be 'closed_only' or 'all', got {scope!r}")

    if account_id:
        q = q.filter(Position.account_id == account_id)

    if before_date:
        try:
            cutoff = datetime.fromisoformat(before_date.replace("Z", "+00:00"))
            q = q.filter(Position.exit_time.isnot(None), Position.exit_time <= cutoff)
        except Exception:
            raise HTTPException(status_code=400, detail=f"before_date must be ISO 8601, got {before_date!r}")

    count = q.count()
    q.delete(synchronize_session=False)
    db.commit()
    return {"deleted": count, "scope": scope, "account_id": account_id, "before_date": before_date}


# ----- File upload (trade screenshots) -------------------------------------

UPLOAD_DIR = Path(__file__).parent / "static" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


@app.post("/api/upload")
async def upload_file(key: str = "", file: UploadFile = File(...)):
    _admin_check(key)
    ext = Path(file.filename or "").suffix.lower() or ".bin"
    if ext not in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".pdf"}:
        raise HTTPException(status_code=400, detail=f"unsupported extension {ext}")
    name = f"{_uuid.uuid4().hex}{ext}"
    dest = UPLOAD_DIR / name
    content = await file.read()
    with open(dest, "wb") as f:
        f.write(content)
    return {"file_url": f"/static/uploads/{name}", "filename": file.filename, "size": len(content)}


# ----- User settings (singleton row id=1) ----------------------------------

class UserSettingsPatch(BaseModel):
    notification_settings: Optional[dict] = None
    alert_configuration: Optional[dict] = None
    trader_response: Optional[dict] = None
    desktop_header_text: Optional[str] = None
    trader_name: Optional[str] = None
    trading_rules: Optional[list] = None
    welcome_message: Optional[str] = None


def _user_to_dict(u: UserSettings) -> dict:
    trader_name = (getattr(u, "trader_name", None) or "Trader")
    template = (getattr(u, "welcome_message", None) or
                "Let's bank some coin {name}!! Stick to your rules")
    # Render {name} placeholder for the frontend so Dashboard doesn't
    # have to do string interpolation.
    welcome_rendered = template.replace("{name}", trader_name)
    return {
        "id": u.id,
        "notification_settings": u.notification_settings or {},
        "alert_configuration": u.alert_configuration or {},
        "trader_response": u.trader_response or {},
        "desktop_header_text": u.desktop_header_text or "TradeCore",
        "trader_name": trader_name,
        "trading_rules": getattr(u, "trading_rules", None) or [],
        "welcome_message_template": template,
        "welcome_message": welcome_rendered,
        "updated_at": u.updated_at.isoformat() if u.updated_at else None,
    }


@app.get("/api/user/me")
def get_user_me(db: Session = Depends(get_db)):
    u = db.query(UserSettings).filter(UserSettings.id == 1).first()
    if not u:
        # Migration seeds row 1; this fallback covers first-boot edge cases.
        u = UserSettings(id=1, notification_settings={}, alert_configuration={},
                         trader_response={}, desktop_header_text="TradeCore")
        db.add(u); db.commit(); db.refresh(u)
    return _user_to_dict(u)


@app.patch("/api/user/me")
def update_user_me(data: UserSettingsPatch, key: str = "", db: Session = Depends(get_db)):
    _admin_check(key)
    u = db.query(UserSettings).filter(UserSettings.id == 1).first()
    if not u:
        u = UserSettings(id=1)
        db.add(u)
    for k, v in data.dict(exclude_unset=True).items():
        setattr(u, k, v)
    db.commit(); db.refresh(u)
    return _user_to_dict(u)


# ----- On-demand Flatten (task #70 companion) ------------------------------
# Manual "close everything on this account NOW" — doesn't engage kill switch,
# just does the emergency flat. Useful when trader wants to end the session
# clean without blocking future trades.

@app.post("/api/accounts/{account_id}/flatten")
def flatten_account(account_id: int, key: str = "", db: Session = Depends(get_db)):
    _admin_check(key)
    acct = db.query(Account).filter(Account.id == account_id).first()
    if not acct:
        raise HTTPException(status_code=404, detail="account not found")
    from .executor import _flatten_account_positions
    n = _flatten_account_positions(acct, db)
    db.commit()
    return {"flattened": n, "account_id": acct.id, "account_name": acct.name}


@app.post("/api/flatten-all")
def flatten_all(key: str = "", db: Session = Depends(get_db)):
    """Emergency flat every open position across every account.
    Different from kill switch — doesn't block future entries, just
    closes the current book. Guardian/kill_switch stay whatever they are."""
    _admin_check(key)
    from .executor import _flatten_account_positions
    total = 0
    touched = 0
    for a in db.query(Account).all():
        n = _flatten_account_positions(a, db)
        if n > 0:
            touched += 1
            total += n
    db.commit()
    return {"accounts_touched": touched, "positions_flattened": total}


# ----- Global Kill Switch (task #43) ---------------------------------------
# BIG RED BUTTON: instantly stops all entries + optionally flattens every
# open position across every account. Reset is a deliberate two-step action.

class KillSwitchIn(BaseModel):
    on: bool
    reason: Optional[str] = "manual"
    flatten_all: Optional[bool] = False   # also flat every open position?


@app.get("/api/kill-switch")
def kill_switch_status(db: Session = Depends(get_db)):
    us = db.query(UserSettings).filter(UserSettings.id == 1).first()
    if not us:
        return {"on": False, "triggered_at": None, "reason": None}
    return {
        "on": bool(getattr(us, "kill_switch_on", False)),
        "triggered_at": getattr(us, "kill_switch_triggered_at", None).isoformat()
                        if getattr(us, "kill_switch_triggered_at", None) else None,
        "reason": getattr(us, "kill_switch_reason", None),
    }


@app.post("/api/kill-switch")
def kill_switch_set(data: KillSwitchIn, key: str = "", db: Session = Depends(get_db)):
    _admin_check(key)
    us = db.query(UserSettings).filter(UserSettings.id == 1).first()
    if not us:
        us = UserSettings(id=1)
        db.add(us)
    us.kill_switch_on = bool(data.on)
    if data.on:
        us.kill_switch_triggered_at = datetime.now(timezone.utc)
        us.kill_switch_reason = data.reason or "manual"
    else:
        us.kill_switch_reason = None
        # Keep triggered_at as audit trail — user knows when it was last on.

    flattened_summary = {"accounts_touched": 0, "positions_flattened": 0}
    if data.on and data.flatten_all:
        # Emergency flat every open position across every account
        from .executor import _flatten_account_positions
        accounts = db.query(Account).all()
        for acct in accounts:
            n = _flatten_account_positions(acct, db)
            if n > 0:
                flattened_summary["accounts_touched"] += 1
                flattened_summary["positions_flattened"] += n
    db.commit()
    db.refresh(us)
    return {
        "on": us.kill_switch_on,
        "triggered_at": us.kill_switch_triggered_at.isoformat() if us.kill_switch_triggered_at else None,
        "reason": us.kill_switch_reason,
        "flattened": flattened_summary if data.flatten_all else None,
    }


# ----- Equity Guardian control ---------------------------------------------
# Task #53. Guardian fires automatically inside executor.py — this endpoint
# exposes reset + status inspection to the frontend Accounts page.

@app.post("/api/accounts/{account_id}/reset-guardian")
def reset_guardian(account_id: int, key: str = "", db: Session = Depends(get_db)):
    """Clear guardian lock — state back to 'active', pnl_today back to 0.
    Trader calls this manually after acknowledging the day is over."""
    _admin_check(key)
    acct = db.query(Account).filter(Account.id == account_id).first()
    if not acct:
        raise HTTPException(status_code=404, detail="account not found")
    prev_state = acct.state
    prev_pnl = acct.pnl_today
    acct.state = "active"
    acct.pnl_today = 0.0
    acct.wins_today = 0
    acct.losses_today = 0
    db.commit(); db.refresh(acct)
    return {
        "reset": True,
        "account_id": acct.id,
        "previous_state": prev_state,
        "previous_pnl_today": prev_pnl,
        "new_state": acct.state,
    }


@app.get("/api/accounts/{account_id}/guardian-status")
def guardian_status(account_id: int, db: Session = Depends(get_db)):
    """Returns whether guardian is currently blocking + how close we are
    to breach. Powers the "you're at X% of daily limit" progress on the
    Accounts page (#52 prop firm progress bars)."""
    acct = db.query(Account).filter(Account.id == account_id).first()
    if not acct:
        raise HTTPException(status_code=404, detail="account not found")
    limit = float(acct.daily_loss_limit or 0)
    pnl_today = float(acct.pnl_today or 0)
    if limit <= 0:
        return {
            "account_id": acct.id, "state": acct.state, "limit_configured": False,
            "daily_limit": 0, "pnl_today": pnl_today, "pct_used": 0,
            "locked": (acct.state == "stopped"),
        }
    # pct_used: 0 = fresh day, 100 = fully breached
    pct = 0.0
    if pnl_today < 0:
        pct = min(100.0, (abs(pnl_today) / limit) * 100.0)
    return {
        "account_id": acct.id,
        "state": acct.state,
        "limit_configured": True,
        "daily_limit": limit,
        "pnl_today": pnl_today,
        "pct_used": round(pct, 1),
        "locked": (acct.state == "stopped") or (pnl_today <= -limit),
    }


# ----- Goals CRUD + progress ----------------------------------------------
# Task #51. Traders create daily/weekly/monthly $ targets and track
# progress toward them on the Dashboard hero.

class GoalIn(BaseModel):
    name: str
    period: str = "daily"                 # daily / weekly / monthly / cycle
    target_amount: float
    account_id: Optional[int] = None      # None = "across all accounts"
    strategy_id: Optional[int] = None     # None = "any strategy"
    is_active: Optional[bool] = True


class GoalPatch(BaseModel):
    name: Optional[str] = None
    period: Optional[str] = None
    target_amount: Optional[float] = None
    account_id: Optional[int] = None
    strategy_id: Optional[int] = None
    is_active: Optional[bool] = None
    is_met: Optional[bool] = None


def _goal_progress(g: Goal, db: Session) -> dict:
    """Compute (achieved, pct) for a goal based on its period + scope."""
    now = datetime.now(timezone.utc)
    if g.period == "daily":
        # Use account.pnl_today if scoped, else sum across accounts
        if g.account_id:
            acct = db.query(Account).filter(Account.id == g.account_id).first()
            achieved = float(acct.pnl_today or 0) if acct else 0.0
        else:
            achieved = float(
                db.query(sa_func.coalesce(sa_func.sum(Account.pnl_today), 0)).scalar() or 0
            )
    else:
        # weekly / monthly / cycle: sum realized_pnl from closed positions
        # in the period window.
        if g.period == "weekly":
            start = now - timedelta(days=7)
        elif g.period == "monthly":
            start = now - timedelta(days=30)
        else:
            start = datetime.min.replace(tzinfo=timezone.utc)  # cycle = all-time
        q = db.query(sa_func.coalesce(sa_func.sum(Position.realized_pnl), 0))
        q = q.filter(Position.status == "CLOSED", Position.created_at >= start)
        if g.account_id:
            q = q.filter(Position.account_id == g.account_id)
        if g.strategy_id:
            q = q.filter(Position.strategy_id == g.strategy_id)
        achieved = float(q.scalar() or 0)
    target = float(g.target_amount or 0)
    pct = 0.0 if target <= 0 else min(200.0, (achieved / target) * 100.0)
    return {"achieved": round(achieved, 2), "pct": round(pct, 1)}


def _goal_to_dict(g: Goal, db: Session = None) -> dict:
    d = {
        "id": g.id, "name": g.name, "period": g.period,
        "target_amount": g.target_amount, "account_id": g.account_id,
        "strategy_id": g.strategy_id, "is_active": g.is_active,
        "is_met": g.is_met,
        "met_at": g.met_at.isoformat() if g.met_at else None,
        "created_at": g.created_at.isoformat() if g.created_at else None,
    }
    if db is not None:
        d.update(_goal_progress(g, db))
    return d


@app.get("/api/goals")
def list_goals(db: Session = Depends(get_db)):
    return [_goal_to_dict(g, db) for g in db.query(Goal).order_by(Goal.id.desc()).all()]


@app.post("/api/goals")
def create_goal(data: GoalIn, key: str = "", db: Session = Depends(get_db)):
    _admin_check(key)
    g = Goal(**data.dict(exclude_unset=True))
    db.add(g); db.commit(); db.refresh(g)
    return _goal_to_dict(g, db)


@app.patch("/api/goals/{gid}")
def update_goal(gid: int, data: GoalPatch, key: str = "", db: Session = Depends(get_db)):
    _admin_check(key)
    g = db.query(Goal).filter(Goal.id == gid).first()
    if not g: raise HTTPException(status_code=404, detail="goal not found")
    for k, v in data.dict(exclude_unset=True).items():
        setattr(g, k, v)
    if data.is_met is True and not g.met_at:
        g.met_at = datetime.now(timezone.utc)
    db.commit(); db.refresh(g)
    return _goal_to_dict(g, db)


@app.delete("/api/goals/{gid}")
def delete_goal(gid: int, key: str = "", db: Session = Depends(get_db)):
    _admin_check(key)
    g = db.query(Goal).filter(Goal.id == gid).first()
    if not g: raise HTTPException(status_code=404, detail="goal not found")
    db.delete(g); db.commit()
    return {"deleted": True, "id": gid}


# ----- Password Vault (task #148) ------------------------------------------
# Encrypted store for prop firm portal + broker + TradingView logins.
# Passwords are Fernet-encrypted at rest with VAULT_KEY env var.
# List endpoints never leak decrypted passwords — only /reveal does,
# and it requires admin key.

def _vault_fernet():
    """Lazy-init Fernet cipher. If VAULT_KEY isn't set, we mint an
    ephemeral one at boot + log a warning (dev mode — entries won't
    survive restarts). In prod, set VAULT_KEY once + keep it stable."""
    from cryptography.fernet import Fernet
    key = os.getenv("VAULT_KEY")
    if not key:
        # Dev fallback — regenerated each restart, so entries stored
        # this session can't be decrypted after a redeploy.
        if not hasattr(app.state, "_vault_ephemeral_key"):
            app.state._vault_ephemeral_key = Fernet.generate_key().decode()
            log.warning("VAULT_KEY env var not set — using ephemeral key "
                        "(entries won't decrypt after restart). Set VAULT_KEY "
                        "in Railway env for persistence.")
        key = app.state._vault_ephemeral_key
    if isinstance(key, str):
        key = key.encode()
    return Fernet(key)


def _encrypt_pw(plaintext: Optional[str]) -> Optional[str]:
    if not plaintext:
        return None
    return _vault_fernet().encrypt(plaintext.encode()).decode()


def _decrypt_pw(ciphertext: Optional[str]) -> Optional[str]:
    if not ciphertext:
        return None
    try:
        return _vault_fernet().decrypt(ciphertext.encode()).decode()
    except Exception as e:
        log.warning("vault decrypt failed: %s", e)
        return None


class VaultIn(BaseModel):
    label: str
    category: Optional[str] = "prop_firm"
    url: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None                 # plaintext in; stored encrypted
    notes: Optional[str] = None
    is_favorite: Optional[bool] = False
    account_id: Optional[int] = None


class VaultPatch(BaseModel):
    label: Optional[str] = None
    category: Optional[str] = None
    url: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None                 # if provided, re-encrypt
    notes: Optional[str] = None
    is_favorite: Optional[bool] = None
    account_id: Optional[int] = None


def _vault_to_dict(v: VaultEntry, include_password: bool = False) -> dict:
    d = {
        "id": v.id, "label": v.label, "category": v.category,
        "url": v.url, "username": v.username,
        "has_password": bool(v.encrypted_password),
        "notes": v.notes, "is_favorite": v.is_favorite,
        "account_id": v.account_id,
        "last_used_at": v.last_used_at.isoformat() if v.last_used_at else None,
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }
    if include_password:
        d["password"] = _decrypt_pw(v.encrypted_password)
    return d


@app.get("/api/vault")
def list_vault(db: Session = Depends(get_db)):
    """List vault entries — passwords are NEVER included here. Frontend
    shows the label + username + masked password (••••). Call /reveal
    to get the plaintext for a specific entry."""
    return [_vault_to_dict(v) for v in
            db.query(VaultEntry).order_by(VaultEntry.is_favorite.desc(), VaultEntry.id.desc()).all()]


@app.post("/api/vault")
def create_vault(data: VaultIn, key: str = "", db: Session = Depends(get_db)):
    _admin_check(key)
    payload = data.dict(exclude_unset=True)
    plaintext = payload.pop("password", None)
    v = VaultEntry(**payload, encrypted_password=_encrypt_pw(plaintext))
    db.add(v); db.commit(); db.refresh(v)
    return _vault_to_dict(v)


@app.patch("/api/vault/{vid}")
def update_vault(vid: int, data: VaultPatch, key: str = "", db: Session = Depends(get_db)):
    _admin_check(key)
    v = db.query(VaultEntry).filter(VaultEntry.id == vid).first()
    if not v: raise HTTPException(status_code=404, detail="vault entry not found")
    payload = data.dict(exclude_unset=True)
    if "password" in payload:
        v.encrypted_password = _encrypt_pw(payload.pop("password"))
    for k, val in payload.items():
        setattr(v, k, val)
    db.commit(); db.refresh(v)
    return _vault_to_dict(v)


@app.delete("/api/vault/{vid}")
def delete_vault(vid: int, key: str = "", db: Session = Depends(get_db)):
    _admin_check(key)
    v = db.query(VaultEntry).filter(VaultEntry.id == vid).first()
    if not v: raise HTTPException(status_code=404, detail="vault entry not found")
    db.delete(v); db.commit()
    return {"deleted": True, "id": vid}


@app.get("/api/vault/{vid}/reveal")
def reveal_vault(vid: int, key: str = "", db: Session = Depends(get_db)):
    """Returns the decrypted password for one entry. Requires admin key
    — auditable in server logs (task #100). Bumps last_used_at."""
    _admin_check(key)
    v = db.query(VaultEntry).filter(VaultEntry.id == vid).first()
    if not v: raise HTTPException(status_code=404, detail="vault entry not found")
    v.last_used_at = datetime.now(timezone.utc)
    db.commit()
    return _vault_to_dict(v, include_password=True)


# ----- Reconciliation / Broker Sync Verification ---------------------------
# Task #45. User wants to verify: signal in → broker fill → journal record
# ALL match. The `reconcile_loop` in reconciliation.py runs every 5s when
# a real broker is armed. These endpoints expose that state to the frontend
# + let the trader manually trigger a check.

@app.get("/api/reconciliation/status")
def reconciliation_status(db: Session = Depends(get_db)):
    """Snapshot of server-vs-broker sync state.
    - active: is the background loop running?
    - broker_name: which adapter is armed
    - server_positions: count of OPEN/PARTIAL/PENDING in our DB
    - broker_positions: count from broker (or 'unavailable' if simulated)
    - recent_warnings: last 20 drift events
    - in_sync: quick bool — no warnings in last minute + counts match
    """
    b = get_broker()
    is_simulated = b.name == "simulated"
    server_open = db.query(Position).filter(
        Position.status.in_(["OPEN", "PARTIAL", "PENDING"])
    ).count()

    result = {
        "active": (not is_simulated),
        "broker_name": b.name,
        "broker_env": b.env,
        "server_positions_open": server_open,
        "broker_positions_open": None,
        "recent_warnings": list(recent_warnings)[:20],
        "in_sync": None,
        "note": None,
    }
    if is_simulated:
        result["note"] = (
            "Simulated broker — sync check inactive. Server records what "
            "Pine sent; no real orders were placed. Arm a real broker "
            "(Tradovate/PMT/TS) via env vars to enable live drift detection."
        )
        # In simulated mode we know server is authoritative — always "in sync"
        result["in_sync"] = True
        return result
    # Real broker path
    try:
        broker_positions = b.fetch_open_positions()
        result["broker_positions_open"] = len(broker_positions)
        # Fresh warnings (< 60s old) mean drift right now
        import time as _t
        cutoff = _t.time() - 60
        fresh_warnings = [w for w in recent_warnings if w.get("ts", 0) >= cutoff]
        result["in_sync"] = (not fresh_warnings and server_open == len(broker_positions))
        result["fresh_drift_count"] = len(fresh_warnings)
    except Exception as e:
        result["error"] = str(e)
        result["in_sync"] = False
    return result


@app.post("/api/reconciliation/run")
async def reconciliation_run_now(key: str = "", db: Session = Depends(get_db)):
    """Trigger an immediate reconciliation sweep — don't wait for the
    5-second background loop. Returns the same shape as /status."""
    _admin_check(key)
    b = get_broker()
    if b.name == "simulated":
        return reconciliation_status(db=db)  # nothing to run — return status
    # Run one iteration of the recon logic inline
    try:
        broker_positions = await asyncio.to_thread(b.fetch_open_positions)
        from .assets import asset_root
        server_open = db.query(Position).filter(
            Position.status.in_(["OPEN", "PARTIAL", "PENDING"])
        ).all()
        by_root = {}
        for p in server_open:
            by_root.setdefault(asset_root(p.ticker) or p.ticker, []).append(p)
        broker_by_root = {}
        for bp in broker_positions:
            sym = bp.get("symbol") or bp.get("contractSymbol") or ""
            root = asset_root(sym) or sym
            broker_by_root[root] = bp
        checked = list(set(by_root.keys()) | set(broker_by_root.keys()))
        drift = []
        for root in checked:
            ps = by_root.get(root, [])
            bp = broker_by_root.get(root)
            if ps and not bp:
                drift.append({"root": root, "kind": "broker_flat_server_open", "server_qty": sum(p.qty_open or 0 for p in ps)})
            elif bp and not ps:
                drift.append({"root": root, "kind": "broker_open_server_flat", "broker_net": bp.get("netPos")})
            else:
                sq = sum((p.qty_open or 0) if (p.side or "").upper() == "LONG" else -(p.qty_open or 0) for p in ps)
                bq = int(bp.get("netPos", 0)) if bp else 0
                if sq != bq:
                    drift.append({"root": root, "kind": "qty_mismatch", "server_qty": sq, "broker_qty": bq})
        return {
            "checked_roots": checked,
            "drift": drift,
            "in_sync": len(drift) == 0,
            "broker_positions_open": len(broker_positions),
            "server_positions_open": len(server_open),
        }
    except Exception as e:
        return {"error": str(e), "in_sync": False}


# ----- Live Position controls (task #107) ----------------------------------
# Trader clicks Close / Move SL / Modify TP on a live position card.
# These hit the position row directly (simulated mode) or the broker
# adapter (once armed). Broadcast via WebSocket so all tabs sync live.

class PositionModify(BaseModel):
    stop_price: Optional[float] = None
    tp1_px: Optional[float] = None
    tp2_px: Optional[float] = None
    tp3_px: Optional[float] = None
    stop_source: Optional[str] = "MANUAL_UI"


class PositionClose(BaseModel):
    qty: Optional[int] = None      # None = close ALL; N = close N contracts
    reason: Optional[str] = "manual_close"


@app.patch("/api/positions/{pid}/modify")
def modify_position(pid: int, data: PositionModify, key: str = "",
                    db: Session = Depends(get_db)):
    """Move SL / TP levels on an open position. Records a StopUpdate row
    so the ledger tracks the change. Once real broker is armed, this also
    calls broker.modify_stop() — for now just updates our DB state."""
    _admin_check(key)
    p = db.query(Position).filter(Position.id == pid).first()
    if not p:
        raise HTTPException(status_code=404, detail="position not found")
    if (p.status or "").upper() in ("CLOSED", "CANCELLED"):
        raise HTTPException(status_code=400, detail=f"position is {p.status} — cannot modify")

    changes = {}
    if data.stop_price is not None:
        old_sl = p.stop_price
        p.stop_price = data.stop_price
        p.stop_source = data.stop_source or "MANUAL_UI"
        # Record the move for the audit ledger
        db.add(StopUpdate(
            trade_id=p.trade_id, ticker=p.ticker, side=p.side,
            old_stop=old_sl, new_stop=data.stop_price,
            source=data.stop_source or "MANUAL_UI",
        ))
        changes["stop_price"] = {"old": old_sl, "new": data.stop_price}
    if data.tp1_px is not None:
        changes["tp1_px"] = {"old": p.tp1_px, "new": data.tp1_px}
        p.tp1_px = data.tp1_px
    if data.tp2_px is not None:
        changes["tp2_px"] = {"old": p.tp2_px, "new": data.tp2_px}
        p.tp2_px = data.tp2_px
    if data.tp3_px is not None:
        changes["tp3_px"] = {"old": p.tp3_px, "new": data.tp3_px}
        p.tp3_px = data.tp3_px

    db.commit(); db.refresh(p)

    # Broadcast to WebSocket subscribers so live tabs update
    try:
        import asyncio as _aio
        _aio.create_task(ws_manager.broadcast({
            "type": "position_modified",
            "trade_id": p.trade_id,
            "position_id": p.id,
            "changes": changes,
        }))
    except Exception:
        pass

    return {
        "position_id": p.id, "trade_id": p.trade_id,
        "changes": changes,
        "broker": p.broker,
        # Once #44 armed: also call broker.modify_stop() here + include broker result
    }


@app.post("/api/positions/{pid}/close")
def close_position_manual(pid: int, data: PositionClose, key: str = "",
                          db: Session = Depends(get_db)):
    """Close a position (full or partial). Marks the row CLOSED (or PARTIAL),
    fires WebSocket update. Once broker armed → also calls broker.close_position()
    / close_partial()."""
    _admin_check(key)
    p = db.query(Position).filter(Position.id == pid).first()
    if not p:
        raise HTTPException(status_code=404, detail="position not found")
    if (p.status or "").upper() in ("CLOSED", "CANCELLED"):
        raise HTTPException(status_code=400, detail=f"position already {p.status}")

    close_qty = data.qty if data.qty is not None else p.qty_open
    close_qty = min(close_qty, p.qty_open or 0)
    if close_qty <= 0:
        raise HTTPException(status_code=400, detail="nothing to close")

    p.qty_open = max(0, (p.qty_open or 0) - close_qty)
    if p.qty_open == 0:
        p.status = "CLOSED"
        p.exit_reason = data.reason or "manual_close"
        p.exit_time = datetime.now(timezone.utc)
    else:
        p.status = "PARTIAL"

    db.commit(); db.refresh(p)

    try:
        import asyncio as _aio
        _aio.create_task(ws_manager.broadcast({
            "type": "position_closed" if p.status == "CLOSED" else "position_partial",
            "trade_id": p.trade_id,
            "position_id": p.id,
            "closed_qty": close_qty,
            "remaining_qty": p.qty_open,
            "reason": data.reason,
        }))
    except Exception:
        pass

    return {
        "position_id": p.id, "trade_id": p.trade_id,
        "closed_qty": close_qty, "remaining_qty": p.qty_open,
        "status": p.status,
    }


@app.get("/api/positions/{pid}/broker-sync")
def position_broker_sync(pid: int, db: Session = Depends(get_db)):
    """Per-position sync check. Traces one trade end-to-end:
    - What Pine sent (signal snapshot from position row)
    - What broker actually has now (via fetch_open_positions)
    - Verdict: match / drift / broker_flat / broker_only
    Powers a 'Verify Sync' button on the Trade detail drawer."""
    p = db.query(Position).filter(Position.id == pid).first()
    if not p:
        raise HTTPException(status_code=404, detail="position not found")
    b = get_broker()
    from .assets import asset_root
    root = asset_root(p.ticker) or p.ticker

    server_view = {
        "trade_id": p.trade_id, "ticker": p.ticker, "root": root,
        "side": p.side, "qty_total": p.qty_total, "qty_open": p.qty_open,
        "entry_price": p.entry_price, "stop_price": p.stop_price,
        "status": p.status, "broker": p.broker,
        "broker_order_id": p.broker_order_id,
        "broker_stop_order_id": p.broker_stop_order_id,
        "avg_fill_price": p.avg_fill_price,
        "realized_pnl": p.realized_pnl,
    }
    if b.name == "simulated":
        return {
            "verdict": "simulated_no_broker_state",
            "note": "Server records only — no live broker to compare against. Arm a real broker to enable sync verification.",
            "server_view": server_view,
        }
    try:
        broker_positions = b.fetch_open_positions()
        matching = [bp for bp in broker_positions
                    if (asset_root(bp.get("symbol", "")) or bp.get("symbol")) == root]
        if not matching:
            return {"verdict": "broker_flat", "server_view": server_view,
                    "broker_view": None,
                    "explanation": f"Broker has no position on {root}. Server thinks {p.status}."}
        # Report first matching leg (a single root usually = one position)
        bp = matching[0]
        broker_qty = int(bp.get("netPos", 0))
        server_signed = (p.qty_open or 0) if (p.side or "").upper() == "LONG" else -(p.qty_open or 0)
        verdict = "match" if server_signed == broker_qty else "qty_mismatch"
        return {
            "verdict": verdict,
            "server_view": server_view,
            "broker_view": bp,
            "server_signed_qty": server_signed,
            "broker_signed_qty": broker_qty,
        }
    except Exception as e:
        return {"verdict": "broker_error", "error": str(e), "server_view": server_view}


# ----- Static file serving for the React SPA + uploads --------------------
# The React build outputs to app/static/. In prod, FastAPI serves that as
# the site root. In dev the frontend runs on :3737 via Vite and calls this
# server for /api/*. Uploads always live under /static/uploads/.

_STATIC_DIR = Path(__file__).parent / "static"
if _STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(_STATIC_DIR)), name="static")
    # SPA fallback: any GET path not matched by an @app.get is served by
    # index.html so React Router handles it. Register only if a built
    # frontend is present.
    _SPA_INDEX = _STATIC_DIR / "index.html"
    if _SPA_INDEX.exists():
        @app.get("/{full_path:path}", include_in_schema=False)
        def spa_fallback(full_path: str):
            # Skip API routes + docs (they have their own handlers)
            if full_path.startswith(("api/", "ws/", "docs", "openapi.json", "static/")):
                raise HTTPException(status_code=404)
            file_path = _STATIC_DIR / full_path
            if file_path.is_file():
                return FileResponse(file_path)
            return FileResponse(_SPA_INDEX)

