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
from .models import WebhookSignal
from .executor import execute_trade

app = FastAPI()


@app.on_event("startup")
def on_startup() -> None:
    # Idempotent: creates table if missing, adds new columns if missing.
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


@app.get("/")
def root():
    return {"status": "running"}


@app.get("/dashboard", response_class=HTMLResponse)
def dashboard(db: Session = Depends(get_db)):
    signals = db.query(WebhookSignal).order_by(WebhookSignal.id.desc()).limit(50).all()

    rows = ""
    for s in signals:
        status_class = "status-default"
        event_upper = (s.event or "").upper()

        execution_action = ""
        try:
            payload = json.loads(s.raw_payload) if s.raw_payload else {}
            execution = payload.get("execution", {})
            execution_action = execution.get("action", "")
        except Exception:
            execution_action = ""

        if event_upper == "ENTRY":
            status_class = "status-entry"
        elif "STOP" in event_upper:
            status_class = "status-stop"
        elif "TP" in event_upper:
            status_class = "status-tp"
        elif "CLOSE" in event_upper or "MASTER" in event_upper:
            status_class = "status-close"

        rows += f"""
        <tr>
            <td>{s.id}</td>
            <td><span class="badge {status_class}">{s.event}</span></td>
            <td>{s.ticker}</td>
            <td>{s.side}</td>
            <td>{s.qty}</td>
            <td>{execution_action or "-"}</td>
            <td>{s.trade_id or "-"}</td>
            <td>{s.event_id or "-"}</td>
            <td>{s.created_at}</td>
        </tr>
        """

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
                max-width: 1200px;
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
            h1 {{
                margin: 0 0 8px 0;
                font-size: 32px;
            }}
            .sub {{
                color: #9fb0d3;
                font-size: 14px;
            }}
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
            }}
            .panel-head {{
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 16px;
            }}
            .panel-title {{
                font-size: 22px;
                font-weight: 700;
            }}
            .hint {{
                color: #8ea0c9;
                font-size: 13px;
            }}
            table {{
                width: 100%;
                border-collapse: collapse;
                overflow: hidden;
            }}
            th, td {{
                text-align: left;
                padding: 14px 12px;
                border-bottom: 1px solid rgba(255,255,255,0.08);
                font-size: 14px;
            }}
            th {{
                color: #8ea0c9;
                font-size: 12px;
                text-transform: uppercase;
                letter-spacing: 0.14em;
            }}
            tr:hover {{
                background: rgba(255,255,255,0.03);
            }}
            .badge {{
                display: inline-block;
                padding: 6px 10px;
                border-radius: 999px;
                font-size: 12px;
                font-weight: 700;
            }}
            .status-entry {{
                background: rgba(59,130,246,0.18);
                color: #93c5fd;
            }}
            .status-stop {{
                background: rgba(239,68,68,0.18);
                color: #fca5a5;
            }}
            .status-tp {{
                background: rgba(34,197,94,0.18);
                color: #86efac;
            }}
            .status-close {{
                background: rgba(168,85,247,0.18);
                color: #d8b4fe;
            }}
            .status-default {{
                background: rgba(148,163,184,0.18);
                color: #cbd5e1;
            }}
            .footer-links {{
                margin-top: 18px;
                display: flex;
                gap: 12px;
                flex-wrap: wrap;
            }}
            .footer-links a {{
                color: #c7d2fe;
                text-decoration: none;
                background: rgba(255,255,255,0.05);
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 999px;
                padding: 10px 14px;
                font-size: 13px;
            }}
            .empty {{
                color: #8ea0c9;
                padding: 22px 0 8px 0;
            }}
        </style>
    </head>
    <body>
        <div class="wrap">
            <div class="hero">
                <div class="eyebrow">Freeballin</div>
                <h1>Trade Engine Dashboard</h1>
                <div class="sub">Simple Python dashboard for live webhook signals.</div>

                <div class="stats">
                    <div class="card">
                        <div class="card-label">Signals Logged</div>
                        <div class="card-value">{len(signals)}</div>
                    </div>
                    <div class="card">
                        <div class="card-label">Webhook</div>
                        <div class="card-value" style="font-size:18px;">Live</div>
                    </div>
                    <div class="card">
                        <div class="card-label">Endpoint</div>
                        <div class="card-value" style="font-size:18px;">/api/webhook/trade-engine</div>
                    </div>
                </div>
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
                            <th>Execution</th>
                            <th>Trade ID</th>
                            <th>Event ID</th>
                            <th>Time</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows}
                    </tbody>
                </table>
                ''' if signals else '<div class="empty">No signals yet. Trigger a TradingView alert and refresh this page.</div>'}

                <div class="footer-links">
                    <a href="/docs">API Docs</a>
                    <a href="/api/signals">Raw Signals JSON</a>
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
    # If the payload carries an event_id, check whether we've already saved
    # one with the same value. If so, do NOT execute again — just return a
    # duplicate_ignored response that includes the original row id so the
    # caller can reconcile.
    #
    # Payloads without event_id still flow through (backward-compatible) but
    # get no dup protection. TradingView/Pine should be updated to send
    # event_id on every event.
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

    execution_result = execute_trade(data)

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
        # Race condition: two webhooks with the same event_id hit at once.
        # The unique index on event_id rejected the second one. Treat it as
        # a duplicate.
        db.rollback()
        existing = (
            db.query(WebhookSignal)
            .filter(WebhookSignal.event_id == data.event_id)
            .first()
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
