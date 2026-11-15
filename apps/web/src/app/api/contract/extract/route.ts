/**
 * POST /api/contract/extract — turn a verified transcript into the JSON the ledger signs.
 * Deterministic rules always run; Groq refines when configured (never overrides totals by >2%).
 */
import { NextResponse } from "next/server";
import { deterministicJudge, groqJudge } from "@/lib/server/judge";
import { normalizeIndicText, type NormalizerLocale } from "@/lib/gnani/normalizer";
import { WORKFLOWS, type WorkflowDomain } from "@/lib/server/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: { transcript?: string; workflow?: string; language?: string; reference_fair_price?: number; use_groq?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: { code: "INVALID_REQUEST", message: "Expected JSON." } }, { status: 400 });
  }
  const transcript = (body.transcript ?? "").trim();
  if (transcript.length < 4) {
    return NextResponse.json({ ok: false, error: { code: "INVALID_REQUEST", message: "transcript is required." } }, { status: 400 });
  }
  const domain = ((body.workflow ?? "mandi") as WorkflowDomain);
  const language = (body.language ?? "hi-IN") as NormalizerLocale;
  const normalized = normalizeIndicText(transcript, language);
  const startedAt = Date.now();

  const draft = deterministicJudge(domain in WORKFLOWS ? domain : "mandi", normalized.text, body.reference_fair_price);
  const refined = body.use_groq === false ? draft : await groqJudge(domain in WORKFLOWS ? domain : "mandi", normalized.text, draft);

  return NextResponse.json({
    ok: true,
    workflow: domain,
    workflow_label: WORKFLOWS[domain as WorkflowDomain]?.label ?? domain,
    normalized_transcript: normalized.text,
    normalization: { changed: normalized.changed, currency: normalized.currency, fractions: normalized.fractions },
    contract: refined,
    signable: (refined.confidence ?? 0) >= 0.6,
    extraction_ms: Date.now() - startedAt,
    engine: refined.engine,
    source: refined.engine === "deterministic" ? "computed" : "computed",
    exactness: refined.engine.includes("groq") ? "exact" : "estimated",
  });
}
