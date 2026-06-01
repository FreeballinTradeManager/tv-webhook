"""
Tradovate market-data WebSocket — populates quote_store.store.

Tradovate's MD WS protocol (excerpt):

  authorize\\n<seq>\\n\\n<accessToken>
       → server replies with auth OK
  md/subscribequote\\n<seq>\\n\\n{"symbol":"MNQM6"}
       → server pushes {"e":"md","d":{"quotes":[{"contractId":..,"entries":{...}}]}}

We only run this task when Tradovate creds + a broker that exposes a
client are present. On every message we update the in-process
quote_store and (debounced) broadcast a `pnl_tick` to dashboard
WebSockets so the Live PnL cell can update in place.

The task is "best-effort": if the WS drops, it sleeps and reconnects.
A persistent failure is logged but never crashes the FastAPI app.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from typing import Any, Optional

import httpx

log = logging.getLogger("tv-webhook.tradovate.md")

# How often we'll broadcast PnL updates to dashboard WSs — protects them
# from a multi-Hz quote stream while still feeling real-time.
PNL_BROADCAST_INTERVAL_SEC = 0.5


async def md_ws_loop(
    *,
    client,                 # TradovateClient
    quote_store,            # quote_store.store
    ws_manager,             # app.ws.manager
    subscribed_tickers,     # set[str] of normalized roots to keep subscribed
) -> None:
    """Runs forever, reconnecting on disconnect."""
    try:
        import websockets  # lazy import — only needed when this task runs
    except ImportError:
        log.error("websockets package not installed — MD loop disabled")
        return

    backoff = 1.0
    last_broadcast = 0.0
    while True:
        try:
            # Authorize via the client (sync — runs in thread to avoid
            # blocking the event loop).
            token = await asyncio.to_thread(lambda: client._ensure_token().access_token)
            url = client.md_ws_url
            log.info("md ws connecting to %s", url)
            async with websockets.connect(url, ping_interval=20, ping_timeout=20) as ws:
                # Tradovate's framing: lines of "<op>\\n<seq>\\n\\n<body>"
                seq = [0]
                async def send_op(op: str, body: str = ""):
                    seq[0] += 1
                    await ws.send(f"{op}\n{seq[0]}\n\n{body}")

                await send_op("authorize", token)
                # Server's initial frames are JSON-encoded array prefixed
                # with 'o' (open) and 'a' (array). We just read until we
                # see auth success.
                got_auth = False
                while not got_auth:
                    msg = await asyncio.wait_for(ws.recv(), timeout=15)
                    if isinstance(msg, str) and "auth" in msg.lower():
                        got_auth = True
                log.info("md ws auth ok")
                backoff = 1.0

                subscribed: set[int] = set()  # contractIds we've subscribed

                async def maybe_subscribe_new():
                    for ticker in list(subscribed_tickers):
                        try:
                            cid = await asyncio.to_thread(client.find_contract_id, ticker)
                        except Exception as e:
                            log.warning("contract lookup failed for %s: %s", ticker, e)
                            continue
                        if cid in subscribed:
                            continue
                        await send_op("md/subscribequote", json.dumps({"symbol": ticker}))
                        subscribed.add(cid)
                        log.info("md subscribed: %s (cid=%d)", ticker, cid)

                await maybe_subscribe_new()
                last_sub_check = time.time()

                while True:
                    raw = await asyncio.wait_for(ws.recv(), timeout=60)
                    now = time.time()

                    # Periodically check for newly-opened positions that need
                    # MD subscriptions.
                    if now - last_sub_check > 5:
                        await maybe_subscribe_new()
                        last_sub_check = now

                    # Tradovate framing — strip 'a' prefix when present, then
                    # parse as JSON array.
                    if isinstance(raw, bytes):
                        raw = raw.decode("utf-8", errors="ignore")
                    if raw.startswith("a"):
                        raw = raw[1:]
                    if not raw:
                        continue
                    try:
                        frames = json.loads(raw)
                    except Exception:
                        continue
                    if not isinstance(frames, list):
                        frames = [frames]

                    updated = False
                    for frame in frames:
                        if not isinstance(frame, dict):
                            continue
                        if frame.get("e") != "md":
                            continue
                        d = frame.get("d") or {}
                        for q in (d.get("quotes") or []):
                            # entries is {Trade:{price,size,timestamp},
                            #             Bid:{price,size}, Offer:{price,size}}
                            entries = q.get("entries") or {}
                            trade = entries.get("Trade") or {}
                            bid = entries.get("Bid") or {}
                            offer = entries.get("Offer") or {}
                            # We don't have the symbol root in the message
                            # directly — Tradovate sends contractId. Look up
                            # via the cache reverse map; if unknown skip.
                            cid = q.get("contractId")
                            root: Optional[str] = None
                            for r, (resolved_cid, _) in client._contract_cache.items():
                                if resolved_cid == cid:
                                    root = r
                                    break
                            if not root:
                                continue
                            quote_store.update(
                                root,
                                last=trade.get("price"),
                                bid=bid.get("price"),
                                ask=offer.get("price"),
                            )
                            updated = True

                    if updated and now - last_broadcast > PNL_BROADCAST_INTERVAL_SEC:
                        last_broadcast = now
                        with contextlib.suppress(Exception):
                            await ws_manager.broadcast({"type": "pnl_tick", "quotes": quote_store.snapshot()})

        except Exception as e:
            log.warning("md ws loop error: %s — reconnecting in %.1fs", e, backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30.0)
