from sqlalchemy import Column, Integer, String, DateTime, Text, Float
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


# ---------------------------------------------------------------------------
# Phase 2: position state machine
# ---------------------------------------------------------------------------
# One row per trade_id. Tracks the lifecycle so the server can reject late or
# duplicate TP/stop/close events on already-closed positions.
#
# States:
#   PENDING    — created but not yet filled (reserved for future use)
#   OPEN       — entry executed, no TPs hit yet, full qty live
#   PARTIAL    — at least one TP/CLOSE50 hit, qty_open > 0
#   CLOSED     — qty_open == 0 (all TPs hit OR master close OR stop hit)
#   CANCELLED  — explicitly cancelled before fill (reserved for future use)
# ---------------------------------------------------------------------------

POSITION_STATES = ("PENDING", "OPEN", "PARTIAL", "CLOSED", "CANCELLED")


class Position(Base):
    __tablename__ = "positions"

    id = Column(Integer, primary_key=True, index=True)

    # Unique per trade. Indexed for fast lookup on every webhook.
    trade_id = Column(String, nullable=False, unique=True, index=True)

    ticker = Column(String, nullable=False)
    side = Column(String, nullable=False)  # LONG / SHORT

    qty_total = Column(Integer, nullable=False)   # original entry qty
    qty_open = Column(Integer, nullable=False)    # currently live qty

    entry_price = Column(Float, nullable=True)
    stop_price = Column(Float, nullable=True)

    status = Column(String, nullable=False, index=True)  # one of POSITION_STATES

    # When closed, store why (master_close / stop_hit / ema_exit / close_fallback / all_tps_filled)
    exit_reason = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
