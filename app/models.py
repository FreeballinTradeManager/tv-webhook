from sqlalchemy import Column, Integer, String, DateTime, Text, Index
from sqlalchemy.sql import func
from .db import Base


class WebhookSignal(Base):
    __tablename__ = "webhook_signals"

    id = Column(Integer, primary_key=True, index=True)
    event = Column(String, nullable=False)
    ticker = Column(String, nullable=False)
    side = Column(String, nullable=False)
    qty = Column(Integer, nullable=False)
    key = Column(String, nullable=False)
    raw_payload = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Phase 1: duplicate protection
    # Nullable so historical rows + payloads without these fields still work.
    # event_id is UNIQUE so DB enforces dedup as a safety net even if app logic is bypassed.
    trade_id = Column(String, nullable=True, index=True)
    event_id = Column(String, nullable=True, unique=True, index=True)
