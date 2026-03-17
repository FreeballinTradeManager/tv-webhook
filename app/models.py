from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from datetime import datetime
from .db import Base

class WebhookSignal(Base):
    __tablename__ = "webhook_signals"

    id = Column(Integer, primary_key=True, index=True)
    event = Column(String, nullable=False)
    ticker = Column(String, nullable=False)
    side = Column(String, nullable=False)
    qty = Column(Integer, nullable=False)
    key = Column(String, nullable=False)
    raw_payload = Column(JSONB, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
