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
    trade_id = Column(String, nullable=True, index=True)
    event_id = Column(String, nullable=True, unique=True, index=True)


# ---------------------------------------------------------------------------
# Phase 2 / 2.5: position state machine
# ---------------------------------------------------------------------------

POSITION_STATES = ("PENDING", "OPEN", "PARTIAL", "CLOSED", "CANCELLED")


class Position(Base):
    __tablename__ = "positions"

    id = Column(Integer, primary_key=True, index=True)

    trade_id = Column(String, nullable=False, unique=True, index=True)

    ticker = Column(String, nullable=False)
    side = Column(String, nullable=False)  # LONG / SHORT

    qty_total = Column(Integer, nullable=False)
    qty_open = Column(Integer, nullable=False)

    entry_price = Column(Float, nullable=True)
    stop_price = Column(Float, nullable=True)

    status = Column(String, nullable=False, index=True)
    exit_reason = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Phase 2.5: full ENTRY snapshot — matches what TM v20.80 sends so the
    # server has the same bracket info as PMT. Used for display + later
    # broker reconciliation.
    tp1_px = Column(Float, nullable=True)
    tp1_qty = Column(Integer, nullable=True)
    tp2_px = Column(Float, nullable=True)
    tp2_qty = Column(Integer, nullable=True)
    tp3_px = Column(Float, nullable=True)
    tp3_qty = Column(Integer, nullable=True)
    runner_qty = Column(Integer, nullable=True)

    # Last reason the stop moved — BASE / BE(0%) / JUMP(TP1) / JUMP(TP2) /
    # JUMP(TP3) / SWING / TICKS / EMA+ATR / MASTER / RESYNC.
    stop_source = Column(String, nullable=True)

    # Phase 5b: which broker this position was placed on.
    # "simulated" / "tradovate" / "tradovate-demo" / "tradovate-live".
    broker = Column(String, nullable=True, index=True)
    # Broker-issued ids — needed to modify stops + close positions later.
    broker_order_id = Column(String, nullable=True)        # entry market order
    broker_stop_order_id = Column(String, nullable=True)   # bracket stop order
    # The price the broker actually filled the entry at (vs entry_price
    # which is Pine's expected price). May differ by slippage.
    avg_fill_price = Column(Float, nullable=True)
    # Realized PnL — populated when position closes, from broker fills.
    realized_pnl = Column(Float, nullable=True)
    # Non-empty string ⇒ most recent broker call failed; surface on
    # dashboard. Cleared on next successful broker call.
    broker_error = Column(String, nullable=True)


# ---------------------------------------------------------------------------
# Phase 2.5: stop-update ledger
# ---------------------------------------------------------------------------
# One row per STOP_UPDATE event. Lets the dashboard show a real-time stop
# ledger for each active position — every BE, jump, trail, drag re-sync,
# and master move is preserved with its source and timestamp.

class StopUpdate(Base):
    __tablename__ = "stop_updates"

    id = Column(Integer, primary_key=True, index=True)
    trade_id = Column(String, nullable=False, index=True)
    ticker = Column(String, nullable=False)
    side = Column(String, nullable=False)
    old_stop = Column(Float, nullable=True)
    new_stop = Column(Float, nullable=False)
    source = Column(String, nullable=True)   # BE / JUMP / TRAIL / RESYNC / etc.
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
