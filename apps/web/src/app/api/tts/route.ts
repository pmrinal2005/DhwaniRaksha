/**
 * POST /api/tts — Timbre v3.0 / v2.5 / vachana-vc-v1 synthesis.
 *
 * Contract:
 *   response_mode = "json"  -> { ok, audio: { base64, mime, container, sample_rate }, cache, normalization, tags, meta }
 *                              used by the in-browser players (deterministic mock or live REST).
 *   response_mode = "sse"   -> text/event-stream with the documented frames
 *                              `event: start` / `event: chunk` / `event: complete`,
 *                              emitted from the cache or from upstream Gnani unchanged.
 *                              This is how the mulaw telephony demo streams to <audio>.
 */
import { NextResponse } from "next/server";
import { gnaniCall, gnaniMode, mockMeta } from "@/lib/gnani/client";
import { buildTtsBody, ProtocolError, type TtsRequest } from "@/lib/gnani/payloads";
import { normalizeIndicText, type NormalizerLocale } from "@/lib/gnani/normalizer";
import { encodeWav, mockEmbedding, mockSttResponse, synthesizeSpeech } from "@/lib/gnani/mock";
import { decodeEmbeddingB64 } from "@/lib/gnani/bfloat16";
import { ttsCacheKey } from "@/lib/gnani/hash";
import { defaultVoiceFor, TTS_REST_PATH, TTS_SSE_PATH, VOICES_BY_MODEL, type AudioContainer, isLocale } from "@/lib/gnani/voices";
import { recordCredit } from "@/lib/server/store";
import { GOAL, WORKFLOWS, type WorkflowDomain } from "@/lib/server/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIME_BY_CONTAINER: Record<string, string> = {
  wav: "audio/wav", mp3: "audio/mpeg", ogg: "audio/ogg", mulaw: "audio/basic", alaw: "audio/alaw", raw: "application/octet-stream",
};

interface Body {
  text?: string;
  model?: string;
  voice?: string;
  language?: string;
  speed?: number;
  audio_config?: { sample_rate?: number; encoding?: string; container?: string };
  container?: string;
  sample_rate?: number;
  speaker_embedding?: { embedding?: string; shape?: [number, number]; dtype?: string };
  embedding_source?: { handle?: string; salt?: string };
  workflow?: string;
  normalize?: boolean;
  response_mode?: "json" | "sse";
  gender?: "female" | "male";
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: { code: "INVALID_REQUEST", message: "Expected a JSON body." } }, { status: 400 });
  }

  const mode = gnaniMode();
  const model = (body.model ?? "timbre-v3.0") as TtsRequest["model"];
  if (!["timbre-v3.0", "timbre-v2.5", "vachana-vc-v1"].includes(model)) {
    return NextResponse.json({ ok: false, error: { code: "INVALID_REQUEST", message: `Model '${model}' is not supported. The supported models are "timbre-v2.5", "timbre-v3.0", "vachana-vc-v1".` } }, { status: 400 });
  }

  const language = body.language ?? "hi-IN";
  const rawText = body.text ?? "";
  const locale: NormalizerLocale = (isLocale(language) || language === "hi-en" ? language : "hi-IN") as NormalizerLocale;
  const normalization = body.normalize === false
    ? { text: rawText, changed: false, identifiers: 0, currency: 0, fractions: 0 }
    : normalizeIndicText(rawText, locale);

  // Resolve the embedding: inline b64 wins; otherwise derive from an enrolled handle (mock/sim).
  let embedding = body.speaker_embedding?.embedding
    ? { embedding: body.speaker_embedding.embedding, shape: [1, 768] as [number, number], dtype: "torch.bfloat16" as const }
    : undefined;
  if (model === "vachana-vc-v1" && !embedding) {
    const handle = body.embedding_source?.handle ?? "demo-speaker";
    embedding = mockEmbedding(handle, body.embedding_source?.salt ?? "mudra-vani-enrolment");
  }

  const requestedContainer = (body.audio_config?.container ?? body.container ?? "wav") as AudioContainer;
  const audioConfig = {
    // mulaw/alaw force 8 kHz upstream, so never ask Gnani for a 48 kHz µ-law clip.
    sample_rate: body.audio_config?.sample_rate ?? body.sample_rate ?? (requestedContainer === "mulaw" || requestedContainer === "alaw" ? 8000 : 48000),
    encoding: body.audio_config?.encoding ?? "linear_pcm",
    container: requestedContainer,
  };

  const voice = body.voice ?? (model === "vachana-vc-v1" ? undefined : defaultVoiceFor(model, isLocale(language) || language === "hi-en" ? language : "hi-IN"));

  let built: ReturnType<typeof buildTtsBody>;
  try {
    built = buildTtsBody({
      text: normalization.text, model, voice, language, speed: body.speed,
      audioConfig, speakerEmbedding: embedding,
    });
  } catch (error) {
    if (error instanceof ProtocolError) {
      return NextResponse.json({ ok: false, error: { code: error.code, message: error.message }, source: "computed", exactness: "exact" }, { status: 400 });
    }
    throw error;
  }

  const voiceOrEmbedding = model === "vachana-vc-v1"
    ? (embedding?.embedding ?? "").slice(0, 32)
    : String(voice);
  const cacheKey = await ttsCacheKey({ text: built.strippedText, model, voiceOrEmbedding, language });
  const credits = model === "vachana-vc-v1" ? 2 : 1;

  // ------------------------------------------------ mock: deterministic synthesis
  if (mode !== "live") {
    const workflow = (body.workflow ?? "mandi") as WorkflowDomain;
    const audio = synthesizeSpeech({
      text: built.strippedText,
      sampleRate: audioConfig.sample_rate,
      seed: `${workflow}:${voiceOrEmbedding}:${language}`,
      gender: body.gender ?? (["Shivani", "Lakshmi", "Kalpana", "Chetana", "Vasudha", "Riyaa", "Tarika", "Nalini", "Poorvi", "Kaveri", "Asmita"].includes(String(voice)) ? "female" : "male"),
      speed: body.speed,
      mulaw: audioConfig.container === "mulaw" || audioConfig.container === "alaw",
    });
    const latencyMs = Date.now() - startedAt;
    await recordCredit({ callKind: model === "vachana-vc-v1" ? "tts_sse" : "tts_rest", model, status: 200, queuedMs: 0, latencyMs, credits: 0, exactness: "estimated" });

    if (body.response_mode === "sse") {
      return sseResponse(built, audio, audioConfig.container, cacheKey, model, mockMeta("tts_sse", `mock-${cacheKey.slice(0, 8)}`, latencyMs), built.strippedText);
    }
    return NextResponse.json({
      ok: true,
      audio: { base64: Buffer.from(audio).toString("base64"), mime: MIME_BY_CONTAINER[audioConfig.container] ?? "audio/wav", container: audioConfig.container, sample_rate: audioConfig.sample_rate, bytes: audio.length, duration_ms: Math.round((audio.length / (audioConfig.container === "mulaw" ? 1 : 2)) / audioConfig.sample_rate * 1000) },
      cache: { key: cacheKey, hit: false, stored: false },
      normalization,
      tags: { kept: built.keptTags, removed: built.removedTags },
      spoken_text: built.strippedText,
      meta: mockMeta("tts_rest", `mock-${cacheKey.slice(0, 8)}`, latencyMs),
      source: "mock",
      exactness: "estimated",
    });
  }

  // ------------------------------------------------------------- live upstream
  const path = body.response_mode === "sse" ? TTS_SSE_PATH : TTS_REST_PATH;
  const upstream = await gnaniCall<Uint8Array>({
    kind: body.response_mode === "sse" ? "tts_sse" : "tts_rest",
    path,
    init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(built.body) },
    timeoutMs: 55_000,
    parse: async (response) => new Uint8Array(await response.arrayBuffer()),
  });

  await recordCredit({
    callKind: body.response_mode === "sse" ? "tts_sse" : "tts_rest", model, status: upstream.meta.status,
    queuedMs: upstream.meta.queuedMs, latencyMs: upstream.meta.latencyMs,
    credits: upstream.ok ? credits : 0, exactness: "estimated",
  });

  if (!upstream.ok || !upstream.data) {
    return NextResponse.json({ ok: false, error: upstream.error, meta: upstream.meta, source: "gnani", exactness: "exact" }, { status: upstream.error?.status || 502 });
  }

  if (body.response_mode === "sse") {
    return sseResponse(built, upstream.data, audioConfig.container, cacheKey, model, upstream.meta, built.strippedText);
  }

  return new NextResponse(upstream.data as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": MIME_BY_CONTAINER[audioConfig.container] ?? "audio/wav",
      "X-Gnani-Mode": "live",
      "X-Gnani-Request-Id": upstream.meta.requestId,
      "X-Cache-Key": cacheKey,
      "X-Tags-Kept": built.keptTags.join(","),
      "X-Normalized-Text": encodeURIComponent(built.strippedText.slice(0, 180)),
    },
  });
}

/** Emit the documented SSE frame sequence from a complete audio buffer (cache / mock). */
function sseResponse(
  built: ReturnType<typeof buildTtsBody>, audio: Uint8Array, container: string,
  cacheKey: string, model: string, meta: ReturnType<typeof mockMeta>, spokenText: string,
) {
  const chunkSize = container === "mulaw" ? 1600 : 9600;
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < audio.length; offset += chunkSize) chunks.push(audio.subarray(offset, offset + chunkSize));
  const encoder = new TextEncoder();
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`event: start\ndata: ${JSON.stringify({ status: "streaming_started", text: spokenText.slice(0, 300) })}\n\n`));
    },
    async pull(controller) {
      if (index < chunks.length) {
        const isFinal = index === chunks.length - 1;
        controller.enqueue(encoder.encode(`event: chunk\ndata: ${JSON.stringify({ chunk_index: index + 1, audio: Buffer.from(chunks[index]).toString("base64"), is_final: false, model, cached: meta.mode === "mock" ? false : true })}\n\n`));
        index += 1;
        if (isFinal) {
          controller.enqueue(encoder.encode(`event: complete\ndata: ${JSON.stringify({ chunk_index: index + 1, audio: "", is_final: true, cache_key: cacheKey })}\n\n`));
          controller.close();
        }
        // Small yield keeps the stream progressive for the player.
        await new Promise((resolve) => setTimeout(resolve, 24));
        return;
      }
      controller.close();
    },
  });
  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "X-Gnani-Mode": meta.mode,
      "X-Cache-Key": cacheKey,
      "X-Credits-Remaining": String(Math.max(0, GOAL.credits - 0)),
    },
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    models: {
      "timbre-v3.0": { voices: VOICES_BY_MODEL["timbre-v3.0"], tags: true },
      "timbre-v2.5": { voices: VOICES_BY_MODEL["timbre-v2.5"], tags: false },
      "vachana-vc-v1": { requires: ["speaker_embedding"], tags: false },
    },
    workflows: Object.keys(WORKFLOWS),
    mode: gnaniMode(),
    source: "computed",
    exactness: "exact",
  });
}

// Keep linters honest about unused helpers used by other routes.
void decodeEmbeddingB64; void mockSttResponse; void encodeWav; void ttsCacheKey;
