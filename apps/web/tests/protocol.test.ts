/**
 * Protocol unit tests — no network, no credits, no Supabase.
 * Run: npm run test   (node --experimental-strip-types --test tests/*.test.ts)
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cloakNormalFor, cosineSimilarity, decodeEmbeddingB64, encodeEmbeddingB64, householderReflect,
  l2Norm, reflectionAngleDeg, seededUnitVector, verificationBand,
} from "../src/lib/gnani/bfloat16";
import { buildSttRestForm, buildTtsBody, validateLanguageCodes, validateSttContext, ProtocolError } from "../src/lib/gnani/payloads";
import { normalizeIndicText, parseQuantity, sanitizeAudioTags } from "../src/lib/gnani/normalizer";
import { mockEmbedding, encodeMulaw } from "../src/lib/gnani/mock";
import { ttsCacheKey } from "../src/lib/gnani/hash";
import { deterministicJudge } from "../src/lib/server/judge";

/* ---------------------------------------------------------------- bfloat16 */

test("embedding round-trips through bfloat16 at 768 dimensions", () => {
  const vector = seededUnitVector("round-trip");
  const restored = decodeEmbeddingB64(encodeEmbeddingB64(vector));
  assert.equal(restored.length, 768);
  // bfloat16 keeps 8 mantissa bits: relative error stays under 0.4 %.
  for (let index = 0; index < 768; index += 1) {
    assert.ok(Math.abs(restored[index] - vector[index]) < Math.max(1e-3, Math.abs(vector[index]) * 0.004), `dimension ${index} drifted`);
  }
});

test("bfloat16 payload is exactly 1,536 bytes", () => {
  const raw = Buffer.from(mockEmbedding("size").embedding, "base64");
  assert.equal(raw.length, 1536);
});

test("verification bands match the documented 0.86 / 0.74 thresholds", () => {
  assert.equal(verificationBand(0.861), "verified");
  assert.equal(verificationBand(0.86), "verified");
  assert.equal(verificationBand(0.859), "noisy_warning");
  assert.equal(verificationBand(0.74), "noisy_warning");
  assert.equal(verificationBand(0.739), "rejected");
});

/* ------------------------------------------------------------------- cloak */

test("Householder cloak preserves the L2 norm exactly", () => {
  const vector = seededUnitVector("cloak-norm");
  const normal = cloakNormalFor(vector, seededUnitVector("salt"));
  const cloaked = householderReflect(vector, normal);
  assert.ok(Math.abs(l2Norm(cloaked) - l2Norm(vector)) < 1e-9);
});

test("Householder cloak unlinks the print from itself", () => {
  const vector = seededUnitVector("cloak-unlink");
  const normal = cloakNormalFor(vector, seededUnitVector("salt"));
  const cloaked = householderReflect(vector, normal);
  assert.ok(Math.abs(cosineSimilarity(vector, cloaked) ?? 1) < 0.02, "cloaked print still links to the original");
  assert.ok(Math.abs(reflectionAngleDeg(vector, normal) - 90) < 0.5, "rotation should be 90°");
});

/* ---------------------------------------------------------------- protocol */

test("prisma-v2.5 rejects v3-only formats instead of silently downgrading", () => {
  assert.throws(() => validateSttContext({ audio: new Uint8Array([1]), filename: "a.wav", contentType: "audio/wav", model: "prisma-v2.5", languageCodes: ["hi-IN"], format: "codemix" }), ProtocolError);
});

test("prisma-v3.0 accepts at most four locales", () => {
  assert.doesNotThrow(() => validateLanguageCodes(["hi-IN", "ta-IN", "te-IN", "kn-IN"], "prisma-v3.0"));
  assert.throws(() => validateLanguageCodes(["hi-IN", "ta-IN", "te-IN", "kn-IN", "mr-IN"], "prisma-v3.0"), ProtocolError);
});

test("audio tags are case-sensitive and stripped for non-v3 models", () => {
  assert.deepEqual(sanitizeAudioTags("कीमत <excited> अच्छी है", "timbre-v3.0", ["excited"]), { text: "कीमत <excited> अच्छी है", removed: [], kept: ["excited"] });
  assert.deepEqual(sanitizeAudioTags("कीमत <Excited> अच्छी है", "timbre-v3.0", ["excited"]), { text: "कीमत अच्छी है", removed: ["Excited"], kept: [] });
  assert.deepEqual(sanitizeAudioTags("कीमत <excited> अच्छी है", "timbre-v2.5", ["excited"]), { text: "कीमत अच्छी है", removed: ["excited"], kept: [] });
});

test("tag-only text is rejected (Gnani answers 400 for it)", () => {
  assert.throws(() => buildTtsBody({ text: "<whispers>", model: "timbre-v3.0", voice: "Shivani", language: "hi-IN", audioConfig: { sample_rate: 48000, container: "wav" } }), ProtocolError);
});

test("voices cannot be mixed across models", () => {
  assert.throws(() => buildTtsBody({ text: "नमस्ते", model: "timbre-v3.0", voice: "Nalini", language: "hi-IN", audioConfig: { sample_rate: 48000, container: "wav" } }), ProtocolError);
});

test("mulaw forces 8 kHz", () => {
  assert.throws(() => buildTtsBody({ text: "नमस्ते", model: "timbre-v3.0", voice: "Shivani", language: "hi-IN", audioConfig: { sample_rate: 48000, container: "mulaw" } }), ProtocolError);
  assert.doesNotThrow(() => buildTtsBody({ text: "नमस्ते", model: "timbre-v3.0", voice: "Shivani", language: "hi-IN", audioConfig: { sample_rate: 8000, container: "mulaw" } }));
});

test("vachana-vc-v1 requires a speaker embedding and caps sample_rate at 44100 Hz", () => {
  assert.throws(() => buildTtsBody({ text: "नमस्ते", model: "vachana-vc-v1", language: "hi-IN", audioConfig: { sample_rate: 44100, container: "wav" } }), ProtocolError);
  assert.throws(() => buildTtsBody({ text: "नमस्ते", model: "vachana-vc-v1", language: "hi-IN", audioConfig: { sample_rate: 48000, container: "wav" }, speakerEmbedding: { embedding: mockEmbedding("x").embedding, shape: [1, 768], dtype: "torch.bfloat16" } }), ProtocolError);
  const valid = buildTtsBody({ text: "नमस्ते", model: "vachana-vc-v1", language: "hi-IN", audioConfig: { sample_rate: 44100, container: "wav" }, speakerEmbedding: { embedding: mockEmbedding("x").embedding, shape: [1, 768], dtype: "torch.bfloat16" } });
  assert.equal("language" in valid.body, false);
});

test("buildTtsBody selects matching default encoding for ogg and mulaw containers", () => {
  const ogg = buildTtsBody({ text: "नमस्ते", model: "timbre-v3.0", voice: "Shivani", language: "hi-IN", audioConfig: { sample_rate: 48000, container: "ogg" } });
  assert.equal((ogg.body.audio_config as { encoding: string }).encoding, "oggopus");
  const mulaw = buildTtsBody({ text: "नमस्ते", model: "timbre-v3.0", voice: "Shivani", language: "hi-IN", audioConfig: { sample_rate: 8000, container: "mulaw" } });
  assert.equal((mulaw.body.audio_config as { encoding: string }).encoding, "pcm_mulaw");
});

test("buildSttRestForm sets enable_substitution and patterns/replacement rules", () => {
  const form = buildSttRestForm({
    audio: new Uint8Array([1, 2, 3, 4]),
    filename: "clip.wav",
    contentType: "audio/wav",
    model: "prisma-v3.0",
    languageCodes: ["hi-IN"],
    substitutionMap: [{ patterns: ["ok", "okay"], replacement: "acknowledged" }],
  });
  assert.equal(form.get("enable_substitution"), "true");
  assert.deepEqual(JSON.parse(String(form.get("substitution_map"))), [{ patterns: ["ok", "okay"], replacement: "acknowledged" }]);
});

/* -------------------------------------------------------------- normalizer */

test("₹ and lakh/crore are spoken, not printed", () => {
  const result = normalizeIndicText("₹2,450 प्रति क्विंटल", "hi-IN");
  assert.ok(!result.text.includes("₹"));
  assert.ok(result.currency > 0);
});

test("colloquial fractions become exact quantities", () => {
  assert.equal(parseQuantity("सवा तीन क्विंटल"), 3.25);
  assert.equal(parseQuantity("ढाई"), 2.5);
});

test("identifiers are read digit-by-digit", () => {
  const result = normalizeIndicText("ट्रैक्टर MH12AB1234", "hi-IN");
  assert.ok(result.identifiers > 0);
});

/* -------------------------------------------------------------------- judge */

test("deterministic judge extracts quantity, rate and total", () => {
  const draft = deterministicJudge("mandi", "गेहूँ 50 क्विंटल, भाव 2450 रुपये प्रति क्विंटल, 30 दिन में पेमेंट");
  assert.equal(draft.commodity, "गेहूँ");
  assert.equal(draft.quantity_quintal, 50);
  assert.equal(draft.rate_per_quintal, 2450);
  assert.equal(draft.total_inr, 122500);
  assert.equal(draft.credit_days, 30);
});

test("deterministic judge reads spoken quantities", () => {
  const draft = deterministicJudge("mandi", "सवा तीन क्विंटल सोना मसूरी, भाव 146000 रुपये (1.25) प्रति क्विंटल");
  assert.equal(draft.quantity_quintal, 3.25);
  assert.equal(draft.rate_per_quintal, 146000);
});

test("kirana catalogue captures per-item quantities", () => {
  const draft = deterministicJudge("kirana", "तीन पैकेट Parle-G और दो किलो आटा");
  assert.equal(draft.items?.length, 2);
  assert.equal(draft.items?.find((item) => item.name.includes("Parle"))?.qty, 3);
});

/* -------------------------------------------------------------- cache + µ-law */

test("cache key is content addressed on text+model+voice+language", async () => {
  const base = { text: "नमस्ते", model: "timbre-v3.0", voiceOrEmbedding: "Shivani", language: "hi-IN" };
  const first = await ttsCacheKey(base);
  assert.equal(first, await ttsCacheKey({ ...base }));
  assert.notEqual(first, await ttsCacheKey({ ...base, voiceOrEmbedding: "Avinash" }));
  assert.equal(first.length, 64);
});

test("G.711 µ-law encoder emits one byte per sample", () => {
  const samples = new Int16Array(1600).map((_, index) => Math.round(8000 * Math.sin(index / 8)));
  assert.equal(encodeMulaw(samples).length, 1600);
});
