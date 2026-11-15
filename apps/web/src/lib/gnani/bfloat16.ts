/**
 * Bidirectional codec for Gnani voice-clone embeddings.
 *
 * The embeddings endpoint returns:
 *   { "embedding": "<base64>", "shape": [1, 768], "dtype": "torch.bfloat16" }
 * which is 768 x 2 bytes = 1,536 bytes of little-endian bfloat16.
 *
 * bfloat16 shares the 8-bit exponent of IEEE-754 float32 and keeps only the
 * upper 7 mantissa bits, so the conversion is a 16-bit shift — not a lossy
 * custom float. Everything here is pure and deterministic (no Math.random):
 * the whole biometric / Householder pipeline must be reproducible.
 */

export const EMBEDDING_DIM = 768;
export const EMBEDDING_BYTES = EMBEDDING_DIM * 2;

export interface SpeakerEmbedding {
  embedding: string;
  shape: [number, number];
  dtype: "torch.bfloat16";
}

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
};

const fromBase64 = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

/** uint16 bfloat16 bits -> float32 (left shift 16, reinterpret IEEE-754). */
export function bfloat16BitsToFloat32(bits: number): number {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setUint32(0, (bits & 0xffff) << 16, false);
  return view.getFloat32(0, false);
}

/** float32 -> uint16 bfloat16 bits with round-to-nearest-even on the discarded mantissa. */
export function float32ToBfloat16Bits(value: number): number {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setFloat32(0, value, false);
  const bits = view.getUint32(0, false);
  if (Number.isNaN(view.getFloat32(0, false))) return 0x7fc0;
  const rounding = 0x7fff + ((bits >>> 16) & 1);
  return ((bits + rounding) >>> 16) & 0xffff;
}

/** Decode base64 payload -> float32[768]. Throws when the payload is not 1,536 bytes. */
export function decodeEmbeddingB64(b64: string): number[] {
  const bytes = fromBase64(b64);
  if (bytes.length !== EMBEDDING_BYTES) {
    throw new Error(`Expected ${EMBEDDING_BYTES} bytes of bfloat16 (768 x 2), received ${bytes.length}.`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const output = new Array<number>(EMBEDDING_DIM);
  for (let index = 0; index < EMBEDDING_DIM; index += 1) output[index] = bfloat16BitsToFloat32(view.getUint16(index * 2, true));
  return output;
}

/** Encode float32[768] -> base64 bfloat16 payload (round-to-nearest-even). */
export function encodeEmbeddingB64(vector: readonly number[]): string {
  if (vector.length !== EMBEDDING_DIM) throw new Error(`Embedding must hold ${EMBEDDING_DIM} values, received ${vector.length}.`);
  const bytes = new Uint8Array(EMBEDDING_BYTES);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < EMBEDDING_DIM; index += 1) view.setUint16(index * 2, float32ToBfloat16Bits(vector[index]), true);
  return toBase64(bytes);
}

export function l2Norm(vector: readonly number[]): number {
  let sum = 0;
  for (const value of vector) sum += value * value;
  return Math.sqrt(sum);
}

export function l2Normalize(vector: readonly number[]): number[] {
  const norm = l2Norm(vector);
  if (!norm) return vector.slice();
  return vector.map((value) => value / norm);
}

export function dot(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) sum += a[index] * b[index];
  return sum;
}

/** Cosine similarity, clamped to [-1, 1]. Returns null on zero-energy vectors. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number | null {
  if (a.length !== b.length || a.length === 0) return null;
  const denominator = l2Norm(a) * l2Norm(b);
  if (!denominator) return null;
  return Math.max(-1, Math.min(1, dot(a, b) / denominator));
}

/** Deterministic unit vector from a seed string (FNV-1a -> xorshift), used for salts + demo voices. */
export function seededUnitVector(seed: string, dimensions = EMBEDDING_DIM): number[] {
  let state = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 0x01000193) >>> 0;
  }
  const output = new Array<number>(dimensions);
  for (let index = 0; index < dimensions; index += 1) {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    const uniform = (state >>> 8) / 0x01000000;
    // Box-Muller-ish shaping keeps the vector close to an isotropic Gaussian direction.
    const second = ((Math.imul(state, 48271) >>> 8) / 0x01000000);
    output[index] = Math.sqrt(-2 * Math.log(Math.max(uniform, 1e-9))) * Math.cos(2 * Math.PI * second);
  }
  return l2Normalize(output);
}

/**
 * Householder reflection  H = I - 2uu^T  applied in O(d):
 *   v' = v - 2 (u . v) u
 * `H` is orthogonal, so ||Hv|| = ||v|| and the refracted vector stays on the
 * same hypersphere shell — natural prosody survives, identity does not.
 */
export function householderReflect(vector: readonly number[], unitNormal: readonly number[]): number[] {
  if (vector.length !== unitNormal.length) throw new Error("Householder normal must match embedding dimensions.");
  const scale = 2 * dot(unitNormal, vector);
  return vector.map((value, index) => value - scale * unitNormal[index]);
}

/**
 * Build the reflection normal that maximally unlinks a vector from itself.
 *
 * A random unit normal in 768-d has |u·v̂| ≈ 1/√768, so Hv still sits at
 * cos ≈ 0.999 with v — useless as a cloak. We instead take the salt's
 * component orthogonal to v̂ and mix it 45°/45° with v̂, which gives
 * |u·v̂| = 1/√2 exactly, hence cos(v, Hv) = 0: the cloaked print is
 * orthogonal to the original, the L2 norm is untouched, and English
 * prosody survives because the rotation lives in a single 2-plane.
 */
export function cloakNormalFor(vector: readonly number[], orthogonalSource: readonly number[]): number[] {
  const unit = l2Normalize(vector);
  const projection = dot(orthogonalSource, unit);
  let orth = orthogonalSource.map((value, index) => value - projection * unit[index]);
  let orthNorm = l2Norm(orth);
  if (orthNorm < 1e-6) {
    // Salt was (numerically) parallel to the print — step to a deterministic neighbour.
    orth = unit.map((_, index) => (index % 2 === 0 ? 1 : -1) * (1 + (index % 7) / 7));
    const second = dot(orth, unit);
    orth = orth.map((value, index) => value - second * unit[index]);
    orthNorm = l2Norm(orth);
  }
  const root = Math.SQRT1_2;
  return unit.map((value, index) => root * value + root * (orth[index] / orthNorm));
}

/** Angle between v and Hv in degrees, using the exact identity cos(θ) = 1 - 2(u·v̂)². */
export function reflectionAngleDeg(vector: readonly number[], unitNormal: readonly number[]): number {
  const unit = l2Normalize(vector);
  const projection = dot(unit, unitNormal);
  const cosine = Math.max(-1, Math.min(1, 1 - 2 * projection * projection));
  return (Math.acos(cosine) * 180) / Math.PI;
}

export type VerificationBand = "verified" | "noisy_warning" | "rejected";

export const VERIFY_THRESHOLDS = Object.freeze({ verified: 0.86, noisy: 0.74 });

export function verificationBand(cosine: number, thresholds = VERIFY_THRESHOLDS): VerificationBand {
  if (cosine >= thresholds.verified) return "verified";
  if (cosine >= thresholds.noisy) return "noisy_warning";
  return "rejected";
}

export function toSpeakerEmbedding(vector: readonly number[]): SpeakerEmbedding {
  return { embedding: encodeEmbeddingB64(vector), shape: [1, EMBEDDING_DIM], dtype: "torch.bfloat16" };
}

/** Read both accepted embedding response shapes (docs show `data.voice_clone_embedding`, examples show flat). */
export function extractEmbeddingPayload(body: unknown): SpeakerEmbedding | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const candidate =
    (record.data as Record<string, unknown> | undefined)?.voice_clone_embedding ??
    record.voice_clone_embedding ??
    (typeof record.embedding === "string" ? record : undefined);
  if (!candidate || typeof candidate !== "object") return null;
  const embedding = (candidate as Record<string, unknown>).embedding;
  if (typeof embedding !== "string" || embedding.length === 0) return null;
  const shape = (candidate as Record<string, unknown>).shape;
  const dtype = (candidate as Record<string, unknown>).dtype;
  return {
    embedding,
    shape: Array.isArray(shape) && shape.length === 2 ? [Number(shape[0]), Number(shape[1])] : [1, EMBEDDING_DIM],
    dtype: dtype === "torch.bfloat16" ? "torch.bfloat16" : "torch.bfloat16",
  };
}

/** Short, stable content address for an embedding (used in cache keys + audit hashes). */
export async function embeddingDigest(b64: string): Promise<string> {
  const bytes = new TextEncoder().encode(b64);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 24);
}
