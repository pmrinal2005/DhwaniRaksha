/**
 * Voice + language catalogs, transcribed from the official Gnani documentation:
 * https://docs.gnani.ai/api/TTS/available-voices  (voices are NOT interchangeable between models)
 * https://docs.gnani.ai/api/TTS/tts-audio-tags  (13 tags, timbre-v3.0 only)
 * https://docs.gnani.ai/api/STT/models/prisma-v3 (10 locales + indic-auto)
 */

export const GNANI_BASE_URL = "https://api.vachana.ai";

export const STT_REST_PATH = "/stt/v3";
export const STT_WS_PATH = "/stt/v3/stream";
export const TTS_REST_PATH = "/api/v1/tts/inference";
export const TTS_SSE_PATH = "/api/v1/tts/sse";
export const VC_EMBEDDINGS_PATH = "/api/v1/tts/voice-clone/embeddings";
export const TTS_WS_PATH = "/api/v1/tts";

export const STT_MODELS = ["prisma-v3.0", "prisma-v2.5"] as const;
export type SttModel = (typeof STT_MODELS)[number];
export const TTS_MODELS = ["timbre-v3.0", "timbre-v2.5", "vachana-vc-v1"] as const;
export type TtsModel = (typeof TTS_MODELS)[number];

export type Locale =
  | "hi-IN" | "en-IN" | "ta-IN" | "te-IN" | "kn-IN"
  | "ml-IN" | "mr-IN" | "pa-IN" | "bn-IN" | "gu-IN";

export const LOCALES: readonly Locale[] = ["hi-IN", "en-IN", "ta-IN", "te-IN", "kn-IN", "ml-IN", "mr-IN", "pa-IN", "bn-IN", "gu-IN"] as const;

export const LOCALE_META: Record<Locale, { name: string; native: string; script: string }> = {
  "hi-IN": { name: "Hindi", native: "हिन्दी", script: "Devanagari" },
  "en-IN": { name: "English", native: "English", script: "Latin" },
  "ta-IN": { name: "Tamil", native: "தமிழ்", script: "Tamil" },
  "te-IN": { name: "Telugu", native: "తెలుగు", script: "Telugu" },
  "kn-IN": { name: "Kannada", native: "ಕನ್ನಡ", script: "Kannada" },
  "ml-IN": { name: "Malayalam", native: "മലയാളം", script: "Malayalam" },
  "mr-IN": { name: "Marathi", native: "मराठी", script: "Devanagari" },
  "pa-IN": { name: "Punjabi", native: "ਪੰਜਾਬੀ", script: "Gurmukhi" },
  "bn-IN": { name: "Bengali", native: "বাংলা", script: "Bengali" },
  "gu-IN": { name: "Gujarati", native: "ગુજરાતી", script: "Gujarati" },
};

export const STT_FORMATS = ["verbatim", "transcribe", "codemix", "transliterate"] as const;
export type SttFormat = (typeof STT_FORMATS)[number];

/** Formats accepted per model — `codemix` / `transliterate` are Prisma v3.0 only (HTTP 400 otherwise). */
export const STT_FORMATS_BY_MODEL: Record<SttModel, readonly SttFormat[]> = {
  "prisma-v3.0": STT_FORMATS,
  "prisma-v2.5": ["verbatim", "transcribe"],
};

export const TIMBRE_V3_VOICES = [
  "Shivani", "Lakshmi", "Kalpana", "Chetana", "Vasudha", "Riyaa", "Tarika",
  "Avinash", "Shubham", "Prakash", "Devansh", "Yashraj", "Harshad",
] as const;

export const TIMBRE_V25_VOICES = [
  "Nalini", "Bhavna", "Yashvi", "Urmila", "Jwala", "Chitra", "Ambuja", "Deepak", "Roopesh",
  "Vikrant", "Hemraj", "Jalaj", "Omkar", "Poorvi", "Kaveri", "Trupti", "Devika", "Pranav",
  "Shlok", "Girish", "Asmita", "Trisha", "Brinda", "Vedika", "Noopur", "Suhana", "Lehara",
  "Lavanya", "Yukti", "Varuni", "Saanvi", "Kavin", "Reshma", "Riyaan", "Zahira", "Ishaan",
  "Kirra", "Dhruva", "Falak", "Veera", "Mehuli", "Zayan",
] as const;

export type TimbreVoice = (typeof TIMBRE_V3_VOICES)[number] | (typeof TIMBRE_V25_VOICES)[number];

export const VOICES_BY_MODEL: Record<"timbre-v3.0" | "timbre-v2.5", readonly string[]> = {
  "timbre-v3.0": TIMBRE_V3_VOICES,
  "timbre-v2.5": TIMBRE_V25_VOICES,
};

/** Voices used by the dashboard's presets — verified members of each catalog. */
export const VOICE_PICKS: Record<Locale | "hi-en", { v3: string; v25: string; persona: string }> = {
  "hi-IN": { v3: "Shivani", v25: "Nalini", persona: "friendly negotiator" },
  "en-IN": { v3: "Avinash", v25: "Kaveri", persona: "professional BFSI" },
  "ta-IN": { v3: "Lakshmi", v25: "Asmita", persona: "warm, empathetic" },
  "te-IN": { v3: "Chetana", v25: "Suhana", persona: "calm triage" },
  "kn-IN": { v3: "Kalpana", v25: "Saanvi", persona: "expressive" },
  "ml-IN": { v3: "Vasudha", v25: "Reshma", persona: "bright support" },
  "mr-IN": { v3: "Riyaa", v25: "Zahira", persona: "energetic market" },
  "pa-IN": { v3: "Tarika", v25: "Mehuli", persona: "promotional" },
  "bn-IN": { v3: "Devansh", v25: "Kirra", persona: "conversational" },
  "gu-IN": { v3: "Yashraj", v25: "Falak", persona: "youthful narration" },
  "hi-en": { v3: "Shivani", v25: "Poorvi", persona: "Hinglish code-mix" },
};

/** 13 official Timbre v3.0 tags (case sensitive). Unknown tags are silently stripped by Gnani. */
export const AUDIO_TAGS = [
  "laugh", "giggle", "sigh", "exhales", "sniffles", "yawns", "coughs",
  "clears throat", "whispers", "shouting", "excited", "slow", "pauses",
] as const;
export type AudioTag = (typeof AUDIO_TAGS)[number];

export const AUDIO_TAG_EXAMPLES: { tag: AudioTag; effect: string; category: string }[] = [
  { tag: "pauses", effect: "Short silence — never spoken", category: "Silence" },
  { tag: "slow", effect: "Drawn-out delivery", category: "Pacing" },
  { tag: "excited", effect: "Energetic, enthusiastic", category: "Vocal" },
  { tag: "whispers", effect: "Hushed delivery", category: "Vocal" },
  { tag: "sigh", effect: "Audible sigh", category: "Breath" },
  { tag: "clears throat", effect: "Throat clearing", category: "Breath" },
  { tag: "laugh", effect: "Full laugh", category: "Laughter" },
  { tag: "giggle", effect: "Light, high-pitched giggle", category: "Laughter" },
];

/** audio_config floor/ceiling from the TTS reference table. */
export const AUDIO_SAMPLE_RATES = [8000, 16000, 22050, 24000, 44100, 48000] as const;
export const AUDIO_CONTAINERS = ["wav", "raw", "mp3", "ogg", "mulaw", "alaw"] as const;
export type AudioContainer = (typeof AUDIO_CONTAINERS)[number];
export const AUDIO_ENCODINGS = ["linear_pcm", "pcm_s16le", "pcm_mulaw", "pcm_alaw", "oggopus"] as const;

export const SPEED_MIN = 0.85;
export const SPEED_MAX = 1.15;

/** Prisma v3.0 context limits (https://docs.gnani.ai/api/STT/limits). */
export const CONTEXT_LIMITS = Object.freeze({
  keyterms: 200,
  topic: 1600,
  previousText: 600,
  speakerNames: 4,
  languages: 4,
  restAudioSeconds: 30,
  restUploadBytes: 10 * 1024 * 1024,
  wsFrameBytes: 1024,
  wsSampleRates: [8000, 16000, 44100, 48000],
  sessionMinutes: 15,
  upstreamTimeoutMs: 5000,
});

export function isVoiceForModel(model: string, voice: string): boolean {
  if (model === "timbre-v3.0") return (TIMBRE_V3_VOICES as readonly string[]).includes(voice);
  if (model === "timbre-v2.5") return (TIMBRE_V25_VOICES as readonly string[]).includes(voice);
  return false;
}

export function defaultVoiceFor(model: string, locale: Locale | "hi-en"): string {
  const pick = VOICE_PICKS[locale] ?? VOICE_PICKS["hi-IN"];
  return model === "timbre-v2.5" ? pick.v25 : pick.v3;
}

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * Normalise the `language` field exactly as Gnani accepts it: `auto`, `hi-en`, or a
 * `xx-IN` locale. Returns null when the value would be rejected with HTTP 400.
 */
export function normalizeTtsLanguage(value: string): string | null {
  if (value === "auto" || value === "hi-en") return value;
  if (isLocale(value)) return value;
  const bare = value.split("-")[0];
  const match = LOCALES.find((locale) => locale.split("-")[0] === bare);
  return match ?? null;
}

/** Retry policy per the official error reference: only 429/500/503/504 are retryable. */
export const RETRYABLE_STATUS = new Set([429, 500, 503, 504]);
export const BACKOFF_SCHEDULE_MS = [500, 1000, 2000] as const;
