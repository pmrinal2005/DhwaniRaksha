/**
 * Payload builders that enforce the Gnani protocol before a single byte leaves the server.
 * Each builder either returns a wire-ready payload or the exact 400-class reason Gnani
 * would have produced (see https://docs.gnani.ai/api/introduction/errors).
 */
import {
  AUDIO_ENCODINGS, AUDIO_SAMPLE_RATES, AUDIO_TAGS, CONTEXT_LIMITS, LOCALES, SPEED_MAX, SPEED_MIN,
  STT_FORMATS_BY_MODEL, type Locale, type SttFormat, type SttModel, isLocale, isVoiceForModel,
  type AudioContainer,
} from "./voices";
import { sanitizeAudioTags } from "./normalizer";
import type { SpeakerEmbedding } from "./bfloat16";

export class ProtocolError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ProtocolError";
  }
}

export interface SttRestRequest {
  audio: Uint8Array;
  filename: string;
  contentType: string;
  model: SttModel;
  languageCodes: string[];
  format?: SttFormat;
  keyterms?: string[];
  topic?: string;
  previousText?: string;
  speakerNames?: string[];
  substitutionMap?: Array<{ patterns: string[]; replacement: string } | { find: string; replace: string }>;
  biasList?: string[];
  biasScore?: number;
  itnNativeNumerals?: boolean;
}

const LANGUAGE_CODE_PATTERN = /^[a-z]{2}-IN$/;

/** `indic-auto`, a single locale, or up to 4 comma-separated locales on Prisma v3.0. */
export function validateLanguageCodes(codes: string[], model: SttModel): void {
  const trimmed = codes.map((code) => code.trim()).filter(Boolean);
  if (trimmed.length === 0) throw new ProtocolError("INVALID_LANGUAGE_CODE", "language_code is required (indic-auto, or a locale such as hi-IN).");
  if (trimmed.includes("indic-auto")) {
    if (trimmed.length > 1) throw new ProtocolError("INVALID_LANGUAGE_CODE", "indic-auto cannot be combined with fixed locales.");
    if (model !== "prisma-v3.0") throw new ProtocolError("INVALID_LANGUAGE_CODE", "indic-auto is only accepted by prisma-v3.0.");
    return;
  }
  for (const code of trimmed) {
    if (!LANGUAGE_CODE_PATTERN.test(code)) throw new ProtocolError("INVALID_LANGUAGE_CODE", `Unsupported language code '${code}'. Use a value such as hi-IN, en-IN, ta-IN.`);
  }
  const distinct = Array.from(new Set(trimmed));
  if (distinct.length > CONTEXT_LIMITS.languages) {
    throw new ProtocolError("INVALID_LANGUAGE_CODE", `At most 4 languages are allowed, got ${distinct.length}: ${distinct.join(", ")}.`);
  }
  if (model === "prisma-v2.5" && distinct.length > 1) {
    throw new ProtocolError("INVALID_LANGUAGE_CODE", "prisma-v2.5 accepts exactly one language_code.");
  }
}

export function validateSttContext(request: SttRestRequest): void {
  if (request.model !== "prisma-v3.0") {
    // Prisma v2.5 rejects (or ignores) v3-only context; never send it.
    request.keyterms = undefined;
    request.topic = undefined;
    request.previousText = undefined;
    request.speakerNames = undefined;
    if (request.format && !STT_FORMATS_BY_MODEL["prisma-v2.5"].includes(request.format)) {
      throw new ProtocolError("INVALID_FORMAT", `format '${request.format}' is Prisma v3.0 only; ${request.model} supports ${STT_FORMATS_BY_MODEL["prisma-v2.5"].join(", ")}.`);
    }
    return;
  }
  if (request.keyterms && request.keyterms.length > CONTEXT_LIMITS.keyterms) {
    throw new ProtocolError("INVALID_CONTEXT", `keyterms must contain at most ${CONTEXT_LIMITS.keyterms} items (got ${request.keyterms.length}).`);
  }
  for (const term of request.keyterms ?? []) {
    if (term.includes("<|") || term.includes("|>")) throw new ProtocolError("INVALID_CONTEXT", `keyterm '${term}' contains a reserved marker.`);
  }
  if (request.topic && request.topic.length > CONTEXT_LIMITS.topic) {
    throw new ProtocolError("INVALID_CONTEXT", `topic must be at most 1600 characters (got ${request.topic.length}).`);
  }
  if (request.previousText) request.previousText = request.previousText.slice(-CONTEXT_LIMITS.previousText);
  if (request.speakerNames && (request.speakerNames.length < 1 || request.speakerNames.length > CONTEXT_LIMITS.speakerNames)) {
    throw new ProtocolError("INVALID_CONTEXT", `speaker_names accepts 1 to ${CONTEXT_LIMITS.speakerNames} names.`);
  }
  if (request.format && !STT_FORMATS_BY_MODEL[request.model].includes(request.format)) {
    throw new ProtocolError("INVALID_FORMAT", `format '${request.format}' is not supported by ${request.model}.`);
  }
}

export function buildSttRestForm(request: SttRestRequest): FormData {
  if (request.audio.byteLength === 0) throw new ProtocolError("EMPTY_AUDIO", "Empty audio file received.");
  if (request.audio.byteLength > CONTEXT_LIMITS.restUploadBytes) {
    throw new ProtocolError("MAX_AUDIO_DURATION_EXCEEDED", "REST STT accepts files up to 10 MB / 30 seconds. Use the realtime stream for longer audio.");
  }
  const extension = request.filename.split(".").pop()?.toLowerCase() ?? "";
  if (!["wav", "mp3", "ogg", "flac", "aac", "m4a"].includes(extension)) {
    throw new ProtocolError("UNSUPPORTED_AUDIO_FORMAT", `Unsupported audio format '.${extension}'. Supported: wav, mp3, ogg, flac, aac, m4a.`);
  }
  validateLanguageCodes(request.languageCodes, request.model);
  validateSttContext(request);
  const form = new FormData();
  form.set("audio_file", new Blob([request.audio as BlobPart], { type: request.contentType }), request.filename);
  form.set("model", request.model);
  form.set("language_code", request.languageCodes.join(","));
  if (request.format) form.set("format", request.format);
  if (request.keyterms?.length) form.set("keyterms", JSON.stringify(request.keyterms));
  if (request.topic) form.set("topic", request.topic);
  if (request.previousText) form.set("previous_text", request.previousText);
  if (request.speakerNames?.length) form.set("speaker_names", JSON.stringify(request.speakerNames));
  if (request.substitutionMap?.length) {
    const normalizedRules = request.substitutionMap.slice(0, 10).map((rule) =>
      "patterns" in rule ? rule : { patterns: [rule.find], replacement: rule.replace },
    );
    form.set("enable_substitution", "true");
    form.set("substitution_map", JSON.stringify(normalizedRules));
  }
  if (request.biasList?.length) {
    form.set("bias_list", JSON.stringify(request.biasList.slice(0, 100)));
    form.set("bias_score", String(request.biasScore ?? 1));
  }
  if (request.itnNativeNumerals) form.set("itn_native_numerals", "true");
  return form;
}

export interface TtsRequest {
  text: string;
  model: "timbre-v3.0" | "timbre-v2.5" | "vachana-vc-v1";
  voice?: string;
  language: string;
  speed?: number;
  audioConfig: {
    sample_rate: number;
    encoding?: string;
    container: AudioContainer;
    num_channels?: number;
    sample_width?: number;
  };
  speakerEmbedding?: SpeakerEmbedding;
}

export interface TtsValidation {
  body: Record<string, unknown>;
  removedTags: string[];
  keptTags: string[];
  strippedText: string;
}

export function buildTtsBody(request: TtsRequest): TtsValidation {
  let text = request.text.trim();
  if (!text) throw new ProtocolError("INVALID_REQUEST", "text is required.");
  const tags = sanitizeAudioTags(text, request.model, AUDIO_TAGS as unknown as string[]);
  text = tags.text;
  if (!text) throw new ProtocolError("INVALID_REQUEST", "Text contains only audio tags; nothing is left to synthesize.");
  // Documented upstream behaviour: a request whose text holds nothing but tags is 400.
  if (!text.replace(/<[^>]+>/g, "").trim()) {
    throw new ProtocolError("INVALID_REQUEST", "Text contains only audio tags; nothing is left to synthesize.");
  }

  const language = request.language === "auto" || request.language === "hi-en" ? request.language : isLocale(request.language) ? request.language : null;
  if (!language) throw new ProtocolError("INVALID_REQUEST", `language '${request.language}' is not supported. Use auto, hi-en, or a locale such as hi-IN.`);
  if (request.model !== "vachana-vc-v1" && language === "hi-en" && request.model !== "timbre-v2.5") {
    // hi-en is documented for Timbre v2.5 (Poorvi); Timbre v3.0 voices are per-locale.
    throw new ProtocolError("INVALID_REQUEST", "language 'hi-en' is documented for timbre-v2.5 (voice Poorvi). Use a locale for timbre-v3.0.");
  }
  const speed = request.speed ?? 1;
  if (speed < SPEED_MIN || speed > SPEED_MAX) throw new ProtocolError("INVALID_REQUEST", `speed must be between ${SPEED_MIN} and ${SPEED_MAX} (got ${speed}).`);

  const audioConfig = request.audioConfig;
  if (!(AUDIO_SAMPLE_RATES as readonly number[]).includes(audioConfig.sample_rate)) {
    throw new ProtocolError("INVALID_REQUEST", `sample_rate must be one of ${AUDIO_SAMPLE_RATES.join(", ")} (got ${audioConfig.sample_rate}).`);
  }
  if (audioConfig.encoding && !(AUDIO_ENCODINGS as readonly string[]).includes(audioConfig.encoding)) {
    throw new ProtocolError("INVALID_REQUEST", `encoding '${audioConfig.encoding}' is not supported.`);
  }
  if ((audioConfig.container === "mulaw" || audioConfig.container === "alaw") && audioConfig.sample_rate !== 8000) {
    throw new ProtocolError("INVALID_REQUEST", `${audioConfig.container} forces an 8000 Hz sample rate; set sample_rate to 8000.`);
  }
  if (request.model === "vachana-vc-v1") {
    if (audioConfig.sample_rate > 44100) {
      throw new ProtocolError("INVALID_REQUEST", `vachana-vc-v1 supports sample_rate 8000–44100 Hz (got ${audioConfig.sample_rate}).`);
    }
    if (audioConfig.container === "alaw") {
      throw new ProtocolError("INVALID_REQUEST", "vachana-vc-v1 supports containers wav, raw, mp3, ogg, mulaw (not alaw).");
    }
  }

  const defaultEncoding = audioConfig.container === "ogg"
    ? "oggopus"
    : audioConfig.container === "mulaw"
      ? (request.model === "vachana-vc-v1" ? "linear_pcm" : "pcm_mulaw")
      : audioConfig.container === "alaw"
        ? "pcm_alaw"
        : "linear_pcm";

  const body: Record<string, unknown> = {
    text,
    model: request.model,
    audio_config: {
      sample_rate: audioConfig.sample_rate,
      num_channels: audioConfig.num_channels ?? 1,
      sample_width: audioConfig.sample_width ?? 2,
      encoding: audioConfig.encoding ?? defaultEncoding,
      container: audioConfig.container,
    },
  };
  if (request.model === "vachana-vc-v1") {
    if (!request.speakerEmbedding?.embedding) {
      throw new ProtocolError("INVALID_REQUEST", "vachana-vc-v1 requires speaker_embedding {embedding, shape, dtype}.");
    }
    body.speaker_embedding = request.speakerEmbedding;
  } else {
    if (!request.voice) throw new ProtocolError("INVALID_REQUEST", "voice is required.");
    if (!isVoiceForModel(request.model, request.voice)) {
      throw new ProtocolError("INVALID_REQUEST", `Voice '${request.voice}' does not belong to ${request.model}. Voices are not interchangeable between models.`);
    }
    body.language = language;
    body.voice = request.voice;
    body.speed = speed;
  }
  return { body, removedTags: tags.removed, keptTags: tags.kept, strippedText: text };
}

/** Locale list for Prisma — `indic-auto` by default, or deduplicated locales capped at 4. */
export function resolveLanguageCodes(raw: string, _model: SttModel): string[] {
  void _model;
  if (raw === "indic-auto" || !raw) return ["indic-auto"];
  const codes = raw.split(",").map((code) => code.trim()).filter((code) => isLocale(code) || code === "indic-auto");
  return codes.length ? codes : ["indic-auto"];
}

export function localesFromCodes(codes: string[]): Locale[] {
  return codes.filter(isLocale);
}

export const ALL_LOCALES = LOCALES;
