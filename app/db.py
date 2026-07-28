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

    # Phase 1.1: multi-account fan-out.
    # accounts / groups / group_members tables created by Base.metadata.create_all.
    # Position now carries account_id (nullable — legacy rows stay NULL) +
    # group_name (which group's fan-out spawned this position, if any).
    "ALTER TABLE positions ADD COLUMN IF NOT EXISTS account_id INTEGER",
    "ALTER TABLE positions ADD COLUMN IF NOT EXISTS group_name TEXT",
    "CREATE INDEX IF NOT EXISTS ix_positions_account_id ON positions (account_id)",
    "CREATE INDEX IF NOT EXISTS ix_positions_group_name ON positions (group_name)",

    # Phase 1.2: rotation state machine + counters.
    "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'active'",
    "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS wins_cycle INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS losses_cycle INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS wins_today INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS losses_today INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS pnl_cycle DOUBLE PRECISION NOT NULL DEFAULT 0",
    "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS pnl_today DOUBLE PRECISION NOT NULL DEFAULT 0",
    "CREATE INDEX IF NOT EXISTS ix_accounts_state ON accounts (state)",
    "ALTER TABLE groups ADD COLUMN IF NOT EXISTS rotate_after_wins INTEGER",
    "ALTER TABLE groups ADD COLUMN IF NOT EXISTS rotate_after_losses INTEGER",
    "ALTER TABLE groups ADD COLUMN IF NOT EXISTS rotate_after_profit DOUBLE PRECISION",
    "ALTER TABLE groups ADD COLUMN IF NOT EXISTS rotate_after_loss_pnl DOUBLE PRECISION",
    "ALTER TABLE groups ADD COLUMN IF NOT EXISTS min_active_count INTEGER NOT NULL DEFAULT 1",

    # Phase 1.3: group cascade — when group is exhausted, fall through to next.
    "ALTER TABLE groups ADD COLUMN IF NOT EXISTS next_group_id INTEGER",
    """
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'groups_next_group_id_fkey'
        ) THEN
            ALTER TABLE groups
                ADD CONSTRAINT groups_next_group_id_fkey
                FOREIGN KEY (next_group_id) REFERENCES groups(id) ON DELETE SET NULL
                NOT VALID;
        END IF;
    END $$;
    """,
    # Foreign key added separately with NOT VALID so it never blocks
    # startup even if there are orphaned rows. Postgres validates lazily.
    # Wrapped in DO block for idempotency (Postgres doesn't have
    # ADD CONSTRAINT IF NOT EXISTS for foreign keys before v18).
    """
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'positions_account_id_fkey'
        ) THEN
            ALTER TABLE positions
                ADD CONSTRAINT positions_account_id_fkey
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
                NOT VALID;
        END IF;
    END $$;
    """,

    # Phase 2.1a: Base44 entity parity — strategies / trade_alerts /
    # user_settings tables are auto-created by Base.metadata.create_all.
    # Seed a singleton user_settings row so /api/user/me always resolves.
    """
    INSERT INTO user_settings (id, notification_settings, alert_configuration, trader_response, desktop_header_text)
    VALUES (1, '{}'::json, '{}'::json, '{}'::json, 'TradeCore')
    ON CONFLICT (id) DO NOTHING
    """,

    # Phase 2 task #51: Goals table auto-created by Base.metadata.create_all.
    # Nothing to seed — starts empty; user creates their own targets.

    # Personal touch — add name + rules columns to existing user_settings row.
    "ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS trader_name TEXT",
    "ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS trading_rules JSON",
    "ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS welcome_message TEXT",

    # Task #119 + #120: strategy-scoped webhooks + group binding.
    "ALTER TABLE strategies ADD COLUMN IF NOT EXISTS webhook_slug TEXT",
    "ALTER TABLE strategies ADD COLUMN IF NOT EXISTS webhook_key TEXT",
    "ALTER TABLE strategies ADD COLUMN IF NOT EXISTS default_group_id INTEGER",
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_strategies_webhook_slug ON strategies (webhook_slug) WHERE webhook_slug IS NOT NULL",

    # Task #127: alert JSON template + broker format per strategy.
    "ALTER TABLE strategies ADD COLUMN IF NOT EXISTS broker_format TEXT DEFAULT 'futures'",
    "ALTER TABLE strategies ADD COLUMN IF NOT EXISTS alert_json_template TEXT",
    "ALTER TABLE strategies ADD COLUMN IF NOT EXISTS alert_description TEXT",

    # Task #148: password vault table auto-created by Base.metadata.create_all.
    # Nothing to seed.

    # Tasks #69 + #151 + #152: group time windows for session scheduling
    "ALTER TABLE groups ADD COLUMN IF NOT EXISTS time_windows JSON",
    "ALTER TABLE groups ADD COLUMN IF NOT EXISTS schedule_label TEXT",

    # Task #43: Global Kill Switch — on the user_settings singleton
    "ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS kill_switch_on BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS kill_switch_triggered_at TIMESTAMPTZ",
    "ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS kill_switch_reason TEXT",

    # Tasks #71 + #72 + #151: per-account safety limits + time windows
    "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS max_concurrent_positions INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS max_trades_today INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS time_windows JSON",

    # Phase 2.1b: extend positions with Base44 Trade shape fields so we can
    # serve /api/trades from the same table. Nullable — legacy positions
    # keep working.
    "ALTER TABLE positions ADD COLUMN IF NOT EXISTS symbol_alias TEXT",
    "ALTER TABLE positions ADD COLUMN IF NOT EXISTS direction TEXT",
    "ALTER TABLE positions ADD COLUMN IF NOT EXISTS pips DOUBLE PRECISION",
    "ALTER TABLE positions ADD COLUMN IF NOT EXISTS session TEXT",
    "ALTER TABLE positions ADD COLUMN IF NOT EXISTS lot_size DOUBLE PRECISION",
    "ALTER TABLE positions ADD COLUMN IF NOT EXISTS risk_percentage DOUBLE PRECISION",
    "ALTER TABLE positions ADD COLUMN IF NOT EXISTS risk_amount DOUBLE PRECISION",
    "ALTER TABLE positions ADD COLUMN IF NOT EXISTS entry_time TIMESTAMPTZ",
    "ALTER TABLE positions ADD COLUMN IF NOT EXISTS exit_time TIMESTAMPTZ",
    "ALTER TABLE positions ADD COLUMN IF NOT EXISTS strategy_id INTEGER",
    "ALTER TABLE positions ADD COLUMN IF NOT EXISTS trailing_stop_used BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE positions ADD COLUMN IF NOT EXISTS trailing_stop_distance DOUBLE PRECISION",
    "ALTER TABLE positions ADD COLUMN IF NOT EXISTS notes TEXT",
    "ALTER TABLE positions ADD COLUMN IF NOT EXISTS screenshot_url TEXT",
    "CREATE INDEX IF NOT EXISTS ix_positions_strategy_id ON positions (strategy_id)",
    "CREATE INDEX IF NOT EXISTS ix_positions_session ON positions (session)",
]


def run_migrations() -> None:
    """Apply idempotent ALTER/CREATE statements. Safe on every boot."""
    # Make sure the base table exists at all (no-op if already there).
    Base.metadata.create_all(bind=engine)

    with engine.begin() as conn:
        for stmt in MIGRATIONS:
            conn.execute(text(stmt))
