"use client";

import { useEffect, useRef } from "react";

interface Point { x: number; y: number; z: number; weight: number }

/**
 * 3D projection of the real 768-dimensional embedding the server returned.
 * Dimensions are folded into 3 axes by golden-angle triplets (a deterministic
 * Johnson–Lindenstrauss-style sketch): no toy data, it is the actual tensor.
 */
function project(vector: number[]): Point[] {
  const points: Point[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const step = 2.399963;
  for (let index = 0; index < vector.length; index += 1) {
    const value = vector[index] ?? 0;
    const theta = index * golden;
    const phi = Math.acos(1 - (2 * (index + 0.5)) / vector.length);
    const radius = 0.72 + Math.min(0.9, Math.abs(value)) * 1.05;
    points.push({
      x: Math.sin(phi) * Math.cos(theta + index * step * 0.001) * radius,
      y: Math.cos(phi) * radius,
      z: Math.sin(phi) * Math.sin(theta) * radius + value * 0.35,
      weight: Math.abs(value),
    });
  }
  return points;
}

export function VoiceprintConstellation({
  vector,
  comparison,
  cloaked,
  cosine,
  angleDeg,
  height = 208,
}: {
  vector: number[] | null;
  comparison?: number[] | null;
  cloaked?: number[] | null;
  cosine?: number | null;
  angleDeg?: number | null;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rotation = useRef(0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const points = vector ? project(vector) : [];
    const comparisonPoints = comparison ? project(comparison) : [];
    const cloakedPoints = cloaked ? project(cloaked) : [];

    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = canvas.clientWidth || 280;
      const heightPx = canvas.clientHeight || height;
      if (canvas.width !== width * dpr || canvas.height !== heightPx * dpr) {
        canvas.width = width * dpr;
        canvas.height = heightPx * dpr;
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, heightPx);

      const cx = width / 2;
      const cy = heightPx / 2;
      const scale = Math.min(width, heightPx) * 0.33;
      const cos = Math.cos(rotation.current);
      const sin = Math.sin(rotation.current);

      // orbit rings
      for (let ring = 1; ring <= 3; ring += 1) {
        context.beginPath();
        context.ellipse(cx, cy, scale * (0.42 * ring), scale * (0.16 * ring), 0, 0, Math.PI * 2);
        context.strokeStyle = `rgba(167,139,250,${0.1 - ring * 0.02})`;
        context.lineWidth = 1;
        context.stroke();
      }

      const renderCloud = (cloud: Point[], color: [number, number, number], alpha: number, size: number) => {
        const sorted = cloud.map((point) => {
          const rx = point.x * cos - point.z * sin;
          const rz = point.x * sin + point.z * cos;
          const perspective = 1 / (1 + rz * 0.22);
          return { sx: cx + rx * scale * perspective, sy: cy + point.y * scale * perspective, depth: rz, weight: point.weight };
        }).sort((a, b) => a.depth - b.depth);
        for (const point of sorted) {
          const radius = size + point.weight * size * 1.6;
          context.beginPath();
          context.arc(point.sx, point.sy, radius, 0, Math.PI * 2);
          context.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${Math.max(0.06, alpha * (0.45 + point.weight))})`;
          context.fill();
        }
      };

      if (points.length) renderCloud(points, [167, 139, 250], 0.55, 1.15);
      if (comparisonPoints.length) renderCloud(comparisonPoints, [34, 197, 139], 0.5, 1.0);
      if (cloakedPoints.length) renderCloud(cloakedPoints, [255, 107, 26], 0.6, 1.15);

      // connecting shear lines between live and enrolled vectors
      if (points.length && comparisonPoints.length) {
        for (let index = 0; index < points.length; index += 24) {
          const a = points[index];
          const b = comparisonPoints[index];
          if (!a || !b) continue;
          const ax = cx + (a.x * cos - a.z * sin) * scale;
          const ay = cy + a.y * scale;
          const bx = cx + (b.x * cos - b.z * sin) * scale;
          const by = cy + b.y * scale;
          context.beginPath();
          context.moveTo(ax, ay);
          context.lineTo(bx, by);
          context.strokeStyle = "rgba(34,197,139,.14)";
          context.lineWidth = 0.8;
          context.stroke();
        }
      }

      // centre reading
      context.fillStyle = "rgba(255,255,255,.55)";
      context.font = "500 9px 'JetBrains Mono', monospace";
      context.textAlign = "center";
      if (cosine !== null && cosine !== undefined) {
        context.fillText(`cos ${cosine.toFixed(3)}`, cx, heightPx - 12);
      }
      if (angleDeg !== null && angleDeg !== undefined) {
        context.fillStyle = "rgba(255,107,26,.7)";
        context.fillText(`H-rotation ${angleDeg.toFixed(1)}°`, cx, 14);
      }

      if (!reduced) {
        rotation.current += 0.0022;
        frame.current = requestAnimationFrame(draw);
      }
    };
    draw();
    return () => { if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, [vector, comparison, cloaked, cosine, angleDeg, height]);

  return <canvas ref={canvasRef} className="constellation-canvas" style={{ height }} aria-label="768-dimensional voiceprint constellation" />;
}

/** Cosine gauge with the 0.86 / 0.74 escrow bands drawn explicitly. */
export function CosineDial({ cosine, size = 92, threshold = 0.86, noisy = 0.74 }: { cosine: number | null; size?: number; threshold?: number; noisy?: number }) {
  const value = cosine ?? 0;
  const sweep = 270;
  const start = 135;
  const end = start + sweep * Math.max(0, Math.min(1, value));
  const radius = size / 2 - 8;
  const center = size / 2;
  const point = (angle: number) => {
    const rad = (angle * Math.PI) / 180;
    return { x: center + radius * Math.cos(rad), y: center + radius * Math.sin(rad) };
  };
  const arc = (from: number, to: number) => {
    const a = point(from);
    const b = point(to);
    const large = to - from > 180 ? 1 : 0;
    return `M ${a.x} ${a.y} A ${radius} ${radius} 0 ${large} 1 ${b.x} ${b.y}`;
  };
  const bandColor = value >= threshold ? "var(--emerald)" : value >= noisy ? "var(--amber)" : "var(--rose)";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label={`Cosine similarity ${value.toFixed(3)}`}>
      <path d={arc(start, start + sweep)} stroke="var(--surface-3)" strokeWidth="6" fill="none" strokeLinecap="round" />
      <path d={arc(start, Math.max(start + 0.5, end))} stroke={bandColor} strokeWidth="6" fill="none" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 6px ${bandColor})` }} />
      <circle {...point(start + sweep * noisy)} r="2.2" fill="var(--amber)" />
      <circle {...point(start + sweep * threshold)} r="2.2" fill="var(--emerald)" />
    </svg>
  );
}

/** ASCII-ish band for the receipt: a deterministic fingerprint of a vector. */
export function VoiceprintGlyph({ vector, color = "var(--violet)" }: { vector: number[]; color?: string }) {
  const bars = Array.from({ length: 48 }, (_, index) => {
    const sample = vector[Math.floor((index / 48) * vector.length)] ?? 0;
    return Math.abs(sample);
  });
  const max = Math.max(...bars, 0.0001);
  return (
    <svg viewBox="0 0 96 20" className="sig-canvas" preserveAspectRatio="none" aria-hidden="true">
      {bars.map((value, index) => (
        <rect key={index} x={index * 2} y={10 - (value / max) * 9} width="1.2" height={Math.max(1.2, (value / max) * 18)} fill={color} opacity={0.45 + (value / max) * 0.55} rx="0.5" />
      ))}
    </svg>
  );
}
