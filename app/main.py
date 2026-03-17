import os
import json
from fastapi import FastAPI, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .db import get_db
from .models import WebhookSignal
from .executor import execute_trade  # ✅ NEW

app = FastAPI()


# -----------------------------
# REQUEST MODEL
# -----------------------------
class TradeEngineWebhook(BaseModel):
    event: str
    ticker: str
    side: str
    qty: int
    key: str


# -----------------------------
# ROOT
# -----------------------------
@app.get("/")
def root():
    return {"status": "running"}


# -----------------------------
# DASHBOARD
# -----------------------------
@app.get("/dashboard", response_class=HTMLResponse)
def dashboard(db: Session = Depends(get_db)):
    signals = db.query(WebhookSignal).order_by(WebhookSignal.id.desc()).limit(50).all()

    rows = ""
    for s in signals:
        status_class = "status-default"
        event_upper = (s.event or "").upper()

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
            <td>{s.created_at}</td>
        </tr>
        """

    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>Trade Engine Dashboard</title>
        <style>
            body {{
                font-family: Arial;
                background: #0b1020;
                color: white;
                padding: 20px;
            }}
            table {{
                width: 100%;
                border-collapse: collapse;
            }}
            th, td {{
                padding: 10px;
                border-bottom: 1px solid #333;
            }}
            .badge {{
                padding: 5px 10px;
                border-radius: 10px;
            }}
            .status-entry {{ background: blue; }}
            .status-stop {{ background: red; }}
            .status-tp {{ background: green; }}
            .status-close {{ background: purple; }}
        </style>
    </head>
    <body>
        <h1>Trade Engine Dashboard</h1>
        <p>Total Signals: {len(signals)}</p>

        <table>
            <tr>
                <th>ID</th>
                <th>Event</th>
                <th>Ticker</th>
                <th>Side</th>
                <th>Qty</th>
                <th>Time</th>
            </tr>
            {rows}
        </table>
    </body>
    </html>
    """

    return HTMLResponse(content=html)


# -----------------------------
# WEBHOOK (MAIN ENGINE 🔥)
# -----------------------------
@app.post("/api/webhook/trade-engine")
def webhook(data: TradeEngineWebhook, db: Session = Depends(get_db)):
    # 🔐 SECURITY
    if data.key != os.getenv("USER_KEY", "trading123"):
        raise HTTPException(status_code=401, detail="Invalid webhook key")

    # 💾 SAVE SIGNAL
    signal = WebhookSignal(
        event=data.event,
        ticker=data.ticker,
        side=data.side,
        qty=data.qty,
        key=data.key,
        raw_payload=json.dumps(data.model_dump())
    )

    db.add(signal)
    db.commit()
    db.refresh(signal)

    # ⚡ EXECUTE (NEW 🔥)
    execution_result = execute_trade(signal)

    # 📤 RESPONSE
    return {
        "message": "webhook saved",
        "id": signal.id,
        "event": signal.event,
        "ticker": signal.ticker,
        "execution": execution_result
    }


# -----------------------------
# SIGNALS API
# -----------------------------
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
            "created_at": s.created_at,
        }
        for s in signals
    ]
