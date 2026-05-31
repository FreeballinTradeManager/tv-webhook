import os
import json
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from .db import get_db, run_migrations
# Import models so SQLAlchemy registers tables before run_migrations() runs.
from . import models  # noqa: F401
from .models import WebhookSignal, Position
from .executor import execute_trade

app = FastAPI()


@app.on_event("startup")
def on_startup() -> None:
    # Idempotent: creates tables if missing, adds new columns if missing.
    run_migrations()


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


@app.get("/")
def root():
    return {"status": "running"}


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
    def _pos_row(p: Position) -> str:
        side_class = "side-long" if (p.side or "").upper() == "LONG" else "side-short"
        return f"""
        <tr>
            <td>{p.id}</td>
            <td>{p.trade_id}</td>
            <td>{p.ticker}</td>
            <td><span class="badge {side_class}">{p.side}</span></td>
            <td><span class="badge status-{p.status.lower()}">{p.status}</span></td>
            <td>{p.qty_open}/{p.qty_total}</td>
            <td>{p.entry_price if p.entry_price is not None else "-"}</td>
            <td>{p.stop_price if p.stop_price is not None else "-"}</td>
            <td>{p.exit_reason or "-"}</td>
            <td>{p.updated_at}</td>
        </tr>
        """

    active_rows = "".join(_pos_row(p) for p in active_positions)
    closed_rows = "".join(_pos_row(p) for p in closed_positions)

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
                <div class="sub">Stateful webhook engine — Phase 2 (positions + state machine).</div>

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
                        <div class="card-label">Endpoint</div>
                        <div class="card-value" style="font-size:16px;">/api/webhook/trade-engine</div>
                    </div>
                </div>
            </div>

            <div class="panel">
                <div class="panel-head">
                    <div class="panel-title">Active Positions</div>
                    <div class="hint">PENDING · OPEN · PARTIAL</div>
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
                </div>
            </div>
        </div>
    </body>
    </html>
    """

    return HTMLResponse(content=html)


@app.post("/api/webhook/trade-engine")
def webhook(data: TradeEngineWebhook, db: Session = Depends(get_db)):
    if data.key != os.getenv("USER_KEY", "trading123"):
        raise HTTPException(status_code=401, detail="Invalid webhook key")

    # ---- Phase 1: duplicate protection ----------------------------------
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

    # ---- Phase 2: stateful execution ------------------------------------
    # The executor reads + mutates the Position row in this session. We
    # commit signal + position together at the end so a single transaction
    # represents the whole event.
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
        "exit_reason": p.exit_reason,
        "created_at": p.created_at,
        "updated_at": p.updated_at,
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
