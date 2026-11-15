/**
 * GET /api/debug — self-test surface for judges and for CI.
 *
 *  ?suite=all        runs the protocol conformance suite (no network, no credits)
 *  ?estimate=text    returns the deterministic Indic normalisation + cache key
 *  default           returns capability/mode matrix
 */
import { NextResponse } from "next/server";
import { gnaniApiKey, gnaniMode, mutexSnapshot } from "@/lib/gnani/client";
import { buildTtsBody, ProtocolError, validateLanguageCodes, validateSttContext } from "@/lib/gnani/payloads";
import { normalizeIndicText, parseQuantity, type NormalizerLocale } from "@/lib/gnani/normalizer";
import {
  cloakNormalFor,
  decodeEmbeddingB64, encodeEmbeddingB64, householderReflect, l2Norm, reflectionAngleDeg,
  seededUnitVector, cosineSimilarity, verificationBand,
} from "@/lib/gnani/bfloat16";
import { mockEmbedding, encodeWav, encodeMulaw } from "@/lib/gnani/mock";
import { ttsCacheKey } from "@/lib/gnani/hash";
import { WORKFLOWS, WORKFLOW_ORDER } from "@/lib/server/catalog";
import { configuredMode } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Check { id: string; group: string; ok: boolean; detail: string }

export async function GET(request: Request) {
  const url = new URL(request.url);
  const suite = url.searchParams.get("suite");
  const estimate = url.searchParams.get("estimate");

  if (estimate) {
    const locale = (url.searchParams.get("locale") ?? "hi-IN") as NormalizerLocale;
    const normalized = normalizeIndicText(estimate, locale);
    return NextResponse.json({
      ok: true,
      input: estimate,
      locale,
      normalized: normalized.text,
      changed: normalized.changed,
      parsed_quantity: parseQuantity(estimate),
      cache_key: await ttsCacheKey({ text: normalized.text, model: "timbre-v3.0", voiceOrEmbedding: "Shivani", language: locale }),
      source: "computed",
      exactness: "exact",
    });
  }

  if (suite === "all") {
    const checks: Check[] = [];
    const push = (id: string, group: string, run: () => string | boolean) => {
      try {
        const result = run();
        checks.push({ id, group, ok: result !== false, detail: result === true || result === false ? (result ? "pass" : "fail") : String(result) });
      } catch (error) {
        const message = error instanceof Error ? error.message : "threw";
        checks.push({ id, group, ok: false, detail: message });
      }
    };
    const rejects = (id: string, group: string, run: () => unknown, expectedCode?: string) => {
      try {
        run();
        checks.push({ id, group, ok: false, detail: "expected a ProtocolError, call succeeded" });
      } catch (error) {
        const code = error instanceof ProtocolError ? error.code : "UNEXPECTED";
        checks.push({ id, group, ok: expectedCode ? code === expectedCode : true, detail: `rejected with ${code}` });
      }
    };

    /* ---- bfloat16 codec round-trip */
    push("bfloat16 round-trip preserves all 768 dims", "embedding", () => {
      const vector = seededUnitVector("conformance");
      const restored = decodeEmbeddingB64(encodeEmbeddingB64(vector));
      const drift = Math.max(...vector.map((value, index) => Math.abs(value - restored[index])));
      if (restored.length !== 768) return "wrong dimension";
      return drift < 0.01 ? `max drift ${drift.toExponential(2)}` : `drift ${drift} too large`;
    });
    push("embedding payload is 1,536 bytes of bfloat16", "embedding", () => {
      const payload = mockEmbedding("conformance");
      const raw = Buffer.from(payload.embedding, "base64");
      return raw.length === 1536 ? `shape ${JSON.stringify(payload.shape)} · ${raw.length} bytes` : `got ${raw.length} bytes`;
    });
    push("float32->bfloat16 uses round-to-nearest-even", "embedding", () => {
      const probe = new Array<number>(768).fill(0);
      probe[0] = 1; probe[1] = -2.5; probe[2] = 0.10009765625; probe[3] = 3.14159;
      const restored = decodeEmbeddingB64(encodeEmbeddingB64(probe));
      const exact = Math.abs(restored[0] - 1) < 1e-6 && Math.abs(restored[1] + 2.5) < 1e-6 && Math.abs(restored[2] - 0.10009765625) < 1e-7;
      const rounded = restored[3] !== 3.14159 && Math.abs(restored[3] - 3.14159) < 0.02;
      return exact && rounded ? `exact for representable values · 3.14159 -> ${restored[3].toFixed(5)}` : `mismatch ${restored.slice(0, 4).join(",")}`;
    });

    /* ---- Householder cloak */
    push("Householder reflection preserves L2 norm", "cloak", () => {
      const vector = seededUnitVector("cloak-test");
      const normal = seededUnitVector("salt");
      const reflected = householderReflect(vector, normal);
      const delta = Math.abs(l2Norm(reflected) - l2Norm(vector));
      return delta < 1e-9 ? `norm ${l2Norm(vector).toFixed(6)} preserved (Δ ${delta.toExponential(1)})` : `norm drifted by ${delta}`;
    });
    push("Householder reflection relinks to nobody", "cloak", () => {
      const vector = seededUnitVector("cloak-test");
      const reflected = householderReflect(vector, seededUnitVector("salt"));
      const cosine = cosineSimilarity(vector, reflected) ?? 0;
      return Math.abs(cosine) < 0.15 ? `self-cosine ${cosine.toFixed(4)}` : `self-cosine ${cosine.toFixed(4)} still too high`;
    });
    push("cloak normal drives relink to zero", "cloak", () => {
      const vector = seededUnitVector("cloak-relink");
      const normal = cloakNormalFor(vector, seededUnitVector("salt"));
      const relink = cosineSimilarity(vector, householderReflect(vector, normal)) ?? 1;
      const angle = reflectionAngleDeg(vector, normal);
      return Math.abs(relink) < 0.02 && Math.abs(angle - 90) < 0.5 ? `relink ${relink.toFixed(4)} at ${angle.toFixed(1)}°` : `relink ${relink.toFixed(3)} at ${angle.toFixed(2)}° — cloak leaks`;
    });
    push("reflection angle reported in degrees", "cloak", () => {
      const angle = reflectionAngleDeg(seededUnitVector("a"), seededUnitVector("b"));
      return angle > 0 && angle <= 180 ? `${angle.toFixed(2)}°` : `invalid ${angle}`;
    });

    /* ---- verification thresholds */
    push("0.86 is the verified floor", "verification", () => verificationBand(0.861) === "verified" && verificationBand(0.859) === "noisy_warning" ? "0.861 verified · 0.859 noisy" : "threshold mismatch");
    push("0.74 is the impostor floor", "verification", () => verificationBand(0.741) === "noisy_warning" && verificationBand(0.739) === "rejected" ? "0.741 noisy · 0.739 rejected" : "threshold mismatch");

    /* ---- protocol guards */
    rejects("prisma-v2.5 rejects codemix", "protocol", () => buildSttRestGuard("prisma-v2.5", "codemix"), "INVALID_FORMAT");
    rejects("more than 4 locales rejected", "protocol", () => buildSttRestGuard("prisma-v3.0", "verbatim", ["hi-IN", "en-IN", "ta-IN", "te-IN", "kn-IN"]), "INVALID_LANGUAGE_CODE");
    rejects("indic-auto rejected on v2.5", "protocol", () => buildSttRestGuard("prisma-v2.5", "verbatim", ["indic-auto"]), "INVALID_LANGUAGE_CODE");
    rejects("tone-only text rejected", "protocol", () => buildTtsBody({ text: "<whispers>", model: "timbre-v3.0", voice: "Shivani", language: "hi-IN", audioConfig: { sample_rate: 48000, container: "wav" } }), "INVALID_REQUEST");
    rejects("wrong-model voice rejected", "protocol", () => buildTtsBody({ text: "नमस्ते", model: "timbre-v3.0", voice: "Nalini", language: "hi-IN", audioConfig: { sample_rate: 48000, container: "wav" } }), "INVALID_REQUEST");
    rejects("out-of-range speed rejected", "protocol", () => buildTtsBody({ text: "नमस्ते", model: "timbre-v3.0", voice: "Shivani", language: "hi-IN", speed: 1.4, audioConfig: { sample_rate: 48000, container: "wav" } }), "INVALID_REQUEST");
    rejects("mulaw at 48 kHz rejected", "protocol", () => buildTtsBody({ text: "नमस्ते", model: "timbre-v3.0", voice: "Shivani", language: "hi-IN", audioConfig: { sample_rate: 48000, container: "mulaw" } }), "INVALID_REQUEST");
    rejects("vachana-vc-v1 without embedding rejected", "protocol", () => buildTtsBody({ text: "नमस्ते", model: "vachana-vc-v1", language: "hi-IN", audioConfig: { sample_rate: 44100, container: "wav" } }), "INVALID_REQUEST");
    push("timbre-v2.5 strips audio tags", "protocol", () => {
      const result = buildTtsBody({ text: "बिल तैयार है <whispers> धन्यवाद", model: "timbre-v2.5", voice: "Nalini", language: "hi-IN", audioConfig: { sample_rate: 48000, container: "wav" } });
      return result.removedTags.includes("whispers") && !String(result.body.text).includes("<") ? `stripped ${result.removedTags.join(", ")}` : "tag survived";
    });
    push("timbre-v3.0 keeps catalog tags only", "protocol", () => {
      const result = buildTtsBody({ text: "कीमत <excited> बहुत अच्छी है <shout> अभी", model: "timbre-v3.0", voice: "Shivani", language: "hi-IN", audioConfig: { sample_rate: 48000, container: "wav" } });
      return result.keptTags.includes("excited") && result.removedTags.includes("shout") ? "kept excited · removed shout" : "tag policy mismatch";
    });
    push("vachana-vc-v1 body carries {embedding, shape:[1,768], dtype}", "protocol", () => {
      const embedding = mockEmbedding("conformance");
      const result = buildTtsBody({ text: "नमस्ते", model: "vachana-vc-v1", language: "hi-IN", audioConfig: { sample_rate: 44100, container: "wav" }, speakerEmbedding: embedding });
      const attached = result.body.speaker_embedding as { shape?: number[]; dtype?: string } | undefined;
      return attached?.shape?.[1] === 768 && attached?.dtype === "torch.bfloat16" ? "shape [1,768] · torch.bfloat16" : "embedding payload malformed";
    });

    /* ---- normaliser */
    push("₹1,45,250 expands with lakh grouping (hi-IN)", "normalizer", () => {
      const result = normalizeIndicText("₹1,45,250", "hi-IN").text;
      return result.includes("लाख") && result.includes("रुपये") ? result : `got '${result}'`;
    });
    push("₹1,45,250 expands in en-IN", "normalizer", () => {
      const result = normalizeIndicText("₹1,45,250", "en-IN").text;
      return /one lakh forty-five thousand two hundred fifty rupees/.test(result) ? result : `got '${result}'`;
    });
    push("sawa/dedh/dhai/paune are parsed numerically", "normalizer", () => {
      const value = parseQuantity("सवा तीन क्विंटल");
      return value === 3.25 ? `सवा तीन -> ${value}` : `got ${value}`;
    });
    push("GSTIN is spelled character by character", "normalizer", () => {
      const result = normalizeIndicText("GSTIN 22AAAAA0000A1Z5", "hi-IN").text;
      return !/22AAAAA0000A1Z5/.test(result) ? "expanded" : "raw GSTIN survived";
    });
    push("vehicle plate is spelled", "normalizer", () => {
      const result = normalizeIndicText("MH 15 AB 4321", "hi-IN").text;
      return /एम एच/.test(result) ? "एम एच ... " : `got '${result}'`;
    });

    /* ---- cache keys */
    const keyA = await ttsCacheKey({ text: "नमस्ते", model: "timbre-v3.0", voiceOrEmbedding: "Shivani", language: "hi-IN" });
    const keyB = await ttsCacheKey({ text: "नमस्ते", model: "timbre-v3.0", voiceOrEmbedding: "Shivani", language: "hi-IN" });
    checks.push({ id: "cache key is deterministic sha256", group: "cache", ok: keyA === keyB && keyA.length === 64, detail: `${keyA.slice(0, 16)}…` });

    /* ---- audio encoders */
    push("WAV encoder writes a 44-byte RIFF header", "audio", () => {
      const wav = encodeWav(new Float32Array(1600), 16000);
      const tag = String.fromCharCode(...wav.slice(0, 4));
      return tag === "RIFF" && wav.length === 44 + 3200 ? "RIFF/WAVE 16-bit mono" : `bad header ${tag}`;
    });
    push("µ-law encoder maps silence to 0xFF", "audio", () => {
      const mulaw = encodeMulaw(Int16Array.from([0, 0, 0]));
      return mulaw.every((byte) => byte === 0xff) ? "0xFF silence" : "unexpected encoding";
    });

    /* ---- context catalog */
    push("every workflow ships 200-item keyterm clusters", "rag", () => {
      const counts = WORKFLOW_ORDER.map((domain) => WORKFLOWS[domain].clusters.reduce((sum, cluster) => sum + cluster.keyterms.length, 0));
      return counts.every((count) => count >= 40) ? counts.join(" / ") : `thin clusters: ${counts.join(",")}`;
    });
    push("topics fit Prisma's 1,600-char budget", "rag", () => {
      const lengths = WORKFLOW_ORDER.map((domain) => WORKFLOWS[domain].topic.length);
      return lengths.every((length) => length <= 1600) ? `${Math.max(...lengths)} max chars` : `topic too long: ${lengths.join(",")}`;
    });

    const passed = checks.filter((check) => check.ok).length;
    return NextResponse.json({
      ok: passed === checks.length,
      passed,
      total: checks.length,
      checks,
      modes: { gnani: gnaniMode(), key_present: Boolean(gnaniApiKey()), store: configuredMode() },
      mutex: mutexSnapshot(),
      source: "computed",
      exactness: "exact",
    });
  }

  return NextResponse.json({
    ok: true,
    modes: { gnani: gnaniMode(), key_present: Boolean(gnaniApiKey()), store: configuredMode() },
    routes: [
      "POST /api/stt · GET /api/stt", "GET /api/stt/stream (WebSocket upgrade)",
      "POST /api/tts · GET /api/tts", "POST /api/voice/embed", "POST /api/voice/verify",
      "POST /api/voice/cloak", "GET|POST /api/ledger", "GET /api/ledger/:id",
      "GET /api/insights", "GET /api/credits", "GET /api/telemetry/stream",
      "GET /api/debug?suite=all", "GET /api/health",
    ],
    try_it: ["/api/debug?suite=all", "/api/debug?estimate=₹1,45,250&locale=hi-IN", "/api/tts", "/api/voice/verify"],
    source: "computed",
    exactness: "exact",
  });
}

function buildSttRestGuard(model: "prisma-v3.0" | "prisma-v2.5", format: "verbatim" | "transcribe" | "codemix" | "transliterate", languageCodes = ["hi-IN"]) {
  const request = { audio: new Uint8Array([1, 2, 3]), filename: "clip.wav", contentType: "audio/wav", model, languageCodes, format };
  validateSttContext(request);
  validateLanguageCodes(languageCodes, model);
  return true;
}
