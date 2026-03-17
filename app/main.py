from fastapi import FastAPI, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .db import Base, engine, get_db
from .models import WebhookSignal

app = FastAPI()

Base.metadata.create_all(bind=engine)


class TradeEngineWebhook(BaseModel):
    event: str
    ticker: str
    side: str
    qty: int
    key: str


@app.get("/")
def root():
    return {"status": "running"}


@app.post("/api/webhook/trade-engine")
def webhook(data: TradeEngineWebhook, db: Session = Depends(get_db)):
    if data.key != "trading123":
        raise HTTPException(status_code=401, detail="Invalid webhook key")

    signal = WebhookSignal(
        event=data.event,
        ticker=data.ticker,
        side=data.side,
        qty=data.qty,
        key=data.key,
        raw_payload=data.model_dump()
    )

    db.add(signal)
    db.commit()
    db.refresh(signal)

    return {
        "message": "webhook saved",
        "id": signal.id,
        "event": signal.event,
        "ticker": signal.ticker
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
            "created_at": s.created_at,
        }
        for s in signals
    ]
