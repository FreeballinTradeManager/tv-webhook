from sqlalchemy import Column, Integer, String, DateTime, Text, Float, Boolean, ForeignKey, JSON
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
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

    # Phase 1.1: which account this position was placed on (fan-out).
    # NULL on legacy rows created before the accounts table existed —
    # those get treated as belonging to a default "unassigned" bucket
    # in the dashboard.
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True, index=True)
    # Which group's fan-out spawned this Position (e.g. "MainGroup").
    # NULL when the signal wasn't routed through a group.
    group_name = Column(String, nullable=True, index=True)

    # Phase 2.1b: Base44 Trade shape fields. Migration adds these columns to
    # existing DBs; the ORM class exposes them so /api/trades can read/write.
    # Legacy rows have NULL — endpoint handles that.
    direction = Column(String, nullable=True)            # "long" / "short" — parallel to `side` (LONG/SHORT)
    pips = Column(Float, nullable=True)
    session = Column(String, nullable=True, index=True)  # london / new_york / asian / daily
    lot_size = Column(Float, nullable=True)
    risk_percentage = Column(Float, nullable=True)
    risk_amount = Column(Float, nullable=True)
    entry_time = Column(DateTime(timezone=True), nullable=True)
    exit_time = Column(DateTime(timezone=True), nullable=True)
    strategy_id = Column(Integer, ForeignKey("strategies.id", ondelete="SET NULL"), nullable=True, index=True)
    trailing_stop_used = Column(Boolean, nullable=False, default=False)
    trailing_stop_distance = Column(Float, nullable=True)
    notes = Column(Text, nullable=True)
    screenshot_url = Column(String, nullable=True)
    symbol_alias = Column(String, nullable=True)


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


# ---------------------------------------------------------------------------
# Phase 1.1: Accounts + Groups — multi-account fan-out
# ---------------------------------------------------------------------------
# One Account = one broker connection.
# One Group  = a fan-out target (master + slaves logically — the "master"
#              concept lives at the copy service level, we just fan out to
#              every active member).
# One Position row per (trade_id, account_id).
#
# Signal arrives → look up group by name → for each active GroupMember,
# apply the group_member.multiplier, spawn a Position for that account,
# route to the account's broker adapter.

BROKER_KINDS = (
    "simulated",     # observability only, no real orders
    "pmt",           # PickMyTrade webhook
    "tradesyncer",   # TradeSyncer webhook
    "tradovate",     # direct Tradovate REST + WS (personal only)
    "mt5",           # MT5 bridge (self-hosted)
    "ibkr",          # Interactive Brokers Client Portal API
    "oanda",         # OANDA REST API
    "tradersport",   # TradersPost webhook
)


class Account(Base):
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)                  # display label, e.g. "Lucid 50K"
    broker = Column(String, nullable=False, index=True)    # BROKER_KINDS
    account_id = Column(String, nullable=True)             # broker-side account identifier
    env = Column(String, nullable=False, default="demo")   # "demo" | "live"

    # Per-account default sizing multiplier applied on fan-out. GroupMember
    # multiplier overrides this when the account is in a group.
    multiplier = Column(Float, nullable=False, default=1.0)

    # Blow-up protection. Server enforces: if realized_pnl for today on this
    # account <= -daily_loss_limit, subsequent orders are blocked until
    # reset. 0 = no limit.
    daily_loss_limit = Column(Float, nullable=False, default=0.0)

    # Toggles
    active = Column(Boolean, nullable=False, default=True)   # false = fully off
    paused = Column(Boolean, nullable=False, default=False)  # true = skip orders but keep tracking

    # Phase 1.2: rotation state machine.
    #   active  = currently in the fan-out rotation
    #   benched = ready to go, waiting on standby
    #   cooled  = hit win threshold, taken off rotation (banks profit)
    #   stopped = hit loss threshold, fully blocked until manual reset
    state = Column(String, nullable=False, default="active", index=True)

    # Phase 1.2: win/loss counters. Cycle = since last state change.
    # Today = since UTC midnight (reset by background task).
    wins_cycle = Column(Integer, nullable=False, default=0)
    losses_cycle = Column(Integer, nullable=False, default=0)
    wins_today = Column(Integer, nullable=False, default=0)
    losses_today = Column(Integer, nullable=False, default=0)
    # Cumulative realized $ PnL over the current cycle. Used with
    # Group.rotate_after_profit_$ to rotate an account off once it's
    # banked enough profit ("take money and run" style).
    pnl_cycle = Column(Float, nullable=False, default=0.0)
    pnl_today = Column(Float, nullable=False, default=0.0)

    # Broker-specific config (webhook URLs, tokens etc.). Kept as JSON so
    # each broker can carry different fields without schema churn.
    # Sensitive fields (tokens, passwords) are typically stored in Railway
    # env vars, not here — this JSON is for non-secret settings like
    # symbol maps and lot conversions.
    config = Column(JSON, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Task #71 + #72 + #151: per-account safety limits + time windows.
    # 0 = no limit (default). Checked in preflight_gate before entry.
    max_concurrent_positions = Column(Integer, nullable=False, default=0)
    max_trades_today = Column(Integer, nullable=False, default=0)
    # Per-account time windows — Big Risk 18:00-01:00 + 11:45-15:00 style.
    # JSON list of {start:"HH:MM", end:"HH:MM", tz:"America/New_York"}.
    # Cross-midnight supported. Complements Group.time_windows — both are
    # checked; entry blocked if either says "closed now".
    time_windows = Column(JSON, nullable=True)

    group_memberships = relationship(
        "GroupMember",
        back_populates="account",
        cascade="all, delete-orphan",
    )


class Group(Base):
    __tablename__ = "groups"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True, index=True)
    description = Column(Text, nullable=True)
    active = Column(Boolean, nullable=False, default=True)

    # Phase 1.2: rotation rules.
    # After N wins on an active member, that account moves to "cooled"
    # state and the next benched account takes its slot.
    # After N losses, member moves to "stopped".
    # min_active_count = keep at least this many active members if bench
    # has enough accounts.
    rotate_after_wins = Column(Integer, nullable=True)     # null = no win rotation
    rotate_after_losses = Column(Integer, nullable=True)   # null = no loss rotation
    rotate_after_profit = Column(Float, nullable=True)     # rotate when Account.pnl_cycle >= this $ amount
    rotate_after_loss_pnl = Column(Float, nullable=True)   # rotate when Account.pnl_cycle <= -this $ amount
    min_active_count = Column(Integer, nullable=False, default=1)

    # Phase 1.3: cascade to another group when this one is exhausted
    # (no more active members and no benched left to promote).
    # When set, the fan-out webhook will fall through to next_group_id
    # and auto-promote its benched members. Chains recursively.
    next_group_id = Column(Integer, ForeignKey("groups.id", ondelete="SET NULL"), nullable=True)

    # Task #69 + #151 + #152: time windows this group is allowed to trade in.
    # JSON array of {start: "HH:MM", end: "HH:MM", tz: "America/New_York"}.
    # Empty/null = always tradeable. Example for Big Risk group:
    #   [{"start":"18:00","end":"01:00","tz":"America/New_York"},
    #    {"start":"11:45","end":"15:00","tz":"America/New_York"}]
    # Cross-midnight windows (18:00-01:00) are supported. Executor checks
    # current time in tz vs windows before firing entries.
    time_windows = Column(JSON, nullable=True)
    # Free-form label like "London Session" / "NY Session" / "Big Risk"
    schedule_label = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    members = relationship(
        "GroupMember",
        back_populates="group",
        cascade="all, delete-orphan",
    )


class GroupMember(Base):
    __tablename__ = "group_members"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("groups.id", ondelete="CASCADE"), nullable=False, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)

    # Override the account's default multiplier for this group. 1.0 = same.
    multiplier = Column(Float, nullable=False, default=1.0)
    # Execution priority. Lower first. 0 = default (executed in insertion order).
    priority = Column(Integer, nullable=False, default=0)

    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    group = relationship("Group", back_populates="members")
    account = relationship("Account", back_populates="group_memberships")


# ---------------------------------------------------------------------------
# Phase 2.1a: Strategy + Alert + UserSettings (Base44 entity parity)
# ---------------------------------------------------------------------------

class Strategy(Base):
    __tablename__ = "strategies"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    # Free-form entry rules. Rendered as pre-entry checklist on NewTrade
    # (task #76 setup playbook uses this same field).
    rules = Column(Text, nullable=True)
    timeframe = Column(String, nullable=False, default="15m")
    preferred_session = Column(String, nullable=True)
    # JSON array of preferred symbols
    preferred_pairs = Column(JSON, nullable=True)

    # Aggregate counters — updated on trade close, cheaper than
    # recomputing from positions table on every dashboard load
    win_rate = Column(Float, nullable=False, default=0.0)
    total_trades = Column(Integer, nullable=False, default=0)
    total_profit = Column(Float, nullable=False, default=0.0)
    is_active = Column(Boolean, nullable=False, default=True)

    # Task #119 + #120: strategy-scoped webhook URL binding.
    # Each strategy gets its own unique webhook slug — Pine alerts hit
    # /api/webhook/strategy/{webhook_slug}. Server looks up the strategy,
    # verifies its per-strategy webhook_key, then fans out into
    # default_group (which owns rotation across accounts).
    # This is what makes "one URL per Pine indicator" work.
    webhook_slug = Column(String, nullable=True, unique=True, index=True)
    webhook_key = Column(String, nullable=True)   # per-strategy auth
    # The Group this strategy fires into. NULL = strategy can only be
    # invoked via legacy group-based URLs, not strategy-scoped.
    default_group_id = Column(Integer, ForeignKey("groups.id", ondelete="SET NULL"),
                              nullable=True, index=True)

    # Task #127: per-strategy alert JSON template + broker format.
    # broker_format determines the shape of the JSON we suggest for
    # copy-paste into TradingView alerts:
    #   'futures'  → Tradovate/Rithmic style (contract symbols, qty in contracts)
    #   'mt5'      → MT4/5 style (volume in lots, symbol like EURUSD)
    #   'forex'    → forex/cfd style
    #   'stocks'   → equity brokers (Alpaca/IBKR)
    #   'crypto'   → crypto broker style
    # Switching this on a strategy lets you take the SAME Pine indicator
    # and reroute it from a Tradovate futures prop firm to an MT5 forex
    # prop firm without editing Pine — just regenerate the alert JSON.
    broker_format = Column(String, nullable=True, default="futures")
    # User-supplied alert JSON overrides the auto-generated template.
    # Stored as string (JSON with {placeholders}) so we don't have to
    # validate at write-time. Frontend copies this into TradingView.
    alert_json_template = Column(Text, nullable=True)
    # Free-form: 'What does this webhook do?' e.g.
    #   '6.24 base fires ENTRY on 3EMA cross + CD confirm.
    #    Runs on 5min MNQ. Fans out to group1_auto for Apex + Lucid rotation.'
    alert_description = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class TradeAlert(Base):
    """Price alerts — separate from webhook_signals which is the trade
    execution event stream. This table backs the Alerts page: user-created
    price watchers that trigger notifications (Discord/SMS/etc.)."""
    __tablename__ = "trade_alerts"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, nullable=False, index=True)
    # "price" / "tp_hit" / "sl_hit" / "breakout" / "daily_level"
    alert_type = Column(String, nullable=False)
    target_price = Column(Float, nullable=True)
    message = Column(Text, nullable=True)

    is_triggered = Column(Boolean, nullable=False, default=False)
    triggered_at = Column(DateTime(timezone=True), nullable=True)

    notify_sound = Column(Boolean, nullable=False, default=True)
    notify_email = Column(Boolean, nullable=False, default=False)
    is_active = Column(Boolean, nullable=False, default=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class VaultEntry(Base):
    """Task #148: encrypted password vault. Stores prop firm portal
    credentials, broker web logins, TradingView passwords, etc. so
    the trader doesn't have to jump between password managers.

    Passwords are Fernet-encrypted at rest using VAULT_KEY env var.
    List endpoints NEVER return the decrypted password — only masked
    metadata. Explicit /reveal endpoint returns plaintext (requires
    admin key).
    """
    __tablename__ = "vault_entries"

    id = Column(Integer, primary_key=True, index=True)
    label = Column(String, nullable=False)                 # "FTMO 100K Challenge"
    category = Column(String, nullable=False, default="prop_firm")
    # prop_firm / broker / tradingview / exchange / email / other
    url = Column(String, nullable=True)                    # https://ftmo.com/login
    username = Column(String, nullable=True)
    encrypted_password = Column(Text, nullable=True)       # Fernet ciphertext
    notes = Column(Text, nullable=True)                    # 2FA method, security Qs, etc.
    is_favorite = Column(Boolean, nullable=False, default=False)

    # Which broker + account this vault entry powers (optional link).
    # Lets us surface the right login on an Account card.
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)

    last_used_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class Goal(Base):
    """User-defined profit target. Powers Dashboard hero progress bars.
    Task #51 — 'Hit $500 today' style goals.

    Scope: daily / weekly / monthly / cycle. account_id NULL = "any account".
    Progress is computed live in /api/goals from account.pnl_today for daily,
    or from positions.realized_pnl summed over the period."""
    __tablename__ = "goals"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)                    # display label
    period = Column(String, nullable=False, default="daily") # daily / weekly / monthly / cycle
    target_amount = Column(Float, nullable=False)            # $ target
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=True, index=True)
    strategy_id = Column(Integer, ForeignKey("strategies.id", ondelete="CASCADE"), nullable=True, index=True)

    # Trader can mark a goal met + celebrate; the flag persists until reset
    # so the win popup doesn't fire twice.
    is_met = Column(Boolean, nullable=False, default=False)
    met_at = Column(DateTime(timezone=True), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)

    # Notification thresholds — Discord/SMS/etc. fire once per threshold crossing
    notified_50 = Column(Boolean, nullable=False, default=False)
    notified_80 = Column(Boolean, nullable=False, default=False)
    notified_100 = Column(Boolean, nullable=False, default=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class UserSettings(Base):
    """Singleton row (id=1) holding this user's preferences.
    Base44 Settings page reads/writes this via /api/user/me."""
    __tablename__ = "user_settings"

    id = Column(Integer, primary_key=True, index=True)

    # Notification toggles — Base44 had: london_automation, ny_orb_strategy,
    # daily_levels, support_community, enable_ai
    notification_settings = Column(JSON, nullable=True)
    # Alert config toggles — tp_hit, loss_alert, guardian_lock
    alert_configuration = Column(JSON, nullable=True)
    # Trader response popup config — win_popup: gold/grey, loss_popup: motivational/ai_advice
    trader_response = Column(JSON, nullable=True)
    # Task #43: Global Kill Switch. When on, executor rejects ALL entries
    # across every account/group/strategy. Trader flips this in an
    # emergency ("something's wrong — stop trading immediately").
    # Reset requires explicit action (POST /api/kill-switch { on: false }).
    kill_switch_on = Column(Boolean, nullable=False, default=False)
    kill_switch_triggered_at = Column(DateTime(timezone=True), nullable=True)
    kill_switch_reason = Column(String, nullable=True)

    # UI customization
    desktop_header_text = Column(String, nullable=True, default="TradeCore")
    # Trader's first name — used in personalized dashboard greeting.
    # "Let's bank some coin, {trader_name}! Stick to your rules."
    trader_name = Column(String, nullable=True)
    # Personal trading rules — JSON array of strings. Displayed as a
    # daily-reset checklist on the Dashboard so the trader commits to
    # their playbook before opening the first position.
    #   e.g. ["No revenge trades", "Max 3 trades/day", "Stop by 2pm ET",
    #         "Only trade with the trend", "Journal every trade"]
    trading_rules = Column(JSON, nullable=True)
    # Trader-configurable welcome message. Default: "Let's bank some
    # coin {name}!! Stick to your rules". {name} placeholder replaced
    # with trader_name at render time.
    welcome_message = Column(String, nullable=True,
                             default="Let's bank some coin {name}!! Stick to your rules")

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
