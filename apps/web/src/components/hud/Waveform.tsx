"use client";

import { useEffect, useRef } from "react";

/** Live 32-band amplitude bars with spectral decay, used by the mic + arena panels. */
export function Waveform({ spectrum, active, color = "var(--ember)", height = 26 }: { spectrum: number[]; active: boolean; color?: string; height?: number }) {
  const bars = spectrum.length ? spectrum : Array.from({ length: 32 }, () => 0);
  return (
    <div className="wave-bars" style={{ height }} aria-hidden="true">
      {bars.map((value, index) => (
        <i
          key={index}
          style={{
            background: color,
            height: `${Math.max(active ? 8 : 4, Math.min(100, (value ?? 0) * 130 + (active ? 6 : 0)))}%`,
            opacity: active ? 0.55 + (value ?? 0) * 0.45 : 0.22,
          }}
        />
      ))}
    </div>
  );
}

interface Frame { raw: number[]; clean: number[] }

/**
 * Scrolling dual spectrogram: raw noisy input (top half) vs edge-cleaned output
 * (bottom half). Frames arrive from the capture engine at ~30 fps.
 */
export function DualSpectrogram({ frames, gateOpen, recordKey }: { frames: Frame[]; gateOpen: boolean; recordKey: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const historyRef = useRef<Frame[]>([]);

  useEffect(() => {
    historyRef.current = [];
  }, [recordKey]);

  useEffect(() => {
    if (frames.length) {
      historyRef.current = [...historyRef.current, frames[frames.length - 1]].slice(-180);
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const dpr = Math.min(2, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
    const width = canvas.clientWidth || 320;
    const height = canvas.clientHeight || 92;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#07080c";
    context.fillRect(0, 0, width, height);

    const rows = historyRef.current;
    const bands = rows[0]?.raw.length ?? 32;
    const columnWidth = width / Math.max(120, rows.length);
    const half = height / 2;

    rows.forEach((frame, column) => {
      const x = width - (rows.length - column) * columnWidth;
      for (let band = 0; band < bands; band += 1) {
        const y = half - (band / bands) * half;
        const rawValue = frame.raw[band] ?? 0;
        context.fillStyle = `rgba(255, ${Math.round(120 - rawValue * 90)}, ${Math.round(40 - rawValue * 30)}, ${0.25 + rawValue * 0.75})`;
        context.fillRect(x, y, Math.max(1, columnWidth - 0.4), half / bands + 0.6);
        const cleanValue = frame.clean[band] ?? 0;
        context.fillStyle = `rgba(${Math.round(80 + cleanValue * 40)}, ${Math.round(160 + cleanValue * 80)}, ${Math.round(180 + cleanValue * 60)}, ${0.2 + cleanValue * 0.8})`;
        context.fillRect(x, half + (half - y), Math.max(1, columnWidth - 0.4), half / bands + 0.6);
      }
    });

    // VAD gate stripe between halves
    context.fillStyle = gateOpen ? "rgba(34,197,139,.85)" : "rgba(255,255,255,.12)";
    context.fillRect(0, half - 1, width, 2);
  }, [frames, gateOpen]);

  return (
    <div className="spectro-wrap">
      <canvas ref={canvasRef} className="spectro-canvas" />
      <div className="spectro-legend">
        <span><i style={{ background: "#ff6b1a" }} />RAW IN</span>
        <span><i style={{ background: "#4fd1c5" }} />EDGE CLEAN</span>
        <span><i style={{ background: gateOpen ? "var(--emerald)" : "rgba(255,255,255,.25)" }} />{gateOpen ? "VAD OPEN" : "VAD CLOSED"}</span>
      </div>
    </div>
  );
}
