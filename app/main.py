import os
import json
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from .db import get_db, run_migrations
# Import models so SQLAlchemy registers tables before run_migrations() runs.
from . import models  # noqa: F401
from .models import WebhookSignal, Position, StopUpdate, Account, Group, GroupMember, BROKER_KINDS
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


@app.on_event("startup")
async def on_startup() -> None:
    # Idempotent: creates tables if missing, adds new columns if missing.
    run_migrations()

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
        return f"""
        <tr>
            <td>{a.id}</td>
            <td><strong>{a.name}</strong></td>
            <td><span class="hint">{a.broker}</span></td>
            <td>{a.env}</td>
            <td>{a.account_id or "—"}</td>
            <td>{a.multiplier}×</td>
            <td>{today_html}</td>
            <td>{limit_html}</td>
            <td>{active_badge}{paused_badge}</td>
        </tr>
        """

    accounts_html = "".join(_acct_row(a) for a in _all_accounts)

    def _group_row(g: Group) -> str:
        members_html = "<span class='hint'>no members yet</span>"
        if g.members:
            active_members = [m for m in g.members if m.active]
            if active_members:
                members_html = " ".join([
                    f'<span class="chip">{m.account.name if m.account else "?"} <span class="hint">×{m.multiplier}</span></span>'
                    for m in sorted(active_members, key=lambda x: x.priority)
                ])
        active_badge = '<span class="badge status-open">ACTIVE</span>' if g.active else '<span class="badge status-closed">OFF</span>'
        return f"""
        <tr>
            <td>{g.id}</td>
            <td><strong>{g.name}</strong></td>
            <td>{g.description or "—"}</td>
            <td>{members_html}</td>
            <td>{active_badge}</td>
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
        <div class="wrap">
            <div class="hero">
                <div class="eyebrow">Freeballin</div>
                <h1>Trade Engine Dashboard</h1>
                <div class="sub"><span id="live-dot" class="live-dot"></span><span id="live-text">Live — auto-updating</span> · stateful webhook engine, Phase 3a</div>

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
                </div>
            </div>

            <div class="panel">
                <div class="panel-head">
                    <div class="panel-title">🎯 Live Trades</div>
                    <div class="hint">Rich per-trade view — full context on entry, TPs, stops, PnL</div>
                </div>
                {trade_cards_html if trade_cards_html else '<div class="empty">No live trades right now. Cards will appear here when a trade is active.</div>'}
            </div>

            <div class="panel">
                <div class="panel-head">
                    <div class="panel-title">💼 Accounts</div>
                    <div class="hint">Broker connections with today's realized PnL + daily loss limit tracking</div>
                </div>
                {f'''
                <table>
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Name</th>
                            <th>Broker</th>
                            <th>Env</th>
                            <th>Account ID</th>
                            <th>Mult</th>
                            <th>Today Realized</th>
                            <th>Daily Loss Used</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>{accounts_html}</tbody>
                </table>
                ''' if _all_accounts else '<div class="empty">No accounts configured yet. POST to <code>/api/accounts</code> to add your first broker account.</div>'}
            </div>

            <div class="panel">
                <div class="panel-head">
                    <div class="panel-title">👥 Groups</div>
                    <div class="hint">Fan-out targets — one Pine signal → all active members with per-account multipliers</div>
                </div>
                {f'''
                <table>
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Name</th>
                            <th>Description</th>
                            <th>Members</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>{groups_html}</tbody>
                </table>
                ''' if _all_groups else '<div class="empty">No groups yet. POST to <code>/api/groups</code> to create one, then add members via <code>/api/groups/{{id}}/members</code>.</div>'}
            </div>

            <div class="panel">
                <div class="panel-head">
                    <div class="panel-title">Active Positions</div>
                    <div class="hint">PENDING · OPEN · PARTIAL — compact table view</div>
                </div>
                {f'''
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
                ''' if active_positions else '<div class="empty">No active positions.</div>'}
            </div>

            <div class="panel">
                <div class="panel-head">
                    <div class="panel-title">Closed Positions</div>
                    <div class="hint">Last 25</div>
                </div>
                {f'''
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
                ''' if closed_positions else '<div class="empty">No closed positions yet.</div>'}
            </div>

            <div class="panel">
                <div class="panel-head">
                    <div class="panel-title">Stop Updates</div>
                    <div class="hint">Real-time ledger — BE · JUMP · TRAIL · RESYNC · MASTER · drag · last 50</div>
                </div>
                {f'''
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
                ''' if recent_stop_updates else '<div class="empty">No stop updates yet.</div>'}
            </div>

            <div class="panel">
                <div class="panel-head">
                    <div class="panel-title">Recent Signals</div>
                    <div class="hint">Latest 50 webhook events</div>
                </div>

                {f'''
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
                ''' if signals else '<div class="empty">No signals yet. Trigger a TradingView alert and refresh this page.</div>'}

                <div class="footer-links">
                    <a href="/docs">API Docs</a>
                    <a href="/api/signals">Raw Signals JSON</a>
                    <a href="/api/positions">Positions JSON</a>
                    <a href="/api/stop-updates">Stop Updates JSON</a>
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
        members = [m for m in group_obj.members if m.active and m.account and m.account.active]
        if not members:
            raise HTTPException(status_code=400, detail=f"group '{data.group}' has no active members")

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
