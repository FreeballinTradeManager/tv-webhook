"""
WebSocket broadcast layer.

Every browser viewing /dashboard opens one WebSocket to /ws/live. When a
webhook commits a change, main.py calls `manager.broadcast(...)` and every
connected dashboard receives the message. The dashboard's JS reacts by
re-fetching its panels — no manual refresh needed.

For now we just push "state_changed" notifications and let the client pull
fresh data via the existing /api/* endpoints. That keeps the WS payload
tiny and avoids duplicating the position serializer.

Later (Slice B) we can push richer payloads (live PnL ticks straight from
the Tradovate market-data feed) without changing the protocol — clients
already handle whatever shape they receive.
"""

import asyncio
import json
import logging
from typing import Any

from fastapi import WebSocket

log = logging.getLogger("tv-webhook.ws")


class ConnectionManager:
    def __init__(self) -> None:
        self._clients: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._clients.add(ws)
        log.info("ws connected (now %d clients)", len(self._clients))

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._clients.discard(ws)
        log.info("ws disconnected (now %d clients)", len(self._clients))

    async def broadcast(self, message: dict[str, Any]) -> None:
        """Send `message` (JSON-encoded) to every connected client.
        Silently drops clients that fail to receive — they'll reconnect."""
        if not self._clients:
            return
        payload = json.dumps(message, default=str)
        async with self._lock:
            snapshot = list(self._clients)
        dead: list[WebSocket] = []
        for ws in snapshot:
            try:
                await ws.send_text(payload)
            except Exception as e:
                log.debug("ws send failed: %s — marking dead", e)
                dead.append(ws)
        if dead:
            async with self._lock:
                for ws in dead:
                    self._clients.discard(ws)

    def broadcast_threadsafe(self, message: dict[str, Any]) -> None:
        """Sync wrapper for use inside FastAPI sync endpoints — schedules
        the broadcast on the running event loop."""
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(self.broadcast(message))
            else:
                loop.run_until_complete(self.broadcast(message))
        except RuntimeError:
            # No event loop in this thread — drop the message rather than
            # crash the webhook. (Should never happen in FastAPI but cheap
            # insurance.)
            log.warning("no event loop, dropping broadcast: %s", message)


manager = ConnectionManager()
