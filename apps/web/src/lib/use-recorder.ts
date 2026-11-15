"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { startCapture, type CaptureResult, type NoisePreset, type RecorderHandle } from "@/lib/audio";
import { useTelemetryStore } from "@/lib/telemetry/store";
import { useUiStore } from "@/lib/ui-store";

export interface RecorderState {
  recording: boolean;
  busy: boolean;
  elapsedMs: number;
  spectrum: number[];
  gate: boolean;
  rms: number;
  result: CaptureResult | null;
  error: string | null;
}

/** Microphone capture with noise-bed injection + VAD telemetry wired into the HUD store. */
export function useRecorder() {
  const [state, setState] = useState<RecorderState>({ recording: false, busy: false, elapsedMs: 0, spectrum: [], gate: false, rms: 0, result: null, error: null });
  const handle = useRef<RecorderHandle | null>(null);
  const setDsp = useTelemetryStore((store) => store.setDsp);
  const setArmed = useUiStore((store) => store.setMicArmed);
  const targetRate = 16_000;

  const start = useCallback(async (noise: NoisePreset, maxMs = 6_000) => {
    if (handle.current) return;
    setState((previous) => ({ ...previous, busy: true, error: null, result: null }));
    try {
      const recorder = await startCapture({
        noise,
        maxMs,
        targetRate,
        onTick: (frame) => {
          setState((previous) => ({ ...previous, elapsedMs: Math.round(frame.elapsedMs), spectrum: frame.spectrum, gate: frame.gate, rms: frame.rms }));
          setDsp({
            ts: new Date().toISOString(), rms: frame.rms, zcr: 0, f0: 0, vad_prob: frame.vad,
            gate_open: frame.gate, raw_spectrum: frame.spectrum, cleaned_spectrum: frame.spectrum.map((value) => Math.max(0, value * 0.82)),
            bytes_sent: 0, bytes_suppressed: 0, sample_rate: targetRate, snr_db: null, speaking_rate_wpm: null,
          });
        },
      });
      handle.current = recorder;
      setArmed(true);
      setState((previous) => ({ ...previous, recording: true, busy: false, result: null }));
    } catch (error) {
      const message = error instanceof DOMException && error.name === "NotAllowedError"
        ? "Microphone permission denied. Allow access, or use Simulate speaker to run the pipeline without a mic."
        : error instanceof Error ? error.message : "Microphone could not start.";
      setState((previous) => ({ ...previous, busy: false, recording: false, error: message }));
      toast.error(message);
    }
  }, [setArmed, setDsp]);

  const stop = useCallback(async (): Promise<CaptureResult | null> => {
    if (!handle.current) return null;
    setState((previous) => ({ ...previous, busy: true }));
    try {
      const result = await handle.current.stop();
      handle.current = null;
      setArmed(false);
      setState((previous) => ({ ...previous, recording: false, busy: false, result, gate: false }));
      return result;
    } catch (error) {
      handle.current = null;
      setArmed(false);
      const message = error instanceof Error ? error.message : "Recording failed.";
      setState((previous) => ({ ...previous, recording: false, busy: false, error: message }));
      toast.error(message);
      return null;
    }
  }, [setArmed]);

  const cancel = useCallback(() => {
    handle.current?.cancel();
    handle.current = null;
    setArmed(false);
    setState((previous) => ({ ...previous, recording: false, busy: false }));
  }, [setArmed]);

  useEffect(() => () => { handle.current?.cancel(); }, []);

  return { ...state, start, stop, cancel, canRecord: typeof navigator !== "undefined" && Boolean(navigator.mediaDevices) };
}
