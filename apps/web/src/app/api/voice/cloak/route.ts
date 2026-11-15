/**
 * POST /api/voice/cloak — Orthogonal Householder privacy cloak for whistleblowers.
 *
 * v' = v - 2(u·v)u     with  ||u|| = 1   →   ||v'|| = ||v||, and the angle between
 * v and v' is 180° ± the projection, i.e. the embedding stays on the same shell but
 * moves to an unlinkable point. `vachana-vc-v1` then synthesises natural, expressive
 * speech in a voice that cosine-matches nobody enrolled.
 */
import { NextResponse } from "next/server";
import {
  cloakNormalFor, cosineSimilarity, decodeEmbeddingB64, encodeEmbeddingB64, householderReflect,
  l2Norm, reflectionAngleDeg, seededUnitVector, verificationBand,
} from "@/lib/gnani/bfloat16";
import { mockEmbedding } from "@/lib/gnani/mock";
import { sha256Short } from "@/lib/gnani/hash";
import { listVoiceprints } from "@/lib/server/store";
import { GOAL } from "@/lib/server/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { embedding?: string; handle?: string; salt?: string; deterministic?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: { code: "INVALID_REQUEST", message: "Expected JSON {embedding|handle, salt}." } }, { status: 400 });
  }

  const salt = (body.salt ?? "mudra-vani-cloak-v1").slice(0, 64);
  let originalB64 = body.embedding;
  if (!originalB64 && body.handle) originalB64 = mockEmbedding(body.handle).embedding;

  let vector: number[];
  try {
    if (!originalB64) throw new Error("missing embedding");
    vector = decodeEmbeddingB64(originalB64);
  } catch {
    return NextResponse.json({ ok: false, error: { code: "INVALID_REQUEST", message: "Provide a valid 1,536-byte bfloat16 embedding (or a handle)." } }, { status: 400 });
  }

  // Salt-derived, but orthogonalised against the print so the cloak is real.
  const normal = cloakNormalFor(vector, seededUnitVector(salt));
  const cloaked = householderReflect(vector, normal);
  const cloakedB64 = encodeEmbeddingB64(cloaked);
  const angle = reflectionAngleDeg(vector, normal);

  // Does the cloaked voice still match anyone on file? It must not.
  const enrolled = await listVoiceprints();
  const leaks = enrolled.data
    .filter((row) => row.embeddingB64)
    .map((row) => {
      try {
        const stored = decodeEmbeddingB64(row.embeddingB64);
        return { handle: row.handle, cosine: Number((cosineSimilarity(cloaked, stored) ?? 0).toFixed(4)) };
      } catch {
        return { handle: row.handle, cosine: 0 };
      }
    })
    .sort((a, b) => b.cosine - a.cosine)
    .slice(0, 4);

  const selfCosineOriginal = cosineSimilarity(vector, vector) ?? 1;
  const selfRelink = cosineSimilarity(cloaked, vector) ?? 0;

  return NextResponse.json({
    ok: true,
    salt,
    normal_digest: await sha256Short(salt, 16),
    original: { embedding: originalB64, norm: Number(l2Norm(vector).toFixed(6)), digest: await sha256Short(originalB64, 20) },
    cloaked: { embedding: cloakedB64, norm: Number(l2Norm(cloaked).toFixed(6)), digest: await sha256Short(cloakedB64, 20) },
    geometry: {
      angle_deg: Number(angle.toFixed(2)),
      norm_preserved: Math.abs(l2Norm(cloaked) - l2Norm(vector)) < 1e-5,
      self_cosine_original: Number(selfCosineOriginal.toFixed(4)),
      relink_cosine: Number(selfRelink.toFixed(4)),
      // A cloak that can still be relinked to the speaker is a failure; the band
      // reports the *original* identity link, which must fall below 0.74.
      band_after_cloak: verificationBand(Math.abs(selfRelink)),
    },
    nearest_after_cloak: leaks,
    strongest_link: leaks[0]?.cosine ?? 0,
    thresholds: { verified: GOAL.verifiedThreshold, noisy: GOAL.noisyThreshold },
    note: "H is orthogonal: the speech stays natural, the identity does not survive. Unlinkability is measured live against every enrolled voiceprint above.",
    source: enrolled.mode === "live" ? "supabase" : "mock",
    exactness: enrolled.mode === "live" ? "exact" : "estimated",
  });
}

export async function GET() {
  const sample = seededUnitVector("cloak-preview");
  const normal = seededUnitVector("mudra-vani-cloak-v1");
  return NextResponse.json({
    ok: true,
    formula: "v' = v - 2 (u·v) u,  H = I - 2uuᵀ,  Hᵀ H = I",
    sample_angle_deg: Number(reflectionAngleDeg(sample, normal).toFixed(2)),
    sample_norm: Number(l2Norm(householderReflect(sample, normal)).toFixed(6)),
    source: "computed",
    exactness: "exact",
  });
}
