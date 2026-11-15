"use client";

/**
 * Typed client for the dashboard's own API surface. Every response carries
 * `source` + `exactness`, which the UI surfaces verbatim — no panel is allowed to
 * present simulated numbers as if they were measured.
 */
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import type { WorkflowDomain } from "@/lib/server/catalog";

export type Source = "gnani" | "cache" | "mock" | "supabase" | "livekit" | "edge-dsp" | "computed";
export type Exactness = "exact" | "estimated";

interface Envelope { source?: Source; exactness?: Exactness }

export class LiveApiError extends Error {
  constructor(message: string, public readonly code: string, public readonly status: number) {
    super(message);
    this.name = "LiveApiError";
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T & Envelope> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 65_000);
  try {
    const response = await fetch(path, {
      ...init,
      signal: init?.signal ?? controller.signal,
      headers: { Accept: "application/json", ...(init?.headers as Record<string, string> | undefined) },
      cache: "no-store",
    });
    const text = await response.text();
    let body: unknown = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
    if (!response.ok) {
      const record = body as { error?: { code?: string; message?: string } };
      throw new LiveApiError(record.error?.message ?? `Request failed (${response.status}).`, record.error?.code ?? `HTTP_${response.status}`, response.status);
    }
    return body as T & Envelope;
  } catch (error) {
    if (error instanceof LiveApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw new LiveApiError("The request timed out.", "TIMEOUT", 504);
    throw new LiveApiError(error instanceof Error ? error.message : "Network error.", "NETWORK", 0);
  } finally {
    clearTimeout(timer);
  }
}

function useLive<T>(key: string, path: string, intervalMs: number, enabled = true): UseQueryResult<T & Envelope, Error> {
  return useQuery({
    queryKey: [key, path],
    queryFn: () => api<T>(path),
    refetchInterval: intervalMs > 0 ? intervalMs : false,
    staleTime: Math.max(2_000, intervalMs / 2),
    enabled,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

/* ------------------------------------------------------------------- types */

export interface HealthProbe { service: string; state: "up" | "degraded" | "down"; rtt_ms: number; detail?: string }
export interface InsightsResponse {
  ok: boolean; generated_at: string; aggregation_ms: number;
  credits: { budget: number; spent: number; remaining: number; saved_by_cache: number; burn_per_hour: number; projected_exhaustion_ts: string | null; cache_hit_ratio: number | null; breakdown: { kind: string; credits: number; exactness: Exactness }[]; burn_series: number[]; hard_stop: number; spend_rows: CreditSpendRow[] };
  workflows: { domain: WorkflowDomain; label: string; native: string; accent: string; utterances: number; avg_latency_ms: number | null; avg_cosine: number | null; minted_contracts: number; cache_hit_ratio: number; fair_price_alerts: number; sparkline: number[] }[];
  latency_waterfall: { domain: WorkflowDomain; label: string; segments: { key: string; duration_ms: number }[] }[];
  stage_states: Record<string, { state: string; detail: string }>;
  rag: { clusters: { domain: WorkflowDomain; label: string; speaker_names: string[]; topic_chars: number; keyterms: string[]; keyterms_total: number }[] };
  mutex: { active: { kind: string; since: number } | null; waiting: number; totalCalls: number; totalRetries: number; total429Avoided: number; total429Received: number; lastRequestId: string | null; lastLatencyMs: number | null; lastCallAt: string | null; serialized: boolean; priorities: string[] };
  health: HealthProbe[];
  voiceprints: { id: string; handle: string; role: string; language: string; created_at: string; last_cosine: number | null; digest: string }[];
  triage: TriageRow[];
  cache_rows: { textSha256: string; model: string; language: string; normalizedText: string; creditsSaved: number; createdAt: string }[];
  modes: { gnani: string; store: string; groq: string };
}
export interface CreditSpendRow { id: string; callKind: string; model: string; status: number; queuedMs: number; latencyMs: number; credits: number; exactness: Exactness; createdAt: string }
export interface CreditResponse {
  ok: boolean; budget: number; spent: number; saved_by_cache: number; remaining: number; burn_per_hour: number;
  projected_exhaustion_ts: string | null; cache_hit_ratio: number | null; blocked_silence_bytes: number; hard_stop: number;
  burn_series: number[]; spend_breakdown: { kind: string; credits: number; exactness: Exactness }[]; calls: number;
  mode: { gnani: string; store: string; mutex: { active: unknown; waiting: number; totalCalls: number; totalRetries: number; total429Avoided: number; total429Received: number } };
}
export interface HealthResponse { ok: boolean; status: string; probes: HealthProbe[]; total_ms: number; modes: { gnani: string; store: string } }

export interface TriageRow {
  id: string; clinicalTriageLevel: "routine" | "watch" | "urgent" | "emergency";
  vitals: Record<string, unknown>; language: string; symptoms: string; ttsTags: string[]; createdAt: string;
}
export interface TriageResponse { ok: boolean; logs: TriageRow[]; store_mode: string }
export interface TriageExtractResponse {
  ok: boolean; triage_level: TriageRow["clinicalTriageLevel"]; reasons: string[];
  vitals: Record<string, number | undefined>; guidance: string; tts_tags: string[]; record: TriageRow; store_mode: string;
}

export interface LedgerEntryDto {
  id: string; workflowDomain: string; partyAName: string; partyBName: string;
  partyALanguage: string; partyBLanguage: string; partyACosine: number | null; partyBCosine: number | null;
  sourceTranscript: string; translatedTranscript: string | null; structuredContract: Record<string, unknown>;
  sha256AuditHash: string; prevLedgerHash: string | null; status: string; createdAt: string;
  chainValid: boolean | null; workflow_label: string;
}
export interface LedgerResponse {
  ok: boolean; entries: LedgerEntryDto[];
  chain: { length: number; valid: boolean; head: string | null; mode: string };
  store_mode: string;
}
export interface LedgerEntryResponse {
  ok: boolean; entry: LedgerEntryDto & { workflow_native: string };
  chain: { position: number; of: number; prev_hash: string | null; recomputed_hash: string; hash_valid: boolean; previous_entry: { id: string; sha256: string; createdAt: string } | null };
  store_mode: string;
}
export interface MintResponse { ok: boolean; entry: Omit<LedgerEntryDto, "chainValid" | "workflow_label">; receipt_url: string; chain_verified: boolean; store_mode: string }

export interface SttResponse {
  ok: boolean; transcript: string; model: string; detected_language_code: string | null; format: string;
  language_codes: string[]; keyterms_count: number; keyterm_hits: string[]; speakers?: string[];
  context: { topic_chars: number; previous_text_chars: number; keyterms_count: number };
  meta: { mode: string; status: number; requestId: string; latencyMs: number; attempts: number; queuedMs: number };
}
export interface SttOptions { workflow: string; format?: string; languageCode?: string; model?: string; text?: string }

/** REST transcription. Audio is optional in mock mode (the simulator returns a domain script). */
export async function transcribe(blob: Blob | null, options: SttOptions): Promise<SttResponse> {
  const form = new FormData();
  if (blob) form.set("audio_file", blob, `clip.${blob.type.includes("mpeg") ? "mp3" : "wav"}`);
  form.set("workflow", options.workflow);
  form.set("model", options.model ?? "prisma-v3.0");
  form.set("language_code", options.languageCode ?? "indic-auto");
  if (options.format) form.set("format", options.format);
  if (options.text) form.set("seed", options.text.slice(0, 48));
  return api<SttResponse>("/api/stt", { method: "POST", body: form });
}

export interface TtsResult {
  ok: boolean;
  audio: { base64: string; mime: string; container: string; sample_rate: number; bytes: number; duration_ms: number };
  cache: { key: string; hit: boolean; stored: boolean };
  normalization: { text: string; changed: boolean; identifiers: number; currency: number; fractions: number };
  tags: { kept: string[]; removed: string[] };
  spoken_text: string;
  meta: { mode: string; status: number; requestId: string; latencyMs: number; attempts: number; queuedMs: number };
}
export interface TtsOptions {
  text: string; model?: string; voice?: string; language?: string; speed?: number;
  container?: string; sample_rate?: number; workflow?: string; normalize?: boolean;
  embedding?: string; handle?: string; gender?: "female" | "male";
}

export async function synthesize(options: TtsOptions): Promise<TtsResult> {
  const model = options.model ?? "timbre-v3.0";
  const container = options.container ?? "wav";
  const defaultSampleRate = container === "mulaw" || container === "alaw"
    ? 8000
    : model === "vachana-vc-v1"
      ? 44100
      : 48000;
  return api<TtsResult>("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: options.text,
      model,
      voice: options.voice,
      language: options.language ?? "hi-IN",
      speed: options.speed,
      workflow: options.workflow,
      normalize: options.normalize,
      gender: options.gender,
      audio_config: { container, sample_rate: options.sample_rate ?? defaultSampleRate },
      speaker_embedding: options.embedding ? { embedding: options.embedding, shape: [1, 768], dtype: "torch.bfloat16" } : undefined,
      embedding_source: options.handle ? { handle: options.handle } : undefined,
    }),
  });
}

export interface EmbedResult {
  ok: boolean; handle: string; role: string; language: string;
  speaker_embedding: { embedding: string; shape: [number, number]; dtype: string };
  embedding_f32: number[]; l2_norm: number; digest: string; sample_bytes: number; sample_seconds: number;
  persisted: string | null; store_mode: string | null;
  meta: { mode: string; latencyMs: number; requestId: string };
}
export async function embedVoice(blob: Blob | null, options: { handle: string; role?: string; language?: string; persist?: boolean }): Promise<EmbedResult> {
  const form = new FormData();
  if (blob) form.set("audio_file", blob, "reference.wav");
  form.set("handle", options.handle);
  form.set("role", options.role ?? "citizen");
  form.set("language", options.language ?? "hi-IN");
  if (options.persist) form.set("persist", "true");
  return api<EmbedResult>("/api/voice/embed", { method: "POST", body: form });
}

export interface VerifyResponse {
  ok: boolean; best_match: { id: string; handle: string; role: string; language: string; cosine: number; band: string } | null;
  band: "verified" | "noisy_warning" | "rejected"; thresholds: { verified: number; noisy: number };
  comparisons: { id: string; handle: string; role: string; language: string; cosine: number; band: string }[];
  histogram: { from: number; count: number }[]; live_digest: string; enrolled_count: number; note: string | null; store_mode: string;
}
export async function verifyVoice(input: { live_embedding?: string; handle?: string }): Promise<VerifyResponse> {
  return api<VerifyResponse>("/api/voice/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
}

export interface CloakResponse {
  ok: boolean; salt: string; normal_digest: string;
  original: { embedding: string; norm: number; digest: string };
  cloaked: { embedding: string; norm: number; digest: string };
  geometry: { angle_deg: number; norm_preserved: boolean; self_cosine_original: number; relink_cosine: number; band_after_cloak: string };
  nearest_after_cloak: { handle: string; cosine: number }[];
  strongest_link: number; note: string;
}
export async function cloakVoice(input: { embedding?: string; handle?: string; salt?: string }): Promise<CloakResponse> {
  return api<CloakResponse>("/api/voice/cloak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
}

export interface ContractResponse {
  ok: boolean; workflow: string; workflow_label: string; normalized_transcript: string;
  contract: Record<string, unknown> & { confidence: number; engine: string; notes: string[] };
  signable: boolean; extraction_ms: number; engine: string;
}
export async function extractContract(input: { transcript: string; workflow: string; language?: string; reference_fair_price?: number }): Promise<ContractResponse> {
  return api<ContractResponse>("/api/contract/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
}

/* ------------------------------------------------------------------- hooks */

export function useInsights() { return useLive<InsightsResponse>("insights", "/api/insights", 15_000); }
export function useCreditsLive() { return useLive<CreditResponse>("credits", "/api/credits", 20_000); }
export function useHealth() { return useLive<HealthResponse>("health", "/api/health", 45_000); }
export function useLedgerLive(workflow?: string | null) {
  return useLive<LedgerResponse>("ledger", `/api/ledger?limit=60${workflow ? `&workflow=${workflow}` : ""}`, 30_000);
}
export function useLedgerEntryLive(id: string) { return useLive<LedgerEntryResponse>("ledger-entry", `/api/ledger/${id}`, 0, Boolean(id)); }
export function useTriageLive() { return useLive<TriageResponse>("triage", "/api/triage", 30_000); }

export function useTranscribe(): UseMutationResult<SttResponse, Error, { blob: Blob | null; options: SttOptions }> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ blob, options }) => transcribe(blob, options),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["insights"] }); void client.invalidateQueries({ queryKey: ["credits"] }); },
  });
}

export function useSynthesize(): UseMutationResult<TtsResult, Error, TtsOptions> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: synthesize,
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["insights"] }); void client.invalidateQueries({ queryKey: ["credits"] }); },
  });
}

export function useExtractContract(): UseMutationResult<ContractResponse, Error, { transcript: string; workflow: string; language?: string; reference_fair_price?: number }> {
  return useMutation({ mutationFn: extractContract });
}

export function useMintLedger(): UseMutationResult<MintResponse, Error, Record<string, unknown>> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body) => api<MintResponse>("/api/ledger", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["ledger"] }); void client.invalidateQueries({ queryKey: ["insights"] }); },
  });
}

export function useTriageExtract(): UseMutationResult<TriageExtractResponse, Error, { transcript: string; language?: string; vitals?: Record<string, number> }> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body) => api<TriageExtractResponse>("/api/triage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["triage"] }); void client.invalidateQueries({ queryKey: ["insights"] }); },
  });
}
