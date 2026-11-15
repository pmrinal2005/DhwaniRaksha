"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AUDIO } from "@/components/dashboard/primitives/tokens";
import { buildDspFrame } from "@/lib/dsp";
import { useTelemetryStore } from "@/lib/telemetry/store";
import { useUiStore } from "@/lib/ui-store";
import { dashboardUrl } from "@/lib/api-client";
import { DSP } from "@/components/dashboard/primitives/visual.tokens";

interface AudioNodes {
  context: AudioContext;
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  rawAnalyser: AnalyserNode;
  cleanAnalyser: AnalyserNode;
  highpass: BiquadFilterNode;
  notch: BiquadFilterNode;
  cleanup: () => Promise<void>;
}

export function useMicrophone() {
  const armed = useUiStore((state) => state.micArmed);
  const setArmed = useUiStore((state) => state.setMicArmed);
  const setDsp = useTelemetryStore((state) => state.setDsp);
  const lowBandwidth = useUiStore((state) => state.lowBandwidth);
  const nodes = useRef<AudioNodes | null>(null);
  const frame = useRef<number | null>(null);
  const lastFrame = useRef(0);
  const gateOpen = useRef(false);
  const sent = useRef(0);
  const suppressed = useRef(0);
  const [starting, setStarting] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [socketState, setSocketState] = useState<"idle" | "connected" | "unavailable">("idle");
  const socket = useRef<WebSocket | null>(null);

  const stop = useCallback(async () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    socket.current?.close(); socket.current = null;
    setSocketState("idle");
    await nodes.current?.cleanup();
    nodes.current = null;
    gateOpen.current = false;
    setArmed(false);
  }, [setArmed]);

  const start = useCallback(async () => {
    if (nodes.current || starting) return;
    setStarting(true); setAudioError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const context = new AudioContext({ sampleRate: AUDIO.defaultSampleRate });
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const rawAnalyser = context.createAnalyser();
      const cleanAnalyser = context.createAnalyser();
      rawAnalyser.fftSize = AUDIO.fftSize; cleanAnalyser.fftSize = AUDIO.fftSize;
      rawAnalyser.smoothingTimeConstant = AUDIO.smoothing; cleanAnalyser.smoothingTimeConstant = AUDIO.smoothing;
      rawAnalyser.minDecibels = AUDIO.minDecibels; cleanAnalyser.minDecibels = AUDIO.minDecibels;
      rawAnalyser.maxDecibels = AUDIO.maxDecibels; cleanAnalyser.maxDecibels = AUDIO.maxDecibels;
      const highpass = context.createBiquadFilter(); highpass.type = "highpass"; highpass.frequency.value = AUDIO.highPassHz;
      const notch = context.createBiquadFilter(); notch.type = "notch"; notch.frequency.value = (AUDIO.notchLowHz + AUDIO.notchHighHz) / 2; notch.Q.value = 1.2;
      const gain = context.createGain(); gain.gain.value = AUDIO.cleanGain;
      source.connect(rawAnalyser); source.connect(highpass); highpass.connect(notch); notch.connect(gain); gain.connect(cleanAnalyser);
      const cleanup = async () => { stream.getTracks().forEach((track) => track.stop()); source.disconnect(); rawAnalyser.disconnect(); cleanAnalyser.disconnect(); highpass.disconnect(); notch.disconnect(); gain.disconnect(); await context.close(); };
      nodes.current = { context, stream, source, rawAnalyser, cleanAnalyser, highpass, notch, cleanup };
      setArmed(true);
      const wsOrigin = process.env.NEXT_PUBLIC_TELEMETRY_WS_ORIGIN ?? (process.env.NEXT_PUBLIC_DASH_API_ORIGIN ?? "").replace(/^http/, "ws");
      if (wsOrigin) {
        try {
          const audioSocket = new WebSocket(`${wsOrigin}/ws/audio`);
          audioSocket.binaryType = "arraybuffer";
          audioSocket.onopen = () => setSocketState("connected");
          audioSocket.onerror = () => setSocketState("unavailable");
          audioSocket.onclose = () => setSocketState("unavailable");
          socket.current = audioSocket;
        } catch { setSocketState("unavailable"); }
      } else setSocketState("unavailable");
      const rawTime = new Float32Array(rawAnalyser.fftSize);
      const cleanTime = new Float32Array(cleanAnalyser.fftSize);
      const rawFrequency = new Uint8Array(rawAnalyser.frequencyBinCount);
      const cleanFrequency = new Uint8Array(cleanAnalyser.frequencyBinCount);
      const draw = (now: number) => {
        if (!nodes.current) return;
        const interval = 1000 / (lowBandwidth ? AUDIO.lowFrameRate : AUDIO.maxFrameRate);
        if (now - lastFrame.current >= interval) {
          lastFrame.current = now;
          const bytes = Math.floor(context.sampleRate * interval / 1000) * 2;
          rawAnalyser.getFloatTimeDomainData(rawTime); cleanAnalyser.getFloatTimeDomainData(cleanTime);
          rawAnalyser.getByteFrequencyData(rawFrequency); cleanAnalyser.getByteFrequencyData(cleanFrequency);
          const measurement = buildDspFrame(rawTime, cleanTime, rawFrequency, cleanFrequency, context.sampleRate, gateOpen.current, sent.current, suppressed.current);
          if (!gateOpen.current && measurement.vad_prob >= AUDIO.gateOpenThreshold && measurement.rms >= AUDIO.rmsThreshold) gateOpen.current = true;
          else if (gateOpen.current && measurement.vad_prob <= AUDIO.gateCloseThreshold) gateOpen.current = false;
          if (gateOpen.current) sent.current += bytes; else suppressed.current += bytes;
          const finalMeasurement = { ...measurement, gate_open: gateOpen.current, bytes_sent: sent.current, bytes_suppressed: suppressed.current };
          setDsp(finalMeasurement);
          // Only gated PCM reaches our backend socket. The browser never calls Gnani directly.
          if (gateOpen.current && audioSocketReady(socket.current)) {
            const pcm = floatTo16BitPCM(cleanTime);
            socket.current?.send(pcm);
          }
        }
        frame.current = requestAnimationFrame(draw);
      };
      frame.current = requestAnimationFrame(draw);
    } catch (error) {
      const message = error instanceof DOMException && error.name === "NotAllowedError" ? "Microphone permission was denied. Allow access in browser settings and retry." : error instanceof Error ? error.message : "Microphone could not be started.";
      setAudioError(message); toast.error(message); setArmed(false);
    } finally { setStarting(false); }
  }, [lowBandwidth, setArmed, setDsp, starting]);

  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); socket.current?.close(); void nodes.current?.cleanup(); }, []);
  return { armed, starting, audioError, socketState, start, stop, toggle: () => armed ? void stop() : void start() };
}

function audioSocketReady(socket: WebSocket | null) { return socket?.readyState === WebSocket.OPEN; }
function floatTo16BitPCM(samples: Float32Array) {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}
