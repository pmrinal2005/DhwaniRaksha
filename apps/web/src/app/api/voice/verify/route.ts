/**
 * POST /api/voice/verify — biometric escrow check against enrolled voiceprints.
 *  * cosine >= 0.86 → verified (green seal, the ledger may be signed)
 *  * 0.74–0.85      → noisy channel (ask for a 3-second re-confirmation)
 *  * < 0.74         → rejected (spoof / impostor)
 *
 * Also returns the five nearest neighbours so the UI can draw the constellation
 * and the verification histogram without another round trip.
 */
import { NextResponse } from "next/server";
import { cosineSimilarity, decodeEmbeddingB64, encodeEmbeddingB64, verificationBand, VERIFY_THRESHOLDS } from "@/lib/gnani/bfloat16";
import { mockEmbedding } from "@/lib/gnani/mock";
import { seededUnitVector } from "@/lib/gnani/bfloat16";
import { listVoiceprints } from "@/lib/server/store";
import { GOAL } from "@/lib/server/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { live_embedding?: string; handle?: string; reference_vector?: number[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: { code: "INVALID_REQUEST", message: "Expected JSON {live_embedding} or {handle}." } }, { status: 400 });
  }

  const enrolled = await listVoiceprints();
  let liveVector: number[] | null = null;
  let liveB64: string | null = null;
  if (body.live_embedding) {
    try {
      liveVector = decodeEmbeddingB64(body.live_embedding);
      liveB64 = body.live_embedding;
    } catch {
      liveVector = null;
    }
  } else if (Array.isArray(body.reference_vector) && body.reference_vector.length === 768) {
    liveVector = body.reference_vector;
    liveB64 = encodeEmbeddingB64(liveVector);
  } else if (body.handle) {
    liveVector = seededUnitVector(`${body.handle}:mudra-vani-enrolment`);
    liveB64 = encodeEmbeddingB64(liveVector);
  }

  if (!liveVector || !liveB64) {
    return NextResponse.json({ ok: false, error: { code: "INVALID_REQUEST", message: "Provide live_embedding (base64 bfloat16) or handle." } }, { status: 400 });
  }

  const comparisons = enrolled.data
    .filter((row) => row.embeddingB64)
    .map((row) => {
      let stored: number[] | null = null;
      try { stored = decodeEmbeddingB64(row.embeddingB64); } catch { stored = null; }
      const cosine = stored ? cosineSimilarity(liveVector!, stored) : null;
      return {
        id: row.id, handle: row.handle, role: row.role, language: row.language,
        cosine: cosine === null ? 0 : Number(cosine.toFixed(4)),
        band: verificationBand(cosine ?? 0),
      };
    })
    .sort((a, b) => b.cosine - a.cosine);

  const best = comparisons[0] ?? null;
  const band = best ? best.band : "rejected";
  const thresholds = { verified: GOAL.verifiedThreshold, noisy: GOAL.noisyThreshold };
  const histogram = buildHistogram(comparisons.map((row) => row.cosine));

  return NextResponse.json({
    ok: true,
    best_match: best,
    band,
    thresholds,
    comparisons,
    histogram,
    live_digest: liveB64.slice(0, 24),
    enrolled_count: comparisons.length,
    store_mode: enrolled.mode,
    store_error: enrolled.error,
    note: band === "noisy_warning" ? "Cosine sits in the noisy-channel band — request a 3-second re-confirmation before signing." : null,
    source: enrolled.mode === "live" ? "supabase" : "mock",
    exactness: enrolled.mode === "live" ? "exact" : "estimated",
  });
}

function buildHistogram(values: number[]) {
  const bins = Array.from({ length: 18 }, (_, index) => ({ from: 0.5 + index * (0.5 / 18), count: 0 }));
  for (const value of values) {
    const index = Math.min(bins.length - 1, Math.max(0, Math.floor((value - 0.5) / (0.5 / 18))));
    bins[index].count += 1;
  }
  return bins.map((bin) => ({ from: Number(bin.from.toFixed(3)), count: bin.count }));
}

/** Convenience GET so the panel can show thresholds before any enrolment exists. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    thresholds: { verified: GOAL.verifiedThreshold, noisy: GOAL.noisyThreshold },
    bands: { verified: ">= 0.86", noisy_warning: "0.74 – 0.85", rejected: "< 0.74" },
    similarity: "cosine over L2-normalised float32 upcast from torch.bfloat16[1,768]",
    mock_embedding_sample: mockEmbedding("preview").embedding.slice(0, 24) + "…",
    source: "computed",
    exactness: "exact",
  });
}

void VERIFY_THRESHOLDS;
