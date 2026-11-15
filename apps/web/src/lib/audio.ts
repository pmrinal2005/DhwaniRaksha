"use client";

/**
 * Client-side audio engine: microphone capture with VAD gating, Indian noise-bed
 * injection, 8 kHz µ-law telephony simulation, WAV encoding and playback.
 * Everything runs locally; no audio ever leaves the browser except gated clips.
 */

export type NoisePreset = "none" | "mandi" | "rickshaw_horn" | "railway" | "pstn_8khz";

export const NOISE_PRESETS: { id: NoisePreset; label: string; detail: string; gain: number }[] = [
  { id: "none", label: "Clean mic", detail: "Studio condition — the control sample", gain: 0 },
  { id: "mandi", label: "Azadpur Mandi chatter", detail: "≈85 dB auction crowd + trolley clatter", gain: 0.16 },
  { id: "rickshaw_horn", label: "Auto-rickshaw + pressure horn", detail: "≈92 dB, 2.1–3.1 kHz horn band", gain: 0.2 },
  { id: "railway", label: "Railway platform echo", detail: "PA announcement reverb tail", gain: 0.14 },
  { id: "pstn_8khz", label: "8 kHz G.711 phone line", detail: "300–3,400 Hz band-limit + µ-law", gain: 0.05 },
];

export interface CaptureResult {
  noisyWav: Blob;
  cleanWav: Blob;
  sampleRate: number;
  durationMs: number;
  snr: { cleanDb: number; noisyDb: number; gainDb: number };
  hornAttenuationDb: number;
  bytesSent: number;
  bytesSuppressed: number;
  vadRatio: number;
  speechSeconds: number;
}

/** Deterministic pseudo-noise (xorshift) so the same slider gives the same bed. */
function rng(seed: number) {
  let state = seed || 0x9e3779b9;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return (state / 0xffffffff) * 2 - 1;
  };
}

/** Band-limited noise bed + periodic horn/pressure transients, generated live. */
class NoiseBed {
  private noise: ReturnType<typeof rng>;
  private phase = 0;
  private transient = 0;
  constructor(private preset: NoisePreset, private sampleRate: number) {
    this.noise = rng(preset.length * 2654435761);
  }
  next(index: number): number {
    if (this.preset === "none") return 0;
    const noise = this.noise();
    if (this.preset === "pstn_8khz") return noise * 0.5;
    if (this.preset === "railway") {
      // slow breathing echo of PA noise
      return noise * 0.55 + Math.sin((index / this.sampleRate) * 1.4) * 0.12;
    }
    if (this.preset === "mandi") {
      // crowd murmur: amplitude-modulated low noise + occasional clatter
      const murmur = noise * (0.5 + 0.4 * Math.sin((index / this.sampleRate) * 6.2));
      const clatter = index % Math.floor(this.sampleRate * 0.7) < 40 ? noise * 1.6 : 0;
      return murmur + clatter;
    }
    // rickshaw + pressure horn: engine rumble + 2-tone horn bursts
    const rumble = noise * 0.45 + Math.sin((index / this.sampleRate) * Math.PI * 2 * 52) * 0.18;
    const hornCycle = index % Math.floor(this.sampleRate * 2.4);
    if (hornCycle < this.sampleRate * 0.35) {
      this.phase += (Math.PI * 2 * (hornCycle < this.sampleRate * 0.18 ? 2550 : 2280)) / this.sampleRate;
      this.transient = Math.sin(this.phase) * 0.5;
    } else {
      this.transient *= 0.9992;
    }
    return rumble + this.transient;
  }
}

export function floatToInt16(samples: Float32Array): Int16Array {
  const output = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    output[index] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
  }
  return output;
}

export function encodeWavBlob(samples: Int16Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => { for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index)); };
  write(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); write(8, "WAVE"); write(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) view.setInt16(44 + index * 2, samples[index], true);
  return new Blob([buffer], { type: "audio/wav" });
}

/** G.711 µ-law round trip used to demonstrate the 8 kHz PSTN path. */
export function mulawRoundTrip(samples: Int16Array): Int16Array {
  const output = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const encoded = encodeMulawSample(samples[index]);
    output[index] = decodeMulawSample(encoded);
  }
  return output;
}
function encodeMulawSample(sample: number): number {
  const sign = sample < 0 ? 0x80 : 0;
  const magnitude = Math.min(32635, Math.abs(sample)) + 0x84;
  const exponent = Math.floor(Math.log2(magnitude)) - 7;
  return (~(sign | (exponent << 4) | ((magnitude >> (exponent + 3)) & 0x0f))) & 0xff;
}
function decodeMulawSample(byte: number): number {
  const value = ~byte & 0xff;
  const sign = value & 0x80;
  const exponent = (value >> 4) & 0x07;
  const mantissa = value & 0x0f;
  let magnitude = ((mantissa << 3) + 0x84) << exponent;
  magnitude -= 0x84;
  return sign ? -magnitude : magnitude;
}

export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples;
  const ratio = from / to;
  const length = Math.floor(samples.length / ratio);
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const low = Math.floor(position);
    const high = Math.min(samples.length - 1, low + 1);
    const weight = position - low;
    output[index] = samples[low] * (1 - weight) + samples[high] * weight;
  }
  return output;
}

export function rms(samples: Float32Array | Int16Array): number {
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = typeof samples[index] === "number" ? samples[index] : 0;
    const normalized = samples instanceof Int16Array ? value / 32768 : value;
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / Math.max(1, samples.length));
}

/** Energy at a target frequency band via a Goertzel filter (used for horn attenuation). */
export function bandEnergy(samples: Float32Array, sampleRate: number, frequency: number): number {
  const coefficient = 2 * Math.cos((2 * Math.PI * frequency) / sampleRate);
  let previous = 0;
  let previousPrevious = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const current = samples[index] + coefficient * previous - previousPrevious;
    previousPrevious = previous;
    previous = current;
  }
  return Math.sqrt(previous * previous + previousPrevious * previousPrevious - coefficient * previous * previousPrevious) / samples.length;
}

export interface RecorderHandle {
  stop: () => Promise<CaptureResult>;
  cancel: () => void;
  analyser: AnalyserNode;
  isRecording: () => boolean;
}

/**
 * Record up to `maxMs`, mixing the selected noise bed into the microphone signal,
 * applying the same DSP the edge worklet would apply to the clean path, and
 * tracking VAD-gated bytes. Returns both clean and noisy WAVs so the A/B panel
 * compares real recordings rather than described ones.
 */
export async function startCapture(options: {
  noise: NoisePreset;
  noiseGain?: number;
  maxMs?: number;
  sampleRate?: number;
  targetRate?: number;
  onTick?: (frame: { rms: number; vad: number; gate: boolean; elapsedMs: number; spectrum: number[] }) => void;
}): Promise<RecorderHandle> {
  const preset = NOISE_PRESETS.find((item) => item.id === options.noise) ?? NOISE_PRESETS[0];
  const noiseGain = options.noiseGain ?? preset.gain;
  const maxMs = options.maxMs ?? 6_000;
  const targetRate = options.targetRate ?? 16_000;

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const context = new AudioContext({ sampleRate: options.sampleRate ?? 48_000 });
  await context.resume();
  const source = context.createMediaStreamSource(stream);

  // Clean path mirrors the AudioWorklet DSP: 85 Hz HPF then 2.5 kHz notch.
  const highpass = context.createBiquadFilter(); highpass.type = "highpass"; highpass.frequency.value = 85; highpass.Q.value = 0.707;
  const notch = context.createBiquadFilter(); notch.type = "notch"; notch.frequency.value = 2_500; notch.Q.value = 4;
  const analyser = context.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.72;

  source.connect(highpass); highpass.connect(notch); notch.connect(analyser);

  const zeroGain = context.createGain(); zeroGain.gain.value = 0;
  zeroGain.connect(context.destination);

  const processor = context.createScriptProcessor(4096, 1, 1);
  const cleanBlocks: Float32Array[] = [];
  const noisyBlocks: Float32Array[] = [];
  const bed = new NoiseBed(options.noise === "pstn_8khz" ? "none" : options.noise, context.sampleRate);
  const startedAt = performance.now();
  const finishRef: { current: (() => Promise<CaptureResult>) | null } = { current: null };
  const autoStopRef: { current: (() => void) | null } = { current: null };
  const timer: ReturnType<typeof setTimeout> = setTimeout(() => { autoStopRef.current?.(); }, maxMs);
  let gate = false;
  let bytesSent = 0;
  let bytesSuppressed = 0;
  let sampleIndex = 0;
  let stopped = false;
  let speechSamples = 0;
  const spectrum = new Uint8Array(analyser.frequencyBinCount);

  processor.onaudioprocess = (event) => {
    if (stopped) return;
    const input = event.inputBuffer.getChannelData(0);
    const clean = new Float32Array(input.length);
    const noisy = new Float32Array(input.length);
    for (let index = 0; index < input.length; index += 1) {
      const noise = bed.next(sampleIndex + index) * noiseGain;
      clean[index] = input[index];
      noisy[index] = input[index] + noise;
    }
    sampleIndex += input.length;
    cleanBlocks.push(clean);
    noisyBlocks.push(noisy);

    const energy = rms(clean);
    const vad = Math.min(1, energy / 0.02);
    if (vad > 0.38) gate = true;
    else if (vad < 0.18) gate = false;
    const blockBytes = input.length * 2;
    if (gate) { bytesSent += blockBytes; speechSamples += input.length; } else bytesSuppressed += blockBytes;

    analyser.getByteFrequencyData(spectrum);
    const bands = Array.from({ length: 32 }, (_, band) => {
      const stride = Math.floor(spectrum.length / 32);
      let total = 0;
      for (let offset = 0; offset < stride; offset += 1) total += spectrum[band * stride + offset] ?? 0;
      return total / stride / 255;
    });
    options.onTick?.({ rms: energy, vad, gate, elapsedMs: performance.now() - startedAt, spectrum: bands });
  };

  // ScriptProcessor needs a live route; a zero gain keeps it silent to the user.
  notch.connect(processor); processor.connect(zeroGain);

  const finish = async (): Promise<CaptureResult> => {
    clearTimeout(timer);
    stopped = true;
    processor.disconnect(); notch.disconnect(processor); zeroGain.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    const durationMs = performance.now() - startedAt;
    const nativeRate = context.sampleRate;
    await context.close();

    const merge = (blocks: Float32Array[]) => {
      const size = blocks.reduce((sum, block) => sum + block.length, 0);
      const merged = new Float32Array(size);
      let offset = 0;
      for (const block of blocks) { merged.set(block, offset); offset += block.length; }
      return merged;
    };
    const cleanMerged = merge(cleanBlocks);
    const noisyMerged = merge(noisyBlocks);
    let clean16 = floatToInt16(resample(cleanMerged, nativeRate, targetRate));
    let noisy16 = floatToInt16(resample(noisyMerged, nativeRate, targetRate));

    if (options.noise === "pstn_8khz") {
      // 300–3,400 Hz band limit then a µ-law round trip at 8 kHz.
      clean16 = floatToInt16(resample(cleanMerged, nativeRate, 8_000));
      noisy16 = softBandLimit(mulawRoundTrip(clean16), 8_000);
    }

    const cleanDb = 20 * Math.log10(Math.max(1e-6, rms(clean16)));
    const noisyDb = 20 * Math.log10(Math.max(1e-6, rms(noisy16)));
    const cleanFloat = Int16ArrayToFloat(clean16);
    const noisyFloat = Int16ArrayToFloat(noisy16);
    const hornBefore = bandEnergy(noisyFloat, targetRate, 2_500);
    const hornAfter = bandEnergy(cleanFloat, targetRate, 2_500);

    return {
      noisyWav: encodeWavBlob(noisy16, options.noise === "pstn_8khz" ? 8_000 : targetRate),
      cleanWav: encodeWavBlob(clean16, options.noise === "pstn_8khz" ? 8_000 : targetRate),
      sampleRate: options.noise === "pstn_8khz" ? 8_000 : targetRate,
      durationMs: Math.round(durationMs),
      snr: { cleanDb: Number(cleanDb.toFixed(1)), noisyDb: Number(noisyDb.toFixed(1)), gainDb: Number((noisyDb - cleanDb).toFixed(1)) },
      hornAttenuationDb: Number((20 * Math.log10(Math.max(1e-9, hornBefore) / Math.max(1e-9, hornAfter))).toFixed(1)),
      bytesSent, bytesSuppressed,
      vadRatio: bytesSent + bytesSuppressed > 0 ? Number((bytesSent / (bytesSent + bytesSuppressed)).toFixed(3)) : 0,
      speechSeconds: Number((speechSamples / nativeRate).toFixed(2)),
    };
  };

  finishRef.current = finish;
  autoStopRef.current = () => { void finish(); };

  return {
    stop: async () => finish(),
    cancel: () => { stopped = true; clearTimeout(timer); stream.getTracks().forEach((track) => track.stop()); void context.close(); },
    analyser,
    isRecording: () => !stopped,
  };
}

/** Crude 8 kHz telephony tilt: gentle high shelf cut, keeps the demo audible. */
function softBandLimit(samples: Int16Array, sampleRate: number): Int16Array {
  const output = new Int16Array(samples.length);
  let previous = 0;
  const alpha = 0.62;
  for (let index = 0; index < samples.length; index += 1) {
    previous = alpha * previous + (1 - alpha) * samples[index];
    output[index] = Math.round(previous);
  }
  return output;
}

function Int16ArrayToFloat(samples: Int16Array): Float32Array {
  const output = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) output[index] = samples[index] / 32768;
  return output;
}

/* ---------------------------------------------------------------- playback */

export function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

export interface PlayHandle { stop: () => void; durationMs: number }

/**
 * Play a blob; µ-law / raw PCM payloads are decoded by hand because browsers do
 * not play `audio/basic` natively — this is exactly the PSTN demo path.
 */
export async function playBlob(blob: Blob, container: string, sampleRate: number, onEnd?: () => void): Promise<PlayHandle> {
  if (container === "mulaw" || container === "alaw" || container === "raw") {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const context = new AudioContext({ sampleRate });
    await context.resume();
    const samples = new Float32Array(bytes.length);
    for (let index = 0; index < bytes.length; index += 1) {
      samples[index] = (container === "alaw" ? decodeAlawSample(bytes[index]) : decodeMulawSample(bytes[index])) / 32768;
    }
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const node = context.createBufferSource();
    node.buffer = buffer;
    node.connect(context.destination);
    node.onended = () => { void context.close(); onEnd?.(); };
    node.start();
    return {
      stop: () => { try { node.stop(); } catch { /* already stopped */ } void context.close(); },
      durationMs: Math.round((samples.length / sampleRate) * 1000),
    };
  }
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.onended = () => { URL.revokeObjectURL(url); onEnd?.(); };
  await audio.play();
  return {
    stop: () => { audio.pause(); URL.revokeObjectURL(url); },
    durationMs: 0,
  };
}

function decodeAlawSample(byte: number): number {
  const value = byte ^ 0x55;
  const sign = value & 0x80;
  const exponent = (value >> 4) & 0x07;
  const mantissa = value & 0x0f;
  let magnitude = mantissa << 4;
  magnitude += 8;
  if (exponent > 0) magnitude = (magnitude + 0x100) << (exponent - 1);
  return (sign ? magnitude : -magnitude) * 8;
}
