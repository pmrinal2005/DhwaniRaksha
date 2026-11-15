import { NextResponse } from "next/server";
import { gnaniCall, gnaniMode, mockMeta } from "@/lib/gnani/client";
import { buildSttRestForm, ProtocolError, resolveLanguageCodes, type SttRestRequest } from "@/lib/gnani/payloads";
import { mockSttResponse } from "@/lib/gnani/mock";
import { STT_REST_PATH, type SttFormat, type SttModel } from "@/lib/gnani/voices";
import { keytermsForDomain, WORKFLOWS, workflowMeta, type WorkflowDomain } from "@/lib/server/catalog";
import { recordCredit } from "@/lib/server/store";
import { sha256Short } from "@/lib/gnani/hash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * POST /api/stt — Prisma v3.0 / v2.5 REST transcription.
 * multipart/form-data: audio_file | text (mock only), model, language_code,
 * format, workflow, keyterms, topic, previous_text, speaker_names.
 */
export async function POST(request: Request) {
  const startedAt = Date.now();
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: { code: "INVALID_REQUEST", message: "Expected multipart/form-data." }, source: "computed", exactness: "exact" }, { status: 400 });
  }

  const model = (form.get("model")?.toString() || "prisma-v3.0") as SttModel;
  if (!["prisma-v3.0", "prisma-v2.5"].includes(model)) {
    return NextResponse.json({ ok: false, error: { code: "INVALID_MODEL", message: `Invalid model '${model}'. Supported models: prisma-v2.5, prisma-v3.0` }, source: "gnani", exactness: "exact" }, { status: 400 });
  }
  const workflow = (form.get("workflow")?.toString() || "mandi") as WorkflowDomain;
  const meta = WORKFLOWS[workflow] ?? WORKFLOWS.mandi;
  const languageCodes = resolveLanguageCodes(form.get("language_code")?.toString() ?? "indic-auto", model);
  const format = (form.get("format")?.toString() || undefined) as SttFormat | undefined;

  const keyterms = parseList(form.get("keyterms")) ?? keytermsForDomain(meta.domain);
  const topic = form.get("topic")?.toString() || meta.topic;
  const previousText = form.get("previous_text")?.toString() || undefined;
  const speakerNames = parseList(form.get("speaker_names")) ?? [meta.parties.a.name, meta.parties.b.name];

  const file = form.get("audio_file");
  const isBlob = file instanceof Blob && typeof (file as File).name === "string";
  const bytes = isBlob ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array();
  if (bytes.byteLength > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: { code: "MAX_AUDIO_DURATION_EXCEEDED", message: "Upload is larger than 10 MB." }, source: "computed", exactness: "exact" }, { status: 413 });
  }

  const mode = gnaniMode();
  const wantsLive = mode === "live" && bytes.byteLength > 0;
  const seed = await sha256Short(`${workflow}:${bytes.byteLength}:${(form.get("seed")?.toString() ?? "0")}`, 10);

  if (!wantsLive) {
    if (bytes.byteLength > 0 && bytes.byteLength < 2_400) {
      return NextResponse.json({ ok: false, error: { code: "EMPTY_AUDIO", message: "Audio is shorter than the 0.1 s minimum; nothing to transcribe." }, source: "computed", exactness: "exact" }, { status: 400 });
    }
    const mock = mockSttResponse({ domain: meta.domain, keyterms, format: format ?? "verbatim", model, seed, detectedLanguage: languageCodes[0] === "indic-auto" ? meta.parties.a.locale : languageCodes[0] });
    const latencyMs = Date.now() - startedAt;
    await recordCredit({ callKind: "stt_rest", model, status: 200, queuedMs: 0, latencyMs, credits: 0, exactness: "estimated" });
    return NextResponse.json({
      ok: true,
      transcript: mock.transcript,
      model,
      detected_language_code: mock.detected_language_code ?? null,
      format: format ?? "verbatim",
      language_codes: languageCodes,
      keyterms_count: keyterms.length,
      keyterm_hits: keyterms.filter((term) => mock.transcript.includes(term)).slice(0, 12),
      speakers: speakerNames.slice(0, 4),
      context: { topic_chars: topic.length, previous_text_chars: previousText?.length ?? 0, keyterms_count: keyterms.length },
      meta: mockMeta("stt_rest", mock.request_id, latencyMs),
      source: "mock",
      exactness: "estimated",
    });
  }

  // ---- live call to api.vachana.ai/stt/v3
  const filename = isBlob ? (file as File).name || "audio.wav" : "audio.wav";
  const contentType = isBlob ? (file as File).type || "audio/wav" : "audio/wav";
  const sttRequest: SttRestRequest = {
    audio: bytes, filename, contentType, model, languageCodes, format,
    keyterms, topic, previousText, speakerNames,
  };
  let formData: FormData;
  try {
    formData = buildSttRestForm(sttRequest);
  } catch (error) {
    if (error instanceof ProtocolError) {
      return NextResponse.json({ ok: false, error: { code: error.code, message: error.message }, source: "computed", exactness: "exact" }, { status: 400 });
    }
    throw error;
  }

  const result = await gnaniCall<Record<string, unknown>>({
    kind: "stt_rest",
    path: STT_REST_PATH,
    init: { method: "POST", body: formData },
    timeoutMs: 55_000,
    parse: async (response) => (await response.json()) as Record<string, unknown>,
  });

  await recordCredit({
    callKind: "stt_rest", model, status: result.meta.status, queuedMs: result.meta.queuedMs,
    latencyMs: result.meta.latencyMs, credits: result.ok ? 1 : 0, exactness: "estimated",
  });

  if (!result.ok || !result.data) {
    return NextResponse.json({ ok: false, error: result.error, meta: result.meta, source: "gnani", exactness: "exact" }, { status: result.error?.status || 502 });
  }
  const transcript = String(result.data.transcript ?? "");
  return NextResponse.json({
    ok: true,
    transcript,
    model: String(result.data.model ?? model),
    detected_language_code: result.data.detected_language_code ?? null,
    processing_time: result.data.processing_time ?? null,
    end_to_end_latency: result.data.end_to_end_latency ?? null,
    request_id: result.data.request_id ?? result.meta.requestId,
    keyterms_count: keyterms.length,
    keyterm_hits: keyterms.filter((term) => transcript.includes(term)).slice(0, 12),
    context: { topic_chars: topic.length, previous_text_chars: previousText?.length ?? 0, keyterms_count: keyterms.length },
    meta: result.meta,
    source: "gnani",
    exactness: "exact",
  });
}

function parseList(value: FormDataEntryValue | null): string[] | null {
  if (!value) return null;
  const raw = value.toString().trim();
  if (!raw) return null;
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String).slice(0, 200);
    } catch { /* fall through to comma split */ }
  }
  return raw.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 200);
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: STT_REST_PATH,
    models: ["prisma-v3.0", "prisma-v2.5"],
    formats: { "prisma-v3.0": ["verbatim", "transcribe", "codemix", "transliterate"], "prisma-v2.5": ["verbatim", "transcribe"] },
    limits: { bytes: MAX_BYTES, seconds: 30, keyterms: 200, topicChars: 1600, languages: 4 },
    mode: gnaniMode(),
    source: "computed",
    exactness: "exact",
  });
}
