"use client";

import { useState } from "react";
import { ArrowUpRight, BatteryCharging, ChevronDown, CircleDot, Cpu, Radio, Server, ShieldCheck, Zap } from "lucide-react";
import { useTelemetryStore, type StreamEvent } from "@/lib/telemetry/store";
import { useInsights } from "@/lib/live-api";
import { formatTime } from "@/lib/format";
import { useUiStore } from "@/lib/ui-store";

const FILTERS = ["all", "gnani", "vc", "ledger", "credit"] as const;

const SEVERITY: Record<string, string> = {
  "gnani.request": "sev-info", "mutex.state": "sev-warn", "stt.transcript": "sev-info",
  "tts.chunk": "sev-ok", "cache.event": "sev-ok", "credit.snapshot": "sev-warn",
  "vc.embedding": "sev-info", "vc.verify": "sev-ok", "vc.cloak": "sev-warn",
  "ledger.minted": "sev-ok", health: "sev-info", "groq.run": "sev-info", schema_error: "sev-err",
};

function describe(event: StreamEvent): string {
  switch (event.type) {
    case "gnani.request": return `${event.payload.kind} · ${event.payload.model} · ${event.payload.duration_ms.toFixed(0)} ms · ${event.payload.credits.value} cr`;
    case "mutex.state": return `${event.payload.active ? `active ${event.payload.active.kind}` : "idle"} · queue ${event.payload.queue.length} · 429 avoided ${event.payload.total_429_avoided}`;
    case "stt.transcript": return `${event.payload.text.slice(0, 64)}${event.payload.text.length > 64 ? "…" : ""}`;
    case "tts.chunk": return `chunk ${event.payload.chunk_index} · ${event.payload.model}${event.payload.cached ? " · cached" : ""}`;
    case "cache.event": return `${event.payload.kind} ${event.payload.text_sha256.slice(0, 10)}… saved ${event.payload.credits_saved} cr`;
    case "credit.snapshot": return `spent ${event.payload.spent} / ${event.payload.budget} · ${event.payload.burn_per_hour}/h`;
    case "vc.embedding": return `768-d · ‖v‖ ${event.payload.l2_norm.toFixed(3)}`;
    case "vc.verify": return `cos ${event.payload.cosine.toFixed(3)} · ${event.payload.band}`;
    case "vc.cloak": return `rotation ${event.payload.reflection_angle_deg.toFixed(1)}° · ${event.payload.enabled ? "active" : "off"}`;
    case "ledger.minted": return `${event.payload.workflow_domain} · ${event.payload.sha256_audit_hash.slice(0, 12)}…`;
    case "health": return `${event.payload.service} ${event.payload.state}${event.payload.rtt_ms ? ` · ${event.payload.rtt_ms} ms` : ""}`;
    case "groq.run": return `key ${event.payload.key} · ${event.payload.model} · ${event.payload.latency_ms} ms`;
    case "schema_error": return event.payload.message;
    default: return "";
  }
}

export function TelemetryRail() {
  const connection = useTelemetryStore((state) => state.connection);
  const transport = useTelemetryStore((state) => state.transport);
  const events = useTelemetryStore((state) => state.events);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const rightRailOpen = useUiStore((state) => state.rightRailOpen);
  const toggleRightRail = useUiStore((state) => state.toggleRightRail);
  const insights = useInsights();

  const visible = events
    .filter((event) => filter === "all" ? true
      : filter === "gnani" ? event.type.startsWith("gnani") || event.type === "health"
      : filter === "vc" ? event.type.startsWith("vc")
      : filter === "ledger" ? event.type === "ledger.minted"
      : event.type === "credit.snapshot" || event.type === "cache.event" || event.type === "mutex.state")
    .slice(0, 60);

  const health = insights.data?.health ?? [];
  const mutex = insights.data?.mutex;

  return (
    <aside className={`right-rail ${rightRailOpen ? "open" : ""}`} aria-label="Live telemetry">
      <div className="right-header">
        <div>
          <div className="mini-label">Live event stream</div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 6 }}>
            <span className={`health-led ${connection === "live" ? "up" : connection === "connecting" ? "degraded" : "down"}`} />
            <span style={{ fontSize: 11, fontWeight: 550 }}>{connection === "live" ? "Streaming" : connection === "connecting" ? "Connecting" : connection === "reconnecting" ? "Reconnecting" : "Offline"}</span>
            <span className="chip">{transport ?? "sse"}</span>
          </div>
        </div>
        <button className="icon-button only-mobile" onClick={toggleRightRail} aria-label="Close telemetry rail"><ChevronDown size={15} /></button>
      </div>

      <div className="event-filters">
        {FILTERS.map((item) => (
          <button key={item} className={`segmented button ${filter === item ? "active" : ""}`} style={{ minHeight: 26, padding: "4px 8px", fontSize: 8.5 }} onClick={() => setFilter(item)} aria-pressed={filter === item}>
            {item}
          </button>
        ))}
      </div>

      <div className="event-list">
        {visible.length === 0 && (
          <div style={{ padding: "26px 16px", textAlign: "center", color: "var(--text-3)", fontSize: 10, lineHeight: 1.6 }}>
            <CircleDot size={16} className="subtle" style={{ marginBottom: 8 }} />
            <div>Waiting for the first telemetry event.</div>
            <div style={{ marginTop: 4 }}>The stream emits mutex, credit, verification and mint events every 2.5 s.</div>
          </div>
        )}
        {visible.map((event) => (
          <div className="event-row" key={event.event_id}>
            <button className="event-trigger" onClick={() => setExpanded(expanded === event.event_id ? null : event.event_id)}>
              <span className={`event-sev ${SEVERITY[event.type] ?? "sev-info"}`} />
              <span style={{ minWidth: 0 }}>
                <span className="event-type">{event.type}</span>
                <span className="event-detail">{describe(event)}</span>
              </span>
              <span style={{ textAlign: "right" }}>
                <span className="event-time">{formatTime(event.ts)}</span>
                <span className="event-detail" style={{ marginTop: 3 }}>{event.source}</span>
              </span>
            </button>
            {expanded === event.event_id && (
              <pre className="event-json">{JSON.stringify(event.payload, null, 2)}</pre>
            )}
          </div>
        ))}
      </div>

      <div className="health-strip">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span className="mini-label">Dependencies</span>
          <span className="chip">{health.filter((probe) => probe.state === "up").length}/{health.length} up</span>
        </div>
        <div className="health-grid">
          {(health.length ? health : [
            { service: "gnani_rest", state: "degraded", rtt_ms: 0, detail: "awaiting probe" }, { service: "gnani_ws", state: "degraded", rtt_ms: 0, detail: "awaiting probe" },
            { service: "supabase", state: "down", rtt_ms: 0, detail: "awaiting probe" }, { service: "groq_1", state: "down", rtt_ms: 0, detail: "awaiting probe" },
            { service: "groq_2", state: "down", rtt_ms: 0, detail: "awaiting probe" }, { service: "livekit", state: "down", rtt_ms: 0, detail: "awaiting probe" },
          ]).map((probe) => (
            <div className="health-pill" key={probe.service} title={probe.detail}>
              <span className={`health-led ${probe.state}`} />
              <span className="truncate">{probe.service}</span>
            </div>
          ))}
        </div>

        <div className="hairline" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8 }}>
          <MiniStat icon={<ShieldCheck size={11} />} label="429s avoided" value={mutex ? String(mutex.total429Avoided) : "0"} />
          <MiniStat icon={<Zap size={11} />} label="retries" value={mutex ? String(mutex.totalRetries) : "0"} />
          <MiniStat icon={<Server size={11} />} label="upstream calls" value={mutex ? String(mutex.totalCalls) : "0"} />
          <MiniStat icon={<BatteryCharging size={11} />} label="last latency" value={insights.data ? `${insights.data.credits.spent.toFixed(0)} cr spent` : "—"} />
        </div>

        <a className="text-button mt-12" href="https://docs.gnani.ai/api/introduction/errors" target="_blank" rel="noreferrer">
          <Radio size={11} /> Error reference <ArrowUpRight size={10} />
        </a>
      </div>
    </aside>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
      <span style={{ color: "var(--text-3)", display: "grid", placeItems: "center" }}>{icon}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", font: "8px var(--font-mono-jet), monospace", color: "var(--text-3)", letterSpacing: ".06em", textTransform: "uppercase" }}>{label}</span>
        <span style={{ display: "block", font: "9.5px var(--font-mono-jet), monospace", marginTop: 2 }} className="truncate">{value}</span>
      </span>
    </div>
  );
}

void Cpu;
