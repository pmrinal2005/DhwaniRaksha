/** SHA-256 helpers shared by the audio cache, the Boli-Patra hash chain and receipts. */

const encoder = new TextEncoder();

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Short(value: string, length = 16): Promise<string> {
  return (await sha256Hex(value)).slice(0, length);
}

/** Stable stringify with sorted keys so hashes never depend on property order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

/** Cache key exactly as specified: sha256(normalized_text + model + voice_or_embedding_hash + language). */
export async function ttsCacheKey(input: { text: string; model: string; voiceOrEmbedding: string; language: string }): Promise<string> {
  return sha256Hex([input.text, input.model, input.voiceOrEmbedding, input.language].join("\u0000"));
}

/** Ledger chain link: sha256(prev_hash + party_a_hash + party_b_hash + structured_json). */
export async function chainHash(input: { prev: string | null; partyA: string; partyB: string; contract: unknown }): Promise<string> {
  return sha256Hex([input.prev ?? "genesis", input.partyA, input.partyB, canonicalJson(input.contract)].join(":"));
}

export function shortHash(hash: string, size = 8): string {
  return hash.length > size * 2 ? `${hash.slice(0, size)}…${hash.slice(-size)}` : hash;
}
