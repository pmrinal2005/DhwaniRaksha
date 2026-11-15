import { create } from "zustand";
import type { Credits, LedgerEntry } from "@/lib/contracts";
import type { DataSource, Exactness, TelemetryEvent } from "@/lib/telemetry/event-schema";
import { LAYOUT } from "@/components/dashboard/primitives/tokens";

export type ConnectionState = "connecting" | "live" | "reconnecting" | "offline";
export type StreamEvent = (TelemetryEvent & { event_id: string }) | {
  event_id: string; type: "schema_error"; ts: string; source: "computed"; exactness: "exact";
  payload: { message: string; issues: string[] };
};

export interface AuditEntry { sourcePath: string; source: DataSource | "unavailable"; lastUpdate: string | null; updates: number }
export interface DspFrame {
  ts: string; rms: number; zcr: number; f0: number; vad_prob: number; gate_open: boolean;
  raw_spectrum: number[]; cleaned_spectrum: number[]; bytes_sent: number; bytes_suppressed: number;
  sample_rate: number; snr_db: number | null; speaking_rate_wpm: number | null;
}

type Verification = Extract<TelemetryEvent, { type: "vc.verify" }>["payload"];
type Cloak = Extract<TelemetryEvent, { type: "vc.cloak" }>["payload"];
type Mutex = Extract<TelemetryEvent, { type: "mutex.state" }>["payload"];
type Transcript = Extract<TelemetryEvent, { type: "stt.transcript" }>["payload"] & { ts: string; source: DataSource; exactness: Exactness };
type Embedding = Extract<TelemetryEvent, { type: "vc.embedding" }>["payload"] & { ts: string };
type Health = Extract<TelemetryEvent, { type: "health" }>["payload"] & { ts: string };

interface TelemetryState {
  connection: ConnectionState;
  transport: "sse" | "websocket" | null;
  lastError: { code: string; message: string } | null;
  events: StreamEvent[];
  requests: Array<Extract<TelemetryEvent, { type: "gnani.request" }>["payload"] & { ts: string }>;
  health: Record<string, Health>;
  credit: (Credits & { ts: string }) | null;
  mutex: (Mutex & { ts: string }) | null;
  transcripts: Transcript[];
  embeddings: Record<string, Embedding>;
  verifications: Record<string, Verification & { ts: string }>;
  cloak: (Cloak & { ts: string }) | null;
  minted: Array<LedgerEntry & { ts: string }>;
  dsp: DspFrame | null;
  dspHistory: DspFrame[];
  audit: Record<string, AuditEntry>;
  setConnection: (connection: ConnectionState, transport?: "sse" | "websocket" | null, error?: { code: string; message: string } | null) => void;
  ingest: (event: TelemetryEvent) => void;
  schemaError: (message: string, issues: string[]) => void;
  setDsp: (frame: DspFrame) => void;
  registerAudit: (id: string, sourcePath: string) => void;
  markAudit: (id: string, source: DataSource) => void;
}

function auditFromEvent(event: TelemetryEvent) {
  return { sourcePath: `SSE ${event.type}`, source: event.source, lastUpdate: event.ts, updates: 1 } satisfies AuditEntry;
}

export const useTelemetryStore = create<TelemetryState>((set) => ({
  connection: "connecting", transport: null, lastError: null, events: [], requests: [], health: {}, credit: null,
  mutex: null, transcripts: [], embeddings: {}, verifications: {}, cloak: null, minted: [], dsp: null, dspHistory: [], audit: {},
  setConnection: (connection, transport, lastError = null) => set((state) => ({ connection, transport: transport === undefined ? state.transport : transport, lastError })),
  ingest: (event) => set((state) => {
    const streamEvent = { ...event, event_id: `${event.ts}-${event.type}-${state.events.length}` } as StreamEvent;
    const next: Partial<TelemetryState> = {
      events: [streamEvent, ...state.events].slice(0, LAYOUT.eventLimit),
      lastError: null,
    };
    if (event.type === "gnani.request") next.requests = [{ ...event.payload, ts: event.ts }, ...state.requests].slice(0, LAYOUT.eventLimit);
    if (event.type === "health") next.health = { ...state.health, [event.payload.service]: { ...event.payload, ts: event.ts } };
    if (event.type === "credit.snapshot") next.credit = { ...state.credit, ...event.payload, ts: event.ts } as Credits & { ts: string };
    if (event.type === "mutex.state") next.mutex = { ...event.payload, ts: event.ts };
    if (event.type === "stt.transcript") next.transcripts = [{ ...event.payload, ts: event.ts, source: event.source, exactness: event.exactness }, ...state.transcripts].slice(0, LAYOUT.eventLimit);
    if (event.type === "vc.embedding") next.embeddings = { ...state.embeddings, [event.payload.user_id]: { ...event.payload, ts: event.ts } };
    if (event.type === "vc.verify") next.verifications = { ...state.verifications, [event.payload.user_id]: { ...event.payload, ts: event.ts } };
    if (event.type === "vc.cloak") next.cloak = { ...event.payload, ts: event.ts };
    if (event.type === "ledger.minted") next.minted = [{ ...event.payload, created_at: event.ts, ts: event.ts }, ...state.minted].slice(0, LAYOUT.eventLimit);
    const auditId = event.type;
    const previousAudit = state.audit[auditId];
    next.audit = { ...state.audit, [auditId]: { ...auditFromEvent(event), updates: (previousAudit?.updates ?? 0) + 1 } };
    return next;
  }),
  schemaError: (message, issues) => set((state) => ({
    events: [{ event_id: `schema-${state.events.length}`, type: "schema_error", ts: new Date().toISOString(), source: "computed", exactness: "exact", payload: { message, issues } }, ...state.events].slice(0, LAYOUT.eventLimit),
  })),
  setDsp: (dsp) => set((state) => ({
    dsp, dspHistory: [...state.dspHistory, dsp].slice(-LAYOUT.chartSamples),
    audit: { ...state.audit, "edge-dsp": { sourcePath: "AudioWorklet DSP telemetry", source: "edge-dsp", lastUpdate: dsp.ts, updates: (state.audit["edge-dsp"]?.updates ?? 0) + 1 } },
  })),
  registerAudit: (id, sourcePath) => set((state) => ({ audit: { ...state.audit, [id]: state.audit[id] ?? { sourcePath, source: "unavailable", lastUpdate: null, updates: 0 } } })),
  markAudit: (id, source) => set((state) => ({ audit: { ...state.audit, [id]: { sourcePath: state.audit[id]?.sourcePath ?? id, source, lastUpdate: new Date().toISOString(), updates: (state.audit[id]?.updates ?? 0) + 1 } } })),
}));
