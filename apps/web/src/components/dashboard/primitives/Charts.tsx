"use client";

import { useId, useMemo, useState } from "react";
import { LAYOUT } from "./tokens";
import { formatCompact, numericSeries } from "@/lib/format";

export function Sparkline({ series, color = "var(--ember)", height = 36, label = "Live trend" }: { series: Array<number | { ts: string; value: number }>; color?: string; height?: number; label?: string }) {
  const id = useId().replace(/:/g, "");
  const values = numericSeries(series);
  const path = useMemo(() => {
    if (values.length < 2) return { line: "", area: "", last: { x: 0, y: 0 } };
    const min = Math.min(...values); const max = Math.max(...values); const spread = max - min || 1;
    const points = values.map((value, index) => ({ x: index / (values.length - 1) * 100, y: 30 - (value - min) / spread * 26 + 2 }));
    const line = points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
    return { line, area: `${line} L100,34 L0,34 Z`, last: points[points.length - 1] };
  }, [values]);
  if (values.length < 2) return <div className="empty-chart" style={{ height }} aria-label={`${label}: no series data`}>—</div>;
  return <svg className="sparkline" viewBox="0 0 100 34" preserveAspectRatio="none" role="img" aria-label={label} style={{ height }}>
    <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop stopColor={color} stopOpacity=".23" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
    <path d={path.area} fill={`url(#${id})`} />
    <path d={path.line} fill="none" stroke={color} strokeWidth="1.4" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx={path.last.x} cy={path.last.y} r="1.8" fill={color} vectorEffect="non-scaling-stroke" />
  </svg>;
}

export function MiniBars({ values, color = "var(--ember)" }: { values: number[]; color?: string }) {
  const max = Math.max(...values, 1);
  return <div style={{ display: "flex", alignItems: "end", gap: 3, height: 30 }} aria-label="Live bar series">{values.map((value, index) => <span key={index} style={{ flex: 1, height: `${value / max * 100}%`, minHeight: value ? 2 : 0, background: color, opacity: .35 + index / Math.max(values.length, 1) * .55, borderRadius: 2 }} />)}</div>;
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (value: T) => void; options: readonly { value: T; label: string }[]; label: string }) {
  return <div className="segmented" role="group" aria-label={label}>{options.map((option) => <button key={option.value} className={value === option.value ? "active" : ""} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>;
}

export function useChartScale(values: number[]) {
  const [hover, setHover] = useState<number | null>(null);
  return { min: Math.min(...values, 0), max: Math.max(...values, 1), hover, setHover, samples: LAYOUT.chartSamples, compact: formatCompact };
}
