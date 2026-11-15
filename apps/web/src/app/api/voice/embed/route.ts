/**
 * POST /api/voice/embed — Step 1 of voice cloning.
 * Calls POST /api/v1/tts/voice-clone/embeddings (5–30 s of clean speech) and returns the
 * base64 `torch.bfloat16` payload together with the decoded float32[768] for the HUD.
 *
 * Falls back to the deterministic simulator when GNANI_API_KEY is absent or the account
 * is out of credits for that minute — the UI always shows which one answered.
 */
import { NextResponse } from "next/server";
import { gnaniCall, gnaniApiKey, gnaniMode, mockMeta } from "@/lib/gnani/client";
import { decodeEmbeddingB64, extractEmbeddingPayload, l2Norm, seededUnitVector } from "@/lib/gnani/bfloat16";
import { mockEmbedding, mockEmbeddingResponse } from "@/lib/gnani/mock";
import { sha256Short } from "@/lib/gnani/hash";
import { VC_EMBEDDINGS_PATH } from "@/lib/gnani/voices";
import { saveVoiceprint } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const startedAt = Date.now();
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: { code: "INVALID_REQUEST", message: "Expected multipart/form-data with audio_file." } }, { status: 400 });
  }

  const handle = (form.get("handle")?.toString() || "Demo Speaker").slice(0, 80);
  const role = (form.get("role")?.toString() || "citizen").slice(0, 24);
  const language = (form.get("language")?.toString() || "hi-IN").slice(0, 10);
  const persist = form.get("persist")?.toString() === "true";
  const file = form.get("audio_file");
  const hasAudio = file instanceof Blob && typeof (file as File).name === "string";
  const bytes = hasAudio ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array();

  if (hasAudio && bytes.byteLength < 9_000) {
    return NextResponse.json({ ok: false, error: { code: "AUDIO_TOO_SHORT", message: "Voice cloning needs 5–30 seconds of clear speech. Record a little longer." }, source: "computed", exactness: "exact" }, { status: 400 });
  }

  const mode = gnaniMode();
  const canCallLive = mode === "live" && Boolean(gnaniApiKey()) && bytes.byteLength > 0;

  let embeddingB64: string;
  let requestId: string;
  let source: "gnani" | "mock";
  let meta;
  let latency: number;

  if (canCallLive) {
    const formData = new FormData();
    formData.set("audio_file", new Blob([bytes as BlobPart], { type: (file as File).type || "audio/wav" }), (file as File).name || "reference.wav");
    const result = await gnaniCall<unknown>({
      kind: "vc_embed",
      path: VC_EMBEDDINGS_PATH,
      init: { method: "POST", body: formData },
      timeoutMs: 55_000,
      parse: async (response) => (await response.json()) as unknown,
    });
    const payload = result.ok ? extractEmbeddingPayload(result.data) : null;
    if (payload?.embedding) {
      embeddingB64 = payload.embedding;
      requestId = result.meta.requestId;
      source = "gnani";
      meta = result.meta;
      latency = result.meta.latencyMs;
    } else {
      const fallback = mockEmbeddingResponse(handle);
      embeddingB64 = fallback.data.voice_clone_embedding.embedding;
      requestId = `fallback-${await sha256Short(handle, 8)}`;
      source = "mock";
      latency = Date.now() - startedAt;
      meta = { ...mockMeta("vc_embed", requestId, latency), status: result.meta.status };
    }
  } else {
    const response = mockEmbeddingResponse(handle);
    embeddingB64 = response.data.voice_clone_embedding.embedding;
    requestId = `mock-${await sha256Short(handle, 8)}`;
    source = "mock";
    latency = Date.now() - startedAt;
    meta = mockMeta("vc_embed", requestId, latency);
  }

  let vector: number[];
  let norm: number;
  try {
    vector = decodeEmbeddingB64(embeddingB64);
    norm = l2Norm(vector);
  } catch {
    vector = seededUnitVector(handle);
    norm = 1;
    embeddingB64 = mockEmbedding(handle).embedding;
  }

  const digest = await sha256Short(embeddingB64, 24);
  const saved = persist && hasAudio
    ? await saveVoiceprint({ handle, role, language, embeddingB64, vector, sampleSeconds: Math.round(bytes.byteLength / 32_000) })
    : null;

  return NextResponse.json({
    ok: true,
    handle,
    role,
    language,
    speaker_embedding: { embedding: embeddingB64, shape: [1, 768], dtype: "torch.bfloat16" },
    embedding_f32: vector,
    l2_norm: norm,
    digest,
    sample_bytes: bytes.byteLength,
    sample_seconds: Math.round(bytes.byteLength / 32_000),
    persisted: saved?.data.id ?? null,
    store_mode: saved?.mode ?? null,
    meta,
    source,
    exactness: source === "gnani" ? "exact" : "estimated",
    latency_ms: latency,
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: VC_EMBEDDINGS_PATH,
    requirements: { seconds_min: 5, seconds_max: 30, formats: ["wav", "mp3"] },
    shape: [1, 768],
    dtype: "torch.bfloat16",
    mode: gnaniMode(),
    source: "computed",
    exactness: "exact",
  });
}
