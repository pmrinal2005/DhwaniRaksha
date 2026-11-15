import { z } from "zod";

export const sourceSchema = z.enum(["gnani", "cache", "mock", "supabase", "livekit", "edge-dsp", "computed"]);
export const exactnessSchema = z.enum(["exact", "estimated"]);
export const windowSchema = z.enum(["1h", "24h", "7d", "30d"]);
export type DataSource = z.infer<typeof sourceSchema>;
export type Exactness = z.infer<typeof exactnessSchema>;
export type TimeWindow = z.infer<typeof windowSchema>;
export type Provenance = { source: DataSource; exactness: Exactness };

export const requestKindSchema = z.enum(["stt_ws", "stt_rest", "tts_rest", "tts_sse", "vc_embed", "vc_sse"]);
export const requestSchema = z.object({
  id: z.string(),
  kind: requestKindSchema,
  model: z.string(),
  status: z.enum(["queued", "active", "ok", "retry", "failed"]),
  queued_ms: z.number().nonnegative(),
  duration_ms: z.number().nonnegative(),
  http_status: z.number().int().nullable().optional(),
  error_code: z.string().optional(),
  gnani_request_id: z.string().optional(),
  workflow_domain: z.string().optional(),
  credits: z.object({ value: z.number().nonnegative(), exactness: exactnessSchema }),
}).loose();

export const telemetryEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("gnani.request"), payload: requestSchema }),
  z.object({ type: z.literal("mutex.state"), payload: z.object({
    active: z.object({ id: z.string(), kind: requestKindSchema, since_ms: z.number() }).nullable(),
    queue: z.array(z.object({ id: z.string(), kind: requestKindSchema, priority: z.number(), waiting_ms: z.number().nonnegative() })),
    total_429_avoided: z.number().nonnegative(), total_429_received: z.number().nonnegative(), retries: z.number().nonnegative(),
  }).loose() }),
  z.object({ type: z.literal("stt.transcript"), payload: z.object({
    segment_id: z.string(), text: z.string(), is_final: z.boolean(), detected_language_code: z.string().optional(),
    latency_ms: z.number().nonnegative(), format: z.string(),
    keyterm_hits: z.array(z.object({ term: z.string(), start: z.number().int(), end: z.number().int(), cluster: z.string().optional() })),
    context: z.object({ keyterms_count: z.number(), topic_chars: z.number(), previous_text_chars: z.number(), speaker_names: z.array(z.string()) }),
    model: z.string().optional(), gnani_request_id: z.string().optional(), transliterated_text: z.string().optional(),
  }).loose() }),
  z.object({ type: z.literal("tts.chunk"), payload: z.object({
    chunk_index: z.number().int(), is_final: z.boolean(), model: z.string(), voice: z.string().optional(),
    embedding_hash: z.string().optional(), ttfb_ms: z.number().nonnegative(), audio_url: z.url().optional(), cached: z.boolean().optional(),
  }).loose() }),
  z.object({ type: z.literal("cache.event"), payload: z.object({ kind: z.enum(["hit", "miss"]), text_sha256: z.string(), credits_saved: z.number().nonnegative() }).loose() }),
  z.object({ type: z.literal("credit.snapshot"), payload: z.object({
    budget: z.number().nonnegative(), spent: z.number().nonnegative(), saved_by_cache: z.number().nonnegative(),
    blocked_silence_bytes: z.number().nonnegative(), remaining: z.number().nonnegative(), burn_per_hour: z.number().nonnegative(),
    projected_exhaustion_ts: z.string().nullable(),
  }).loose() }),
  z.object({ type: z.literal("vc.embedding"), payload: z.object({
    user_id: z.string(), embedding_f32: z.array(z.number()).length(768), l2_norm: z.number(), dtype_source: z.literal("bfloat16"),
  }).loose() }),
  z.object({ type: z.literal("vc.verify"), payload: z.object({
    user_id: z.string(), cosine: z.number(), band: z.enum(["verified", "noisy_warning", "rejected"]),
    thresholds: z.object({ verified: z.number(), noisy: z.number() }),
  }).loose() }),
  z.object({ type: z.literal("vc.cloak"), payload: z.object({ cos_original_vs_cloaked: z.number(), reflection_angle_deg: z.number(), enabled: z.boolean() }).loose() }),
  z.object({ type: z.literal("ledger.minted"), payload: z.object({
    id: z.string(), workflow_domain: z.string(), sha256_audit_hash: z.string(), prev_ledger_hash: z.string().nullable(),
    party_a_cosine: z.number(), party_b_cosine: z.number(), structured_contract: z.record(z.string(), z.unknown()),
  }).loose() }),
  z.object({ type: z.literal("health"), payload: z.object({
    service: z.enum(["gnani_ws", "gnani_rest", "groq_1", "groq_2", "supabase", "livekit", "render"]),
    state: z.enum(["up", "degraded", "down"]), rtt_ms: z.number().nonnegative(),
  }).loose() }),
  z.object({ type: z.literal("groq.run"), payload: z.object({
    key: z.union([z.literal(1), z.literal(2)]), model: z.string(), tokens_in: z.number().nonnegative(),
    tokens_out: z.number().nonnegative(), latency_ms: z.number().nonnegative(), role: z.enum(["speculative", "judge"]),
  }).loose() }),
]).and(z.object({ ts: z.string(), source: sourceSchema, exactness: exactnessSchema }).loose());

export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;
export type TelemetryEventType = TelemetryEvent["type"];

export function parseTelemetryEvent(value: unknown) {
  return telemetryEventSchema.safeParse(value);
}
