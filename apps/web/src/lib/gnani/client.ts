/**
 * The only module allowed to talk to https://api.vachana.ai.
 *
 * Responsibilities
 *  - global single-active-request mutex (Gnani accounts default to 1 concurrent request → HTTP 429)
 *  - exponential backoff strictly for 429 / 500 / 503 / 504, never for 400 / 401 / 403 / 422
 *  - defensive JSON/error parsing across the three documented envelopes
 *  - headers exactly as documented: `X-API-Key-ID`
 */
import { BACKOFF_SCHEDULE_MS, GNANI_BASE_URL, RETRYABLE_STATUS } from "./voices";

export type GnaniMode = "mock" | "live";
export type GnaniCallKind = "stt_rest" | "tts_rest" | "tts_sse" | "vc_embed" | "stt_ws" | "tts_ws";

export interface GnaniError {
  code: string;
  message: string;
  status: number;
  retryable: boolean;
}

export interface GnaniMeta {
  mode: GnaniMode;
  kind: GnaniCallKind;
  status: number;
  requestId: string;
  latencyMs: number;
  attempts: number;
  queuedMs: number;
  retryAfter429: number;
}

export interface GnaniMutexSnapshot {
  active: { kind: GnaniCallKind; since: number } | null;
  waiting: number;
  totalCalls: number;
  totalRetries: number;
  total429Avoided: number;
  total429Received: number;
  lastRequestId: string | null;
  lastLatencyMs: number | null;
  lastCallAt: string | null;
}

interface MutexState {
  chain: Promise<void>;
  snapshot: GnaniMutexSnapshot;
}

// Shared across route modules in one server process (and across HMR reloads).
const globalRef = globalThis as unknown as { __mudraGnaniMutex?: MutexState };
const state: MutexState = globalRef.__mudraGnaniMutex ?? {
  chain: Promise.resolve(),
  snapshot: {
    active: null, waiting: 0, totalCalls: 0, totalRetries: 0, total429Avoided: 0,
    total429Received: 0, lastRequestId: null, lastLatencyMs: null, lastCallAt: null,
  },
};
globalRef.__mudraGnaniMutex = state;

export function mutexSnapshot(): GnaniMutexSnapshot {
  return { ...state.snapshot, active: state.snapshot.active ? { ...state.snapshot.active } : null };
}

/** Serialise every upstream call. Returns the call's result plus how long it waited. */
export async function withSingleActiveRequest<T>(kind: GnaniCallKind, fn: () => Promise<T>): Promise<{ value: T; queuedMs: number }> {
  state.snapshot.waiting += 1;
  let queuedMs = 0;
  const start = Date.now();
  const previous = state.chain;
  let release!: () => void;
  state.chain = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  queuedMs = Date.now() - start;
  state.snapshot.waiting = Math.max(0, state.snapshot.waiting - 1);
  if (queuedMs > 15) state.snapshot.total429Avoided += 1;
  state.snapshot.active = { kind, since: Date.now() };
  state.snapshot.totalCalls += 1;
  try {
    return { value: await fn(), queuedMs };
  } finally {
    state.snapshot.active = null;
    release();
  }
}

export function gnaniBaseUrl(): string {
  return process.env.GNANI_BASE_URL?.trim().replace(/\/$/, "") || GNANI_BASE_URL;
}

export function gnaniApiKey(): string | null {
  const key = process.env.GNANI_API_KEY?.trim();
  if (!key) return null;
  // Treat the documented placeholder as "not configured" so demos never burn credits by accident.
  if (/your[_-]?api[_-]?key|replace|<api/i.test(key)) return null;
  return key;
}

export function gnaniMode(): GnaniMode {
  const flag = (process.env.USE_GNANI_MOCK ?? "true").toLowerCase();
  if (flag === "false" && gnaniApiKey()) return "live";
  return "mock";
}

const STT_ERROR_CODES = new Set([
  "INVALID_LANGUAGE_CODE", "MODEL_UNSUPPORTED_LANGUAGE", "INVALID_MODEL", "INVALID_FORMAT", "INVALID_CONTEXT",
  "EMPTY_AUDIO", "UNSUPPORTED_AUDIO_FORMAT", "AUDIO_CONVERSION_ERROR", "MAX_AUDIO_DURATION_EXCEEDED",
  "TRANSCRIPTION_FAILED", "INTERNAL_SERVER_ERROR",
]);

export function parseGnaniError(status: number, rawBody: string): GnaniError {
  let parsed: unknown = null;
  try { parsed = JSON.parse(rawBody); } catch { /* binary or empty body */ }
  const record = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const detail = record.detail as Record<string, unknown> | string | undefined;
  const errorObj = record.error as Record<string, unknown> | string | undefined;

  let code = typeof record.code === "string" ? record.code : `HTTP_${status}`;
  let message = typeof record.message === "string" ? record.message : "";

  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    code = (typeof detail.error_code === "string" && detail.error_code) || code;
    message = (typeof detail.message === "string" && detail.message) || message;
  } else if (typeof detail === "string" && !message) {
    message = detail;
  } else if (Array.isArray(detail) && detail.length) {
    const first = detail[0] as Record<string, unknown>;
    code = "VALIDATION_ERROR";
    message = `${String(first.loc ?? "body")}: ${String(first.msg ?? "invalid request")}`;
  }
  if (errorObj && typeof errorObj === "object") {
    if (typeof errorObj.type === "string" && STT_ERROR_CODES.has(errorObj.type)) code = errorObj.type;
    if (typeof errorObj.message === "string") message = errorObj.message;
  }
  if (typeof errorObj === "string" && status === 504) code = code === `HTTP_${status}` ? "UPSTREAM_TIMEOUT" : code;

  if (!message) {
    message = status === 401 ? "Unauthorized — check X-API-Key-ID."
      : status === 402 ? "Insufficient credit for this Gnani account."
      : status === 403 ? "This API key lacks the scope for the requested service."
      : status === 429 ? "Only 1 active request is allowed at a time. Wait for your current request to finish before sending another."
      : status === 504 ? "The speech-to-text model failed to respond within the allocated 5000ms limit."
      : rawBody.slice(0, 240) || `Upstream returned HTTP ${status}.`;
  }
  return { code, message, status, retryable: RETRYABLE_STATUS.has(status) };
}

export interface GnaniResponse<T> {
  ok: boolean;
  data: T | null;
  error: GnaniError | null;
  meta: GnaniMeta;
  headers: Headers | null;
}

async function sleep(ms: number) { await new Promise((resolve) => setTimeout(resolve, ms)); }

function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

interface CallOptions<T> {
  kind: GnaniCallKind;
  path: string;
  init: RequestInit;
  parse: (response: Response) => Promise<T>;
  timeoutMs?: number;
  maxAttempts?: number;
}

/** One serialised upstream call with retries. Never used with mock mode. */
export async function gnaniCall<T>(options: CallOptions<T>): Promise<GnaniResponse<T>> {
  const key = gnaniApiKey();
  if (!key) return { ok: false, data: null, headers: null, error: { code: "MISSING_API_KEY", message: "Set GNANI_API_KEY and USE_GNANI_MOCK=false to reach api.vachana.ai.", status: 0, retryable: false }, meta: emptyMeta(options.kind, "live") };

  const outcome = await withSingleActiveRequest<GnaniResponse<T>>(options.kind, async () => {
    const maxAttempts = options.maxAttempts ?? 3;
    let attempts = 0;
    let lastError: GnaniError | null = null;
    const requestId = uuid();
    const startedAt = Date.now();

    while (attempts < maxAttempts) {
      attempts += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 45_000);
      try {
        const response = await fetch(`${gnaniBaseUrl()}${options.path}`, {
          ...options.init,
          signal: controller.signal,
          headers: {
            "X-API-Key-ID": key,
            "x-api-request-id": requestId,
            ...(options.init.headers as Record<string, string> | undefined),
          },
          cache: "no-store",
        });
        if (response.ok) {
          const data = await options.parse(response);
          state.snapshot.lastRequestId = requestId;
          state.snapshot.lastLatencyMs = Date.now() - startedAt;
          state.snapshot.lastCallAt = new Date().toISOString();
          return { ok: true, data, error: null, meta: {
            mode: "live" as const, kind: options.kind, status: response.status, requestId,
            latencyMs: Date.now() - startedAt, attempts, queuedMs: 0, retryAfter429: 0,
          }, headers: response.headers };
        }
        const error = parseGnaniError(response.status, await response.text());
        lastError = error;
        if (response.status === 429) state.snapshot.total429Received += 1;
        if (!error.retryable || attempts >= maxAttempts) break;
        state.snapshot.totalRetries += 1;
        await sleep(BACKOFF_SCHEDULE_MS[Math.min(attempts - 1, BACKOFF_SCHEDULE_MS.length - 1)]);
      } catch (caught) {
        const aborted = caught instanceof DOMException && caught.name === "AbortError";
        lastError = {
          code: aborted ? "UPSTREAM_TIMEOUT" : "NETWORK_ERROR",
          message: aborted ? "The request to api.vachana.ai timed out." : caught instanceof Error ? caught.message : "Network error contacting api.vachana.ai.",
          status: aborted ? 504 : 0,
          retryable: true,
        };
        if (attempts >= maxAttempts) break;
        state.snapshot.totalRetries += 1;
        await sleep(BACKOFF_SCHEDULE_MS[Math.min(attempts - 1, BACKOFF_SCHEDULE_MS.length - 1)]);
      } finally {
        clearTimeout(timer);
      }
    }
    return {
      ok: false, data: null, headers: null, error: lastError ?? { code: "UNKNOWN", message: "Upstream call failed.", status: 0, retryable: false },
      meta: { mode: "live" as const, kind: options.kind, status: lastError?.status ?? 0, requestId, latencyMs: Date.now() - startedAt, attempts, queuedMs: 0, retryAfter429: 0 },
    };
  });

  if (outcome.value.ok) outcome.value.meta.queuedMs = outcome.queuedMs;
  return outcome.value;
}

function emptyMeta(kind: GnaniCallKind, mode: GnaniMode): GnaniMeta {
  return { mode, kind, status: 0, requestId: uuid(), latencyMs: 0, attempts: 0, queuedMs: 0, retryAfter429: 0 };
}

export function mockMeta(kind: GnaniCallKind, requestId: string, latencyMs: number): GnaniMeta {
  return { mode: "mock", kind, status: 200, requestId, latencyMs, attempts: 1, queuedMs: 0, retryAfter429: 0 };
}

/** Parse an SSE stream into (event, data) pairs — used for /api/v1/tts/sse relaying. */
export async function* parseSseEvents(response: Response): AsyncGenerator<{ event: string; data: string }> {
  const body = response.body;
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length) yield { event, data: dataLines.join("\n") };
      boundary = buffer.indexOf("\n\n");
    }
  }
}
