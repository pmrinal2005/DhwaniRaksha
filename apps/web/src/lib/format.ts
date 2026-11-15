export function numericSeries(series: Array<number | { ts: string; value: number }> | undefined): number[] {
  if (!series) return [];
  return series.map((point) => typeof point === "number" ? point : point.value);
}

export function formatNumber(value: number | null | undefined, options?: Intl.NumberFormatOptions) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, ...options }).format(value);
}

export function formatCompact(value: number | null | undefined) {
  return formatNumber(value, { notation: "compact", maximumFractionDigits: 1 });
}

export function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
}

export function formatTime(ts: string | number | null | undefined) {
  if (!ts) return "—";
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? String(ts) : new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date);
}

export function formatDate(ts: string | null | undefined) {
  if (!ts) return "Not projected";
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? ts : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function bytesLabel(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function shortHash(hash: string, size = 8) {
  return hash.length > size * 2 ? `${hash.slice(0, size)}…${hash.slice(-size)}` : hash;
}

export function cosineSimilarity(a: number[], b: number[]) {
  if (a.length !== b.length || a.length === 0) return null;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] ** 2;
    normB += b[index] ** 2;
  }
  if (!normA || !normB) return null;
  return dot / Math.sqrt(normA * normB);
}

export function verificationMetrics(scores: Array<{ score: number; label: "genuine" | "impostor" | "unknown" }>, threshold: number) {
  const genuine = scores.filter((item) => item.label === "genuine");
  const impostor = scores.filter((item) => item.label === "impostor");
  const falseAccepts = impostor.filter((item) => item.score >= threshold).length;
  const falseRejects = genuine.filter((item) => item.score < threshold).length;
  const accepted = scores.filter((item) => item.score >= threshold && item.label !== "unknown").length;
  const labelled = genuine.length + impostor.length;
  return {
    genuine: genuine.length,
    impostor: impostor.length,
    far: impostor.length ? falseAccepts / impostor.length : null,
    frr: genuine.length ? falseRejects / genuine.length : null,
    accepted: labelled ? accepted / labelled : null,
  };
}

export function workflowSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export async function verifyLedgerLink(entry: { structured_contract: Record<string, unknown>; prev_ledger_hash: string | null; sha256_audit_hash: string }, previousHash?: string | null) {
  if (previousHash !== undefined && entry.prev_ledger_hash !== previousHash) return false;
  const canonical = JSON.stringify(entry.structured_contract, Object.keys(entry.structured_contract).sort());
  const bytes = new TextEncoder().encode(`${entry.prev_ledger_hash ?? ""}:${canonical}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const computed = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return computed === entry.sha256_audit_hash;
}

export function languageName(code: string | null | undefined) {
  if (!code) return "—";
  try { return new Intl.DisplayNames(["en"], { type: "language" }).of(code.split("-")[0]) ?? code; } catch { return code; }
}
