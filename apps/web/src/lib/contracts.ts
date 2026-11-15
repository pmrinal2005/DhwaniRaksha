import { z } from "zod";

export const sparkPointSchema = z.object({ ts: z.string(), value: z.number() }).loose();
export const sparkSeriesSchema = z.union([z.array(z.number()), z.array(sparkPointSchema)]);
export const workflowSchema = z.object({
  workflow_domain: z.string(), label: z.string().optional(), glyph: z.string().optional(),
  utterances: z.number().nonnegative(), avg_latency_ms: z.number().nonnegative().nullable(),
  avg_cosine: z.number().nullable(), minted_contracts: z.number().nonnegative(), cache_hit_ratio: z.number().min(0).max(1).nullable(),
  delta_pct: z.number().nullable().optional(), sparkline: sparkSeriesSchema,
}).loose();
export const routeSchema = z.object({
  route: z.string(), label: z.string().optional(), enabled: z.boolean(), metric_value: z.number().nonnegative().nullable().optional(),
  throughput: z.number().nonnegative().nullable().optional(), request_count: z.number().nonnegative().optional(),
  avg_duration_ms: z.number().nonnegative().nullable().optional(), credits: z.number().nonnegative().optional(), exactness: z.enum(["exact", "estimated"]).optional(),
}).loose();
export const overviewSchema = z.object({
  workflows: z.array(workflowSchema),
  routes: z.array(routeSchema).default([]),
  median_e2e_ms: z.number().nonnegative().nullable().optional(),
  load_sparkline: sparkSeriesSchema.default([]),
  flow: z.object({ bytes_sent: z.number().nonnegative().optional(), bytes_suppressed: z.number().nonnegative().optional(), cache_hits: z.number().nonnegative().optional(), cache_misses: z.number().nonnegative().optional() }).loose().optional(),
  config: z.object({ mode: z.string().optional(), sample_rate: z.number().optional(), frame_bytes: z.number().optional(), utterance_cap_ms: z.number().optional(), pre_roll_ms: z.number().optional(), hard_stop: z.number().optional(), verified_threshold: z.number().optional() }).loose().optional(),
  latency_waterfall: z.array(z.object({ id: z.string(), label: z.string().optional(), segments: z.array(z.object({ key: z.string(), duration_ms: z.number().nonnegative() })) })).default([]),
  workflow_data: z.record(z.string(), z.unknown()).optional(),
}).loose();
export const creditsSchema = z.object({
  budget: z.number().nonnegative(), spent: z.number().nonnegative(), saved_by_cache: z.number().nonnegative(), blocked_silence_bytes: z.number().nonnegative(),
  remaining: z.number().nonnegative(), burn_per_hour: z.number().nonnegative(), projected_exhaustion_ts: z.string().nullable(),
  cache_hit_ratio: z.number().min(0).max(1).nullable(), burn_series: sparkSeriesSchema.default([]),
  spend_breakdown: z.array(z.object({ kind: z.string(), credits: z.number().nonnegative(), exactness: z.enum(["exact", "estimated"]).optional() })).default([]),
  hard_stop: z.number().nonnegative().nullable().optional(), blocked_exactness: z.enum(["exact", "estimated"]).optional(),
}).loose();
export const ledgerEntrySchema = z.object({
  id: z.string(), workflow_domain: z.string(), created_at: z.string(), sha256_audit_hash: z.string(), prev_ledger_hash: z.string().nullable(),
  chain_valid: z.boolean().nullable(), status: z.string().optional(), party_a_cosine: z.number().nullable().optional(), party_b_cosine: z.number().nullable().optional(),
  structured_contract: z.record(z.string(), z.unknown()),
}).loose();
export const ledgerSchema = z.object({ entries: z.array(ledgerEntrySchema), next_cursor: z.string().nullable().optional(), chart: z.array(z.object({ bucket: z.string(), signed_valid: z.number().nonnegative(), pending_unverified: z.number().nonnegative(), rejected: z.number().nonnegative(), total_value_inr: z.number().nonnegative().nullable().optional() })).default([]) }).loose();
export const voiceprintSchema = z.object({ id: z.string(), user_id: z.string().optional(), handle: z.string(), role: z.string().nullable().optional(), language: z.string().nullable().optional(), created_at: z.string(), last_cosine: z.number().nullable(), embedding_f32: z.array(z.number()).length(768).optional() }).loose();
export const voiceprintsSchema = z.object({ voiceprints: z.array(voiceprintSchema), current_user_id: z.string().nullable().optional() }).loose();
export const scoreSchema = z.object({ score: z.number(), label: z.enum(["genuine", "impostor", "unknown"]), created_at: z.string().optional() }).loose();
export const verificationScoresSchema = z.object({ scores: z.array(scoreSchema), thresholds: z.object({ verified: z.number(), noisy: z.number() }).optional(), minimum_labelled_scores: z.number().int().positive().optional() }).loose();
export const ragSchema = z.object({ workflow: z.string().optional(), keyterms_array: z.array(z.string()), topic_template: z.string(), previous_text: z.string().optional(), speaker_names: z.array(z.string()).default([]), assembly_ms: z.number().nonnegative(), clusters: z.array(z.object({ id: z.string(), name: z.string(), keyterms: z.array(z.string()) })).default([]), test_reference: z.string().nullable().optional(), context_payload: z.record(z.string(), z.unknown()).optional() }).loose();
export const priceSchema = z.object({ commodity: z.string(), market: z.string(), min: z.number(), modal: z.number(), max: z.number(), unit: z.string(), arrival_date: z.string(), source_url: z.url(), quote: z.number().nullable().optional(), fair_price_warning: z.boolean().optional() }).loose();
export const pricesSchema = z.object({ prices: z.array(priceSchema) }).loose();
export const triageSchema = z.object({ logs: z.array(z.object({ id: z.string(), created_at: z.string(), clinical_triage_level: z.string(), vitals: z.record(z.string(), z.unknown()), language: z.string(), tts_tags: z.array(z.string()).optional(), model: z.string().optional() }).loose()) }).loose();
export const participantSchema = z.object({ id: z.string(), name: z.string(), role: z.string().nullable().optional(), language: z.string().nullable().optional(), speaking: z.boolean(), connection_quality: z.string(), cosine: z.number().nullable().optional(), verification_band: z.string().nullable().optional() }).loose();
export const bridgeItemSchema = z.object({ id: z.string(), speaker_id: z.string(), speaker_name: z.string(), source_text: z.string(), source_language: z.string(), translated_text: z.string().nullable().optional(), target_language: z.string().nullable().optional(), audio_url: z.string().nullable().optional(), cached: z.boolean().optional(), created_at: z.string() }).loose();
export const peopleSchema = z.object({ participants: z.array(participantSchema), bridge: z.array(bridgeItemSchema) }).loose();
export const settingsSchema = z.object({ routes: z.array(routeSchema), cache_only: z.boolean().optional(), hard_stop: z.number().nullable().optional(), verified_threshold: z.number().nullable().optional(), low_bandwidth: z.boolean().optional() }).loose();
export const mutationSchema = z.object({ ok: z.boolean(), message: z.string().optional() }).loose();
export const estimateSchema = z.object({ estimated_credits: z.number().nonnegative(), calls: z.number().int().positive(), reference_text: z.string().nullable().optional(), exactness: z.enum(["exact", "estimated"]).optional() }).loose();
export const werResultSchema = z.object({ raw_transcript: z.string(), cleaned_transcript: z.string(), reference_text: z.string(), raw_wer: z.number().nonnegative(), cleaned_wer: z.number().nonnegative() }).loose();

export type Overview = z.infer<typeof overviewSchema>;
export type Credits = z.infer<typeof creditsSchema>;
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;
export type Ledger = z.infer<typeof ledgerSchema>;
export type Voiceprint = z.infer<typeof voiceprintSchema>;
export type Voiceprints = z.infer<typeof voiceprintsSchema>;
export type VerificationScores = z.infer<typeof verificationScoresSchema>;
export type RagContext = z.infer<typeof ragSchema>;
export type Prices = z.infer<typeof pricesSchema>;
export type People = z.infer<typeof peopleSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type Triage = z.infer<typeof triageSchema>;
