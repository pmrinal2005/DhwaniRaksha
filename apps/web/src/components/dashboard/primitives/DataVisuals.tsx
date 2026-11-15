"use client";

import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "motion/react";
import { formatNumber } from "@/lib/format";

export function NumberTween({ value, formatter = (number) => formatNumber(number), className = "" }: { value: number | null | undefined; formatter?: (value: number) => string; className?: string }) {
  const reduced = useReducedMotion();
  const previous = useRef(0);
  const [display, setDisplay] = useState(value ?? 0);
  useEffect(() => {
    if (value === null || value === undefined) return;
    if (reduced) { setDisplay(value); previous.current = value; return; }
    const controls = animate(previous.current, value, { duration: .65, ease: [0.16, 1, 0.3, 1], onUpdate: setDisplay });
    previous.current = value;
    return () => controls.stop();
  }, [value, reduced]);
  if (value === null || value === undefined) return <span className={className}>—</span>;
  return <span className={`${className} mono`} style={{ fontVariantNumeric: "tabular-nums" }}>{formatter(display)}</span>;
}

export function Delta({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return null;
  return <span className={`pill ${value >= 0 ? "positive" : "negative"}`}>{value >= 0 ? "↗" : "↘"} {formatNumber(Math.abs(value))}%</span>;
}

export function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`toggle ${checked ? "on" : ""}`} onClick={() => { onChange(); if ("vibrate" in navigator) navigator.vibrate(8); }} />;
}

export function StatusPill({ status, children }: { status: "positive" | "negative" | "warning" | "neutral"; children: React.ReactNode }) {
  return <span className={`pill ${status === "neutral" ? "" : status}`}>{children}</span>;
}
