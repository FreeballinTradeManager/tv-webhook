"""
Tradovate REST client.

Docs: https://api.tradovate.com/

Auth flow:
    POST /auth/accesstokenrequest
        body: {name, password, appId, appVersion, cid, sec}
        response: {accessToken, expirationTime, userId, name, hasLive, ...}
    Access token is a JWT, lifetime ~80 minutes. We cache it and
    refresh on 401 or before expiry.

Environment selection: env var TRADOVATE_ENV in ("demo","live"),
defaults to "demo". URLs:
    Demo: https://demo.tradovateapi.com/v1
    Live: https://live.tradovateapi.com/v1

Contracts: Tradovate orders require a contractId, not a symbol string.
We resolve front-month contracts via GET /contract/suggest?t=<root>&l=10
(returns a list, we pick the active front month) and cache the result
for 12h.

Orders:
    POST /order/placeorder
        body: {accountSpec, accountId, action, symbol, orderQty,
               orderType, isAutomated, ...}
        action: "Buy" | "Sell"
        orderType: "Market" | "Stop" | "Limit" | "StopLimit"

Modify stop: POST /order/modifyorder with orderId + new stopPrice.

Cancel: POST /order/cancelorder with orderId.

Get positions: GET /position/list (filtered to active account).

This module is sync (httpx.Client). It's called from the sync executor
in main.py; calls take 50–200ms which is fine inline with the webhook
handler.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Optional

import httpx


log = logging.getLogger("tv-webhook.tradovate")


DEMO_REST = "https://demo.tradovateapi.com/v1"
LIVE_REST = "https://live.tradovateapi.com/v1"
DEMO_MD_WS = "wss://md-demo.tradovateapi.com/v1/websocket"
LIVE_MD_WS = "wss://md.tradovateapi.com/v1/websocket"

# A safety margin before the access token actually expires. Tradovate
# tokens last ~80 min; we refresh 5 minutes before expiry to avoid
# in-flight 401s on long-running webhook bursts.
TOKEN_REFRESH_BUFFER_SECONDS = 300


class TradovateError(Exception):
    pass


@dataclass
class _Token:
    access_token: str
    expires_at: float          # epoch seconds
    user_id: int
    name: str
    has_live: bool


class TradovateClient:
    """Thin sync wrapper over Tradovate REST."""

    def __init__(
        self,
        *,
        username: Optional[str] = None,
        password: Optional[str] = None,
        cid: Optional[str] = None,
        secret: Optional[str] = None,
        env: Optional[str] = None,
        account_id: Optional[int] = None,
        app_id: str = "FreeballinTradeEngine",
        app_version: str = "1.0",
        timeout: float = 10.0,
    ) -> None:
        self.username = username or os.getenv("TRADOVATE_USERNAME", "")
        self.password = password or os.getenv("TRADOVATE_PASSWORD", "")
        self.cid = cid or os.getenv("TRADOVATE_CID", "")
        self.secret = secret or os.getenv("TRADOVATE_SECRET", "")
        self.env = (env or os.getenv("TRADOVATE_ENV") or "demo").lower()
        self.account_id_hint: Optional[int] = (
            account_id
            or (int(os.getenv("TRADOVATE_ACCOUNT_ID")) if os.getenv("TRADOVATE_ACCOUNT_ID") else None)
        )
        self.app_id = app_id
        self.app_version = app_version
        self.base = DEMO_REST if self.env == "demo" else LIVE_REST
        self.md_ws_url = DEMO_MD_WS if self.env == "demo" else LIVE_MD_WS

        self._token: Optional[_Token] = None
        self._account_id: Optional[int] = None
        self._account_spec: Optional[str] = None
        self._contract_cache: dict[str, tuple[int, float]] = {}  # root → (contractId, ts)
        self._http = httpx.Client(timeout=timeout)

    # ------------------------------------------------------------------
    # Auth
    # ------------------------------------------------------------------

    def _ensure_token(self, force: bool = False) -> _Token:
        t = self._token
        if t and not force and time.time() < t.expires_at - TOKEN_REFRESH_BUFFER_SECONDS:
            return t
        if not all([self.username, self.password, self.cid, self.secret]):
            raise TradovateError(
                "missing credentials — set TRADOVATE_USERNAME/PASSWORD/CID/SECRET env vars"
            )
        body = {
            "name": self.username,
            "password": self.password,
            "appId": self.app_id,
            "appVersion": self.app_version,
            "cid": self.cid,
            "sec": self.secret,
        }
        r = self._http.post(f"{self.base}/auth/accesstokenrequest", json=body)
        if r.status_code != 200:
            raise TradovateError(f"auth failed [{r.status_code}]: {r.text}")
        data = r.json()
        if "accessToken" not in data:
            raise TradovateError(f"auth response missing accessToken: {data}")
        # expirationTime is ISO 8601 string. We add the lifetime to "now"
        # as a fallback if parsing fails.
        try:
            from datetime import datetime
            expires_at = datetime.fromisoformat(data["expirationTime"].replace("Z", "+00:00")).timestamp()
        except Exception:
            expires_at = time.time() + 4500  # ~75min
        self._token = _Token(
            access_token=data["accessToken"],
            expires_at=expires_at,
            user_id=int(data.get("userId", 0)),
            name=str(data.get("name", "")),
            has_live=bool(data.get("hasLive", False)),
        )
        log.info("tradovate auth ok — user=%s env=%s expires_in=%ds",
                 self._token.name, self.env, int(expires_at - time.time()))
        return self._token

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._ensure_token().access_token}"}

    def _get(self, path: str, params: Optional[dict] = None) -> Any:
        r = self._http.get(f"{self.base}{path}", headers=self._headers(), params=params)
        if r.status_code == 401:
            self._ensure_token(force=True)
            r = self._http.get(f"{self.base}{path}", headers=self._headers(), params=params)
        if r.status_code != 200:
            raise TradovateError(f"GET {path} [{r.status_code}]: {r.text}")
        return r.json()

    def _post(self, path: str, body: dict) -> Any:
        r = self._http.post(f"{self.base}{path}", headers=self._headers(), json=body)
        if r.status_code == 401:
            self._ensure_token(force=True)
            r = self._http.post(f"{self.base}{path}", headers=self._headers(), json=body)
        if r.status_code != 200:
            raise TradovateError(f"POST {path} [{r.status_code}]: {r.text}")
        return r.json()

    # ------------------------------------------------------------------
    # Accounts
    # ------------------------------------------------------------------

    def _ensure_account(self) -> tuple[int, str]:
        """Pick the account to trade. Uses TRADOVATE_ACCOUNT_ID if set,
        otherwise the first account returned by /account/list."""
        if self._account_id is not None and self._account_spec is not None:
            return self._account_id, self._account_spec
        accounts = self._get("/account/list")
        if not accounts:
            raise TradovateError("no Tradovate accounts visible to this login")
        if self.account_id_hint:
            for a in accounts:
                if int(a.get("id", 0)) == self.account_id_hint:
                    chosen = a
                    break
            else:
                raise TradovateError(
                    f"TRADOVATE_ACCOUNT_ID={self.account_id_hint} not in account list "
                    f"({[a.get('id') for a in accounts]})"
                )
        else:
            chosen = accounts[0]
        self._account_id = int(chosen["id"])
        self._account_spec = str(chosen.get("name") or chosen.get("nickname") or chosen["id"])
        log.info("tradovate using account %s (id=%d)", self._account_spec, self._account_id)
        return self._account_id, self._account_spec

    # ------------------------------------------------------------------
    # Contracts
    # ------------------------------------------------------------------

    def find_contract_id(self, root: str) -> int:
        """Resolve 'MNQ' → numeric contractId of the current front-month
        contract. Cached for 12h per root."""
        root = root.upper()
        now = time.time()
        cached = self._contract_cache.get(root)
        if cached and now - cached[1] < 12 * 3600:
            return cached[0]
        # /contract/suggest returns a list of matching contracts ordered
        # roughly by relevance — front month first for futures roots.
        candidates = self._get("/contract/suggest", params={"t": root, "l": 10})
        if not candidates:
            raise TradovateError(f"no contracts for root '{root}'")
        # Filter to futures of this root, skip already-expired by checking
        # the symbol pattern. Tradovate returns dicts with 'id' and 'name'.
        for c in candidates:
            name = str(c.get("name", "")).upper()
            if name.startswith(root) and len(name) > len(root):
                cid = int(c["id"])
                self._contract_cache[root] = (cid, now)
                log.info("tradovate contract %s -> id=%d (%s)", root, cid, name)
                return cid
        # Fallback: first candidate.
        cid = int(candidates[0]["id"])
        self._contract_cache[root] = (cid, now)
        return cid

    # ------------------------------------------------------------------
    # Orders
    # ------------------------------------------------------------------

    def place_market_order(self, *, root: str, action: str, qty: int) -> dict[str, Any]:
        """action = 'Buy' or 'Sell'. Returns the /order/placeorder result."""
        contract_id = self.find_contract_id(root)
        account_id, account_spec = self._ensure_account()
        body = {
            "accountSpec": account_spec,
            "accountId": account_id,
            "action": action,
            "symbol": root,                  # Tradovate also accepts root for placeorder
            "orderQty": qty,
            "orderType": "Market",
            "isAutomated": True,
        }
        # placeorder supports contractId too; including both is harmless.
        body["contractId"] = contract_id
        return self._post("/order/placeorder", body)

    def place_stop_order(self, *, root: str, action: str, qty: int, stop_px: float) -> dict[str, Any]:
        contract_id = self.find_contract_id(root)
        account_id, account_spec = self._ensure_account()
        body = {
            "accountSpec": account_spec,
            "accountId": account_id,
            "action": action,
            "symbol": root,
            "contractId": contract_id,
            "orderQty": qty,
            "orderType": "Stop",
            "stopPrice": stop_px,
            "isAutomated": True,
        }
        return self._post("/order/placeorder", body)

    def modify_order(self, *, order_id: int, new_stop_px: float, qty: int) -> dict[str, Any]:
        body = {
            "orderId": int(order_id),
            "orderQty": qty,
            "orderType": "Stop",
            "stopPrice": new_stop_px,
            "isAutomated": True,
        }
        return self._post("/order/modifyorder", body)

    def cancel_order(self, *, order_id: int) -> dict[str, Any]:
        return self._post("/order/cancelorder", {"orderId": int(order_id)})

    # ------------------------------------------------------------------
    # Positions
    # ------------------------------------------------------------------

    def get_open_positions(self) -> list[dict[str, Any]]:
        account_id, _ = self._ensure_account()
        positions = self._get("/position/list")
        # Tradovate returns positions for all accounts; filter to ours
        # and drop flat positions.
        return [p for p in positions if int(p.get("accountId", 0)) == account_id and int(p.get("netPos", 0)) != 0]

    def get_account_health(self) -> dict[str, Any]:
        """Quick sanity check: account, login, token state. Used by
        /api/broker-status."""
        try:
            t = self._ensure_token()
            account_id, account_spec = self._ensure_account()
            return {
                "ok": True,
                "broker": "tradovate",
                "env": self.env,
                "user": t.name,
                "account_id": account_id,
                "account_spec": account_spec,
                "token_expires_in": int(t.expires_at - time.time()),
            }
        except Exception as e:
            return {"ok": False, "broker": "tradovate", "env": self.env, "error": str(e)}

    def close(self) -> None:
        try:
            self._http.close()
        except Exception:
            pass
