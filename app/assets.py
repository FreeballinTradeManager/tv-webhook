"""
Asset registry for futures contracts the engine supports.

Used by the locked-PnL calculation and (later) the Tradovate adapter.

Point values match TM_Compact_20.80.pine asset presets. MNG point value is
documented as $1000 in the Pine but the user has flagged it may actually be
$2500 — left at preset value pending verification.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Asset:
    root: str
    point_value: float   # USD per 1.0 point
    tick_size: float


ASSETS: dict[str, Asset] = {
    a.root: a for a in [
        Asset("MNQ", 2.0,    0.25),
        Asset("NQ",  20.0,   0.25),
        Asset("MES", 5.0,    0.25),
        Asset("ES",  50.0,   0.25),
        Asset("M2K", 5.0,    0.10),
        Asset("RTY", 50.0,   0.10),
        Asset("MYM", 0.50,   1.0),
        Asset("YM",  5.0,    1.0),
        Asset("MGC", 10.0,   0.10),
        Asset("GC",  100.0,  0.10),
        Asset("CL",  1000.0, 0.01),
        Asset("MNG", 1000.0, 0.001),  # TODO: verify vs $2500 (user memory note)
        Asset("NG",  10000.0,0.001),
    ]
}


_MONTH_CODES = set("FGHJKMNQUVXZ")


def asset_root(ticker: str | None) -> str:
    """Strip TradingView continuous-future suffix ('1!') and explicit month
    codes ('MNQM2026' -> 'MNQ') to get the registry key."""
    if not ticker:
        return ""
    t = ticker.upper().strip()
    if t.endswith("1!"):
        t = t[:-2]
    # Month-coded futures: <root><month_letter><4-digit-year>
    if len(t) >= 5 and t[-5] in _MONTH_CODES and t[-4:].isdigit():
        t = t[:-5]
    return t


def point_value(ticker: str | None) -> float | None:
    a = ASSETS.get(asset_root(ticker))
    return a.point_value if a else None


def locked_pnl(side: str | None, qty_open: int | None,
               entry_price: float | None, stop_price: float | None,
               ticker: str | None) -> float | None:
    """The if-stop-hits PnL on the currently-open size.

    Positive = locked profit (after a jump or BE).
    Negative = remaining risk if stop is hit.
    Returns None when we don't have enough info.
    """
    if not all([side, qty_open, entry_price is not None, stop_price is not None]):
        return None
    pv = point_value(ticker)
    if pv is None:
        return None
    sign = 1.0 if side.upper() == "LONG" else -1.0
    return round((stop_price - entry_price) * sign * qty_open * pv, 2)


def live_pnl(side: str | None, qty_open: int | None,
             entry_price: float | None, last_price: float | None,
             ticker: str | None) -> float | None:
    """Unrealized PnL at the current market price.

    Same shape as locked_pnl but uses last/mid price from the MD feed.
    Returns None when we have no quote (broker offline / not subscribed).
    """
    if not all([side, qty_open, entry_price is not None, last_price is not None]):
        return None
    pv = point_value(ticker)
    if pv is None:
        return None
    sign = 1.0 if side.upper() == "LONG" else -1.0
    return round((last_price - entry_price) * sign * qty_open * pv, 2)
