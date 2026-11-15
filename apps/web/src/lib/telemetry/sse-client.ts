"use client";

import { useEffect, useRef } from "react";
import { apiOrigin, dashboardUrl } from "@/lib/api-client";
import { parseTelemetryEvent } from "@/lib/telemetry/event-schema";
import { useTelemetryStore } from "@/lib/telemetry/store";
import { LAYOUT } from "@/components/dashboard/primitives/tokens";

export function useTelemetryConnection(onReconnect: () => void) {
  const reconnectRef = useRef(onReconnect);
  reconnectRef.current = onReconnect;
  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let fallback = false;
    const store = useTelemetryStore.getState();

    const handleData = (raw: string) => {
      let body: unknown;
      try { body = JSON.parse(raw); } catch {
        useTelemetryStore.getState().schemaError("Telemetry event was not valid JSON.", ["event: invalid JSON"]);
        return;
      }
      const result = parseTelemetryEvent(body);
      if (!result.success) {
        useTelemetryStore.getState().schemaError("Telemetry event failed schema validation.", result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
        return;
      }
      useTelemetryStore.getState().ingest(result.data);
    };

    const scheduleReconnect = () => {
      if (disposed) return;
      source?.close(); socket?.close(); source = null; socket = null;
      const delay = Math.min(LAYOUT.retryBaseMs * 2 ** attempts, LAYOUT.retryMaxMs);
      attempts += 1;
      useTelemetryStore.getState().setConnection(attempts > 1 ? "reconnecting" : "offline", null, { code: "TELEMETRY_DISCONNECTED", message: "Telemetry stream is not connected." });
      retryTimer = setTimeout(connect, delay);
    };

    const connect = () => {
      if (disposed) return;
      useTelemetryStore.getState().setConnection(attempts ? "reconnecting" : "connecting", fallback ? "websocket" : "sse");
      if (!fallback) {
        source = new EventSource(dashboardUrl("/api/telemetry/stream"), { withCredentials: true });
        source.onopen = () => {
          attempts = 0;
          useTelemetryStore.getState().setConnection("live", "sse");
          if (reconnectRef.current) reconnectRef.current();
        };
        source.onmessage = (message) => handleData(message.data);
        source.onerror = () => {
          if (!fallback) { fallback = true; source?.close(); source = null; connect(); }
          else scheduleReconnect();
        };
      } else {
        const wsOrigin = process.env.NEXT_PUBLIC_TELEMETRY_WS_ORIGIN ?? apiOrigin.replace(/^http/, "ws");
        try { socket = new WebSocket(`${wsOrigin}/ws/telemetry`); } catch { scheduleReconnect(); return; }
        socket.onopen = () => {
          attempts = 0;
          useTelemetryStore.getState().setConnection("live", "websocket");
          reconnectRef.current();
        };
        socket.onmessage = (message) => { if (typeof message.data === "string") handleData(message.data); };
        socket.onerror = () => { useTelemetryStore.getState().setConnection("reconnecting", "websocket", { code: "WEBSOCKET_ERROR", message: "WebSocket telemetry failed." }); };
        socket.onclose = scheduleReconnect;
      }
    };
    store.setConnection("connecting");
    connect();
    return () => { disposed = true; if (retryTimer) clearTimeout(retryTimer); source?.close(); socket?.close(); };
  }, []);
}
