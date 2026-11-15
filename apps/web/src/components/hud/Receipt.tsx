"use client";

import { useMemo } from "react";

/**
 * Dependency-free QR-style matrix. Deterministic from the payload hash; it is a
 * scannable-looking verification glyph for the printed receipt, not an ECC QR —
 * the verifiable part of the receipt is the SHA-256 chain printed beside it.
 */
export function HashGlyph({ value, size = 104 }: { value: string; size?: number }) {
  const cells = useMemo(() => {
    const grid = 25;
    const output: boolean[] = new Array(grid * grid).fill(false);
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    let state = hash || 0x12345678;
    for (let index = 0; index < grid * grid; index += 1) {
      state ^= state << 13; state >>>= 0;
      state ^= state >>> 17;
      state ^= state << 5; state >>>= 0;
      output[index] = (state & 0xff) > 118;
    }
    // finder patterns
    const finder = (row: number, col: number) => {
      for (let r = 0; r < 7; r += 1) {
        for (let c = 0; c < 7; c += 1) {
          const edge = r === 0 || r === 6 || c === 0 || c === 6;
          const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          output[(row + r) * grid + (col + c)] = edge || core;
        }
      }
      for (let r = -1; r <= 7; r += 1) {
        for (let c = -1; c <= 7; c += 1) {
          const rr = row + r; const cc = col + c;
          if (rr < 0 || cc < 0 || rr >= grid || cc >= grid) continue;
          if (r === -1 || r === 7 || c === -1 || c === 7) output[rr * grid + cc] = false;
        }
      }
    };
    finder(0, 0); finder(0, grid - 7); finder(grid - 7, 0);
    return { grid, output };
  }, [value]);

  const scale = size / cells.grid;
  return (
    <div className="qr-box" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${cells.grid} ${cells.grid}`} shapeRendering="crispEdges" role="img" aria-label="Receipt verification glyph">
        <rect width={cells.grid} height={cells.grid} fill="#fff" />
        {cells.output.map((filled, index) => filled ? (
          <rect key={index} x={index % cells.grid} y={Math.floor(index / cells.grid)} width="1" height="1" fill="#0b0c10" />
        ) : null)}
        <rect width={cells.grid} height={cells.grid} fill="none" stroke="#0b0c10" strokeWidth="0.4" />
      </svg>
      <span className="sr-only">{`${scale.toFixed(1)} cell scale`}</span>
    </div>
  );
}

/** Horizontal SHA-256 chain: prev → contract → hash, with link validity. */
export function HashChainStrip({ hashes, valid = true }: { hashes: { label: string; value: string; ok?: boolean }[]; valid?: boolean }) {
  return (
    <div className="hash-chain">
      {hashes.map((hash, index) => (
        <div className="hash-node" key={`${hash.label}-${index}`}>
          <div className={`hash-dot ${hash.ok === false ? "invalid" : ""}`} title={`${hash.label}: ${hash.value}`}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M5 12h14M12 5v14" /></svg>
          </div>
          {index < hashes.length - 1 && <span className="hash-link" style={{ background: valid ? "var(--emerald)" : "var(--rose)" }} />}
        </div>
      ))}
    </div>
  );
}
