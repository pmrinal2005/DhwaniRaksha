/**
 * Deterministic, protocol-shaped, zero-credit simulation of api.vachana.ai.
 *
 * Every payload returned here matches the documented wire format exactly
 * (STT REST JSON, STT WS frames, VC embeddings, TTS REST binary, TTS SSE events)
 * so the whole UI can be exercised without spending a single Gnani credit.
 * Mock output is always labelled `source: "mock"` in the dashboard.
 */
import { decodeEmbeddingB64, encodeEmbeddingB64, seededUnitVector } from "./bfloat16";
import { sha256Short } from "./hash";

export interface MockTranscriptInput {
  detectedLanguage?: string;
  domain: string;
  keyterms: string[];
  format: string;
  model: string;
  seed: string;
}

const DOMAIN_SCRIPTS: Record<string, string[]> = {
  mandi: [
    "नमस्कार, आज लहसुन का भाव क्या चल रहा है? मुझे दो क्विंटल बेचना है।",
    "आज नासिक गांव का प्याज़ एक हज़ार दो सौ रुपये क्विंटल चल रहा है।",
    "सवा तीन क्विंटल सोना मसूरी, भाव एक लाख छियालीस हज़ार रुपये है।",
  ],
  kirana: [
    "दो पैकेट पारले जी और एक फॉर्च्यून कच्ची घानी तेल जोड़ दो खाते में।",
    "पाँच किलो आटा, GSTIN दो दो ए बी सी डी ई, उधार चालीस दिन का।",
    "अठारह सौ पैंतालीस रुपये का बिल बना दो, UPI से दे देंगे।",
  ],
  asha: [
    "गर्भवती महिला को तेज़ बुखार और कमज़ोरी है, SpO2 नब्बे के करीब है।",
    "बच्चे को कल से दस्त हैं, ORS पिलाया है, अब भी कमज़ोरी है।",
    "टीकाकरण अगले सोमवार PHC में है, आंगनवाड़ी दीदी को बता दूँगी।",
  ],
  highway: [
    "एक प्राइवेट बस टायर बर्स्ट हो गया है, NH चौवालीस पर मेरा ट्रक रुका है।",
    "रसोई खर्च के लिए महिला की मज़दूरी तीन महीने से नहीं मिली है।",
    "फास्टैग से दो बार शुल्क कट गया, मुझे रसीद चाहिए।",
  ],
};

function hashToInt(seed: string, salt: string): number {
  let value = 0;
  const source = `${seed}:${salt}`;
  for (let index = 0; index < source.length; index += 1) value = (value * 31 + source.charCodeAt(index)) >>> 0;
  return value;
}

export function pickMockTranscript(input: MockTranscriptInput): string {
  const scripts = DOMAIN_SCRIPTS[input.domain] ?? DOMAIN_SCRIPTS.mandi;
  const base = scripts[hashToInt(input.seed, "script") % scripts.length];
  const hint = input.keyterms.length ? ` ${input.keyterms[hashToInt(input.seed, "term") % input.keyterms.length]}` : "";
  const suffix = input.format === "transliterate" ? "" : hint;
  const text = `${base}${suffix}`;
  if (input.format === "transliterate") return transliterateMock(text);
  return text;
}

/** Romanised rendering for `format=transliterate` demos (deterministic, script-level only). */
export function transliterateMock(text: string): string {
  const map: Record<string, string> = {
    "नमस्कार": "namaskar", "आज": "aaj", "लहसुन": "lahsun", "का": "ka", "भाव": "bhav", "क्या": "kya", "चल": "chal",
    "रहा": "raha", "है": "hai", "मुझे": "mujhe", "दो": "do", "क्विंटल": "quintal", "बेचना": "bechna",
    "नासिक": "nashik", "गांव": "gaon", "प्याज़": "pyaz", "हज़ार": "hazar",
  };
  return text.split(" ").map((word) => map[word] ?? word).join(" ");
}

export function mockSttResponse(input: MockTranscriptInput) {
  const transcript = pickMockTranscript(input);
  const processing = 0.31 + (hashToInt(input.seed, "p") % 40) / 100;
  return {
    success: true as const,
    request_id: `mock-${hashToInt(input.seed, "id").toString(16)}`,
    transcript,
    model: input.model,
    detected_language_code: input.format === "transliterate" ? undefined : input.detectedLanguage ?? "hi-IN",
    processing_time: Number(processing.toFixed(2)),
    end_to_end_latency: Number((processing + 0.08).toFixed(2)),
  };
}

/** 768-d deterministic embedding for a speaker handle, shaped exactly like Gnani's reply. */
export function mockEmbedding(handle: string, salt = "mudra-vani-enrolment") {
  const vector = seededUnitVector(`${handle}:${salt}`);
  return { embedding: encodeEmbeddingB64(vector), shape: [1, 768] as [number, number], dtype: "torch.bfloat16" as const };
}

export function mockEmbeddingResponse(handle: string) {
  const payload = mockEmbedding(handle);
  return { success: true, message: "Voice embeddings generated successfully", data: { voice_clone_embedding: payload } };
}

/** Re-derive the vector behind a mock embedding (used to render the constellation on reload). */
export function decodeMockEmbedding(handle: string, salt = "mudra-vani-enrolment") {
  return decodeEmbeddingB64(mockEmbedding(handle, salt).embedding);
}

/**
 * A tiny formant synthesiser: deterministic, credit-free and *sounds like speech-shaped
 * audio* (Voiced harmonics shaped by vowel formants + gated noise for fricatives), so
 * the A/B noise test and every audio player behave like the real product.
 */
export function synthesizeSpeech(options: {
  text: string;
  sampleRate: number;
  seed: string;
  gender?: "female" | "male";
  speed?: number;
  mulaw?: boolean;
}): Uint8Array {
  const { text, sampleRate, seed } = options;
  const speed = options.speed ?? 1;
  const basePitch = options.gender === "male" ? 118 : 186;
  const characters = Math.max(1, text.length);
  const durationSeconds = Math.min(9, Math.max(0.6, (characters / 14) / speed));
  const totalSamples = Math.floor(sampleRate * durationSeconds);
  const samples = new Float32Array(totalSamples);
  const hash = hashToInt(seed, "synth");

  // Rough syllable segmentation: ~3.2 characters per syllable → per-syllable amplitude envelope.
  const syllables = Math.max(1, Math.round(text.length / 3.2));
  const syllableSamples = totalSamples / syllables;
  const formants = [[700, 1220, 2600], [500, 1500, 2500], [320, 2200, 2900]];

  let phase = 0;
  for (let index = 0; index < totalSamples; index += 1) {
    const syllable = Math.min(syllables - 1, Math.floor(index / syllableSamples));
    const within = (index % syllableSamples) / syllableSamples;
    // Speech envelope: quick attack, sustain, decay with a slight glide per syllable.
    const envelope = Math.sin(Math.PI * Math.min(1, within * 1.15)) ** 1.4;
    const vowel = formants[(syllable + (hash % 7)) % formants.length];
    const pitch = basePitch * (1 + 0.12 * Math.sin((index / sampleRate) * Math.PI * 2 * 3.1) + 0.04 * Math.sin((syllable + hash % 5)));
    phase += (Math.PI * 2 * pitch) / sampleRate;
    if (phase > Math.PI * 2) phase -= Math.PI * 2;

    let voiced = 0;
    for (let harmonic = 1; harmonic <= 9; harmonic += 1) {
      const frequency = pitch * harmonic;
      let gain = 0;
      for (const formant of vowel) gain += Math.exp(-((frequency - formant) ** 2) / (2 * (260 * (harmonic > 4 ? 2 : 1)) ** 2));
      voiced += gain * Math.sin(phase * harmonic) / harmonic;
    }
    // Fricative burst at syllable onset when the character is a sibilant/stop.
    const character = text.charCodeAt(syllable * 3) % 128;
    const fricative = within < 0.18 && character % 3 === 0 ? (hashToInt(seed, `noise-${index >> 5}`) / 0xffffffff - 0.5) * 0.16 : 0;
    samples[index] = (voiced * 0.5 + fricative) * envelope * 0.42;
  }

  if (options.mulaw) return encodeMulaw(Int16Array.from(samples, (sample) => sampleToInt16(sample)));
  return encodeWav(samples, sampleRate);
}

function sampleToInt16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeString = (offset: number, value: string) => { for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index)); };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let index = 0; index < samples.length; index += 1) view.setInt16(44 + index * 2, sampleToInt16(samples[index]), true);
  return new Uint8Array(buffer);
}

/** G.711 µ-law encoder — exactly what `container=mulaw` returns (8 kHz, audio/basic). */
export function encodeMulaw(int16Samples: number[] | Int16Array, sampleRate = 8000): Uint8Array {
  const output = new Uint8Array(int16Samples.length);
  for (let index = 0; index < int16Samples.length; index += 1) {
    const sample = Math.max(-32768, Math.min(32767, int16Samples[index]));
    const sign = sample < 0 ? 0x80 : 0;
    const magnitude = Math.min(32635, Math.abs(sample)) + 0x84;
    const exponent = Math.floor(Math.log2(magnitude)) - 7;
    const mantissa = (magnitude >> (exponent + 3)) & 0x0f;
    output[index] = ~(sign | (exponent << 4) | mantissa) & 0xff;
  }
  return output;
}

/** SSML-free tag description for the mock synthesiser's "style" input. */
export function describeTags(text: string): string[] {
  return Array.from(text.matchAll(/<([^>]+)>/g), (match) => match[1].trim());
}

export async function mockFingerprint(text: string): Promise<string> {
  return sha256Short(text, 12);
}
