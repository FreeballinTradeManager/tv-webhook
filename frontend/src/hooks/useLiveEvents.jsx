import { useEffect, useState, useRef } from 'react';

// WebSocket hook that connects to /ws/live and streams events.
// Reconnects with exponential backoff if the socket drops.
//
// Usage:
//   const { events, connected } = useLiveEvents();
//   useEffect(() => {
//     const latest = events[0];
//     if (latest?.type === 'tp_hit') celebrate();
//   }, [events]);

export function useLiveEvents({ maxKeep = 100 } = {}) {
  const [events, setEvents] = useState([]);   // newest first
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const backoffRef = useRef(1000);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer = null;

    const connect = () => {
      // Same-origin ws — Vite proxy handles /ws in dev; prod uses SPA host
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${window.location.host}/ws/live`;

      let ws;
      try { ws = new WebSocket(url); }
      catch (e) {
        console.warn('WebSocket ctor failed', e);
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        setConnected(true);
        backoffRef.current = 1000; // reset backoff on success
      };

      ws.onmessage = (msg) => {
        if (cancelled) return;
        try {
          const data = JSON.parse(msg.data);
          setEvents(prev => [{ ...data, _at: Date.now() }, ...prev].slice(0, maxKeep));
        } catch (e) {
          // Ignore non-JSON messages
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose will fire right after
      };
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      const delay = Math.min(backoffRef.current, 15000);
      reconnectTimer = setTimeout(connect, delay);
      backoffRef.current = Math.min(backoffRef.current * 2, 15000);
    };

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) wsRef.current.close();
    };
  }, [maxKeep]);

  return { events, connected };
}
