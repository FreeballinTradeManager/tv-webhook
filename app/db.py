import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL is missing")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    connect_args={"sslmode": "require"}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Lightweight migrations
# ---------------------------------------------------------------------------
# We don't use Alembic yet. To keep the live DB in sync with model changes we
# run idempotent ALTERs on startup. Each statement uses IF NOT EXISTS so it's
# safe to run on every boot.
#
# When adding a new column or index, append another statement here.
# ---------------------------------------------------------------------------
MIGRATIONS = [
    # Phase 1: duplicate protection columns on webhook_signals
    "ALTER TABLE webhook_signals ADD COLUMN IF NOT EXISTS trade_id TEXT",
    "ALTER TABLE webhook_signals ADD COLUMN IF NOT EXISTS event_id TEXT",
    "CREATE INDEX IF NOT EXISTS ix_webhook_signals_trade_id ON webhook_signals (trade_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_webhook_signals_event_id ON webhook_signals (event_id)",

    # Phase 2.5: ENTRY snapshot + stop source on positions.
    # (positions table itself is created by Base.metadata.create_all in Phase 2.)
    "ALTER TABLE positions ADD COLUMN IF NOT EXISTS tp1_px DOUBLE PRECISION",
    "ALTER TABLE positions ADD COLUMN IF NOT EXISTS tp1_qty INTEGER",
    "ALTER TABLE positions ADD COLUMN IF NOT EXISTS tp2_px DOUBLE PRECISION",
    "ALTER TABLE positions ADD COLUMN IF NOT EXISTS tp2_qty INTEGER",
    "ALTER TABLE positions ADD COLUMN IF NOT EXISTS tp3_px DOUBLE PRECISION",
    "ALTER TABLE positions ADD COLUMN IF NOT EXISTS tp3_qty INTEGER",
    "ALTER TABLE positions ADD COLUMN IF NOT EXISTS runner_qty INTEGER",
    "ALTER TABLE positions ADD COLUMN IF NOT EXISTS stop_source TEXT",

    # Phase 5b: broker integration columns.
    "ALTER TABLE positions ADD COLUMN IF NOT EXISTS broker TEXT",
    "ALTER TABLE positions ADD COLUMN IF NOT EXISTS broker_order_id TEXT",
    "ALTER TABLE positions ADD COLUMN IF NOT EXISTS broker_stop_order_id TEXT",
    "ALTER TABLE positions ADD COLUMN IF NOT EXISTS avg_fill_price DOUBLE PRECISION",
    "ALTER TABLE positions ADD COLUMN IF NOT EXISTS realized_pnl DOUBLE PRECISION",
    "ALTER TABLE positions ADD COLUMN IF NOT EXISTS broker_error TEXT",
    "CREATE INDEX IF NOT EXISTS ix_positions_broker ON positions (broker)",
]


def run_migrations() -> None:
    """Apply idempotent ALTER/CREATE statements. Safe on every boot."""
    # Make sure the base table exists at all (no-op if already there).
    Base.metadata.create_all(bind=engine)

    with engine.begin() as conn:
        for stmt in MIGRATIONS:
            conn.execute(text(stmt))
