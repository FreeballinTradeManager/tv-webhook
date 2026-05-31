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
    # Phase 1: duplicate protection columns
    "ALTER TABLE webhook_signals ADD COLUMN IF NOT EXISTS trade_id TEXT",
    "ALTER TABLE webhook_signals ADD COLUMN IF NOT EXISTS event_id TEXT",
    "CREATE INDEX IF NOT EXISTS ix_webhook_signals_trade_id ON webhook_signals (trade_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_webhook_signals_event_id ON webhook_signals (event_id)",
]


def run_migrations() -> None:
    """Apply idempotent ALTER/CREATE statements. Safe on every boot."""
    # Make sure the base table exists at all (no-op if already there).
    Base.metadata.create_all(bind=engine)

    with engine.begin() as conn:
        for stmt in MIGRATIONS:
            conn.execute(text(stmt))
