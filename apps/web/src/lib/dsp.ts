import type { DspFrame } from "@/lib/telemetry/store";
import { AUDIO, LAYOUT } from "@/components/dashboard/primitives/tokens";
import { DSP } from "@/components/dashboard/primitives/visual.tokens";

export function rmsOf(samples: Float32Array) {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / Math.max(samples.length, 1));
}

export function zcrOf(samples: Float32Array) {
  let crossings = 0;
  for (let index = 1; index < samples.length; index += 1) if ((samples[index - 1] < 0 && samples[index] >= 0) || (samples[index - 1] >= 0 && samples[index] < 0)) crossings += 1;
  return crossings / Math.max(samples.length, 1);
}

export function pitchOf(samples: Float32Array, sampleRate: number) {
  const minLag = Math.floor(sampleRate / DSP.maxPitchHz);
  const maxLag = Math.min(Math.floor(sampleRate / DSP.minPitchHz), Math.floor(samples.length / 2));
  let bestLag = 0;
  let bestCorrelation = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let correlation = 0;
    let energy = 0;
    for (let index = 0; index + lag < samples.length; index += 1) {
      correlation += samples[index] * samples[index + lag];
      energy += samples[index] ** 2 + samples[index + lag] ** 2;
    }
    const normalized = energy ? correlation * 2 / energy : 0;
    if (normalized > bestCorrelation) { bestCorrelation = normalized; bestLag = lag; }
  }
  return bestLag && bestCorrelation > DSP.envelopeSmoothing ? sampleRate / bestLag : 0;
}

export function normalizedSpectrum(data: Uint8Array, bands: number) {
  const output: number[] = [];
  const stride = Math.max(1, Math.floor(data.length / bands));
  for (let band = 0; band < bands; band += 1) {
    let total = 0;
    for (let offset = 0; offset < stride; offset += 1) total += data[Math.min(band * stride + offset, data.length - 1)] ?? 0;
    output.push((total / stride / DSP.spectrumMax) ** DSP.spectrumPower);
  }
  return output;
}

export function voiceProbability(rms: number, zcr: number) {
  const energy = Math.min(rms / AUDIO.rmsThreshold, 1);
  const consonance = Math.max(0, 1 - Math.abs(zcr - DSP.vadZcrTarget) / DSP.vadZcrTarget);
  return Math.max(0, Math.min(1, energy * DSP.vadRmsWeight + consonance * DSP.vadZcrWeight));
}

export function dbFromRms(rms: number) {
  return Math.max(DSP.dbFloor, DSP.dbScale * Math.log10(Math.max(rms, DSP.noiseFloor)));
}

export function buildDspFrame(raw: Float32Array, cleaned: Float32Array, rawFrequency: Uint8Array, cleanFrequency: Uint8Array, sampleRate: number, gateOpen: boolean, sent: number, suppressed: number, noiseRms = 0): DspFrame {
  const rms = rmsOf(cleaned);
  const zcr = zcrOf(cleaned);
  const signalDb = dbFromRms(rms);
  const noiseDb = dbFromRms(noiseRms);
  const snr = noiseRms > DSP.noiseFloor ? Math.min(DSP.snrCeiling, signalDb - noiseDb) : null;
  return {
    ts: new Date().toISOString(), rms, zcr, f0: pitchOf(cleaned, sampleRate),
    vad_prob: voiceProbability(rms, zcr), gate_open: gateOpen,
    raw_spectrum: normalizedSpectrum(rawFrequency, LAYOUT.spectrumBands),
    cleaned_spectrum: normalizedSpectrum(cleanFrequency, LAYOUT.spectrumBands),
    bytes_sent: sent, bytes_suppressed: suppressed, sample_rate: sampleRate, snr_db: snr, speaking_rate_wpm: null,
  };
}
