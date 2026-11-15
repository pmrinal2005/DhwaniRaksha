/**
 * WebSocket upgrade bridge: browser <-> Next.js <-> wss://api.vachana.ai/stt/v3/stream
 *
 * Browsers cannot set upgrade headers, so this route attaches
 * `x-api-key-id`, `model`, `language_code`, `x-sample-rate`, the RAG context
 * (keyterms / topic / previous_text / speaker_names) and VAD tuning headers,
 * then relays binary PCM down and JSON segments up unchanged.
 *
 * Hosts without raw WebSocket upgrade support (e.g. Vercel Node functions) get a
 * 501 with `fallback: "rest_chunk"` and the dashboard automatically degrades to
 * short REST clips — the documented Prisma REST path — so the feature never dies.
 */
import { NextResponse, type NextRequest } from "next/server";
import { gnaniApiKey, gnaniMode } from "@/lib/gnani/client";
import { resolveLanguageCodes, validateLanguageCodes } from "@/lib/gnani/payloads";
import { CONTEXT_LIMITS, STT_WS_PATH } from "@/lib/gnani/voices";
import { keytermsForDomain, WORKFLOWS, workflowMeta, type WorkflowDomain } from "@/lib/server/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PairSocket = {
  accept(options?: { headers?: Record<string, string> }): unknown;
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "message", handler: (event: { data: unknown }) => void): void;
  addEventListener(type: "close", handler: (event: { code?: number }) => void): void;
};

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const workflow = (url.searchParams.get("workflow") ?? "mandi") as WorkflowDomain;
  const meta = WORKFLOWS[workflow] ?? WORKFLOWS.mandi;
  const model = url.searchParams.get("model") === "prisma-v2.5" ? "prisma-v2.5" : "prisma-v3.0";
  const format = url.searchParams.get("format") ?? (model === "prisma-v3.0" ? "codemix" : "verbatim");
  const sampleRate = Number(url.searchParams.get("sample_rate") ?? 16000);
  const topic = (url.searchParams.get("topic") ?? meta.topic).slice(0, CONTEXT_LIMITS.topic);
  const previousText = (url.searchParams.get("previous_text") ?? "").slice(-CONTEXT_LIMITS.previousText);
  const keyterms = (url.searchParams.get("keyterms") ?? keytermsForDomain(meta.domain).join(",")).split(",").filter(Boolean).slice(0, CONTEXT_LIMITS.keyterms);
  const speakerNames = (url.searchParams.get("speaker_names") ?? `${meta.parties.a.name},${meta.parties.b.name}`).split(",").filter(Boolean).slice(0, CONTEXT_LIMITS.speakerNames);

  let languageCodes: string[];
  try {
    languageCodes = resolveLanguageCodes(url.searchParams.get("language_code") ?? "indic-auto", model);
    validateLanguageCodes(languageCodes, model);
  } catch (error) {
    return NextResponse.json({ ok: false, error: { code: "INVALID_LANGUAGE_CODE", message: error instanceof Error ? error.message : "Invalid language code." } }, { status: 400 });
  }

  const contextPreview = {
    model, format, sample_rate: sampleRate, language_codes: languageCodes,
    keyterms_count: keyterms.length, topic_chars: topic.length, speakers: speakerNames,
    previous_text_chars: previousText.length,
  };

  if ((request.headers.get("upgrade") ?? "").toLowerCase() !== "websocket") {
    return NextResponse.json({ ok: true, endpoint: STT_WS_PATH, context: contextPreview, mode: gnaniMode(), source: "computed", exactness: "exact" });
  }

  const pairFactory = (globalThis as unknown as { WebSocketPair?: new () => Record<string, PairSocket> }).WebSocketPair;
  if (!pairFactory) {
    return NextResponse.json({
      ok: false,
      fallback: "rest_chunk",
      error: {
        code: "UPGRADE_UNSUPPORTED",
        message: "This host cannot hold raw WebSocket upgrades. The panel is switching to 4-second Prisma REST clips instead — same model, same RAG context, zero data loss.",
      },
      context: contextPreview,
      source: "computed",
      exactness: "exact",
    }, { status: 501 });
  }

  const pair = new pairFactory();
  const client = pair[0];
  const server = pair[1];
  server.accept();

  const mode = gnaniMode();
  const key = gnaniApiKey();

  if (mode !== "live" || !key) {
    let bufferBytes = 0;
    let committed = 0;
    let segment = 0;
    const startedAt = Date.now();
    server.send(JSON.stringify({ type: "connected", mode: "mock", ...contextPreview }));
    server.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        try {
          const frame = JSON.parse(event.data) as { type?: string };
          if (frame.type === "commit") {
            segment += 1;
            server.send(JSON.stringify({ type: "processing", segment_id: `mock-seg-${segment}` }));
            const sentence = meta.sampleUtterance;
            setTimeout(() => {
              server.send(JSON.stringify({
                type: "transcript", text: sentence, segment_id: `mock-seg-${segment}`,
                detected_language_code: meta.parties.a.locale, latency: 300 + (committed % 4) * 26,
                is_final: true, format, keyterms_hit: keyterms.slice(0, 3),
              }));
            }, 200);
            committed += 1;
          }
        } catch { /* ignore malformed control frame */ }
        return;
      }
      bufferBytes += (event.data as ArrayBufferLike).byteLength ?? 0;
      // Emulate VAD segmentation server-side: one segment per ~1.6 s of audio.
      if (bufferBytes >= 1.6 * sampleRate * 2) {
        bufferBytes = 0;
        segment += 1;
        server.send(JSON.stringify({
          type: "transcript", text: meta.sampleUtterance, segment_id: `mock-auto-${segment}`,
          detected_language_code: meta.parties.a.locale, latency: 240 + (Date.now() - startedAt) % 120,
          is_final: true, format, interim: true, keyterms_hit: keyterms.slice(0, 3),
        }));
      }
    });
    return new Response(null, { status: 101, webSocket: client } as unknown as ResponseInit);
  }

  // ---- live upstream (Node runtime, headers-capable client)
  const headers: Record<string, string> = {
    "x-api-key-id": key,
    model,
    language_code: languageCodes.join(","),
    "x-sample-rate": String(sampleRate),
    format,
    keyterms: JSON.stringify(keyterms),
    topic,
    speaker_names: JSON.stringify(speakerNames),
    "x-vad-threshold": sampleRate === 8000 ? "0.7" : "0.55",
    "x-min-silence-ms": "500",
    "x-min-speech-ms": sampleRate === 8000 ? "200" : "100",
    "x-idle-timeout-sec": "300",
  };
  if (previousText) headers.previous_text = previousText;

  let upstream: import("ws").WebSocket;
  try {
    const { WebSocket: NodeWebSocket } = await import("ws");
    upstream = new NodeWebSocket(`wss://api.vachana.ai${STT_WS_PATH}`, { headers });
  } catch (error) {
    server.send(JSON.stringify({ type: "error", message: `Could not open upstream STT socket: ${error instanceof Error ? error.message : "unknown error"}` }));
    server.close(1011, "upstream unavailable");
    return new Response(null, { status: 101, webSocket: client } as unknown as ResponseInit);
  }

  upstream.on("open", () => server.send(JSON.stringify({ type: "connected", mode: "live", ...contextPreview })));
  upstream.on("message", (data, isBinary) => {
    if (!isBinary) server.send(data.toString());
  });
  upstream.on("error", (error) => server.send(JSON.stringify({ type: "error", message: error.message })));
  upstream.on("close", (code) => {
    server.send(JSON.stringify({ type: "error", message: `Upstream closed (${code}).` }));
    try { server.close(1000, "upstream closed"); } catch { /* already closed */ }
  });

  server.addEventListener("message", (event) => {
    if (upstream.readyState !== 1) return;
    if (typeof event.data === "string") upstream.send(event.data);
    else upstream.send(Buffer.from(event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : new Uint8Array((event.data as ArrayBufferView).buffer)));
  });
  server.addEventListener("close", () => { try { upstream.close(); } catch { /* already closed */ } });

  return new Response(null, { status: 101, webSocket: client } as unknown as ResponseInit);
}
