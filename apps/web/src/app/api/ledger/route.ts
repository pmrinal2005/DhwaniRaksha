/** GET /api/ledger — hash-chained Boli-Patra receipts. POST /api/ledger — mint a new entry. */
import { NextResponse } from "next/server";
import { chainHash, sha256Short } from "@/lib/gnani/hash";
import { listLedger, mintLedgerEntry } from "@/lib/server/store";
import { WORKFLOWS, type WorkflowDomain } from "@/lib/server/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const workflow = url.searchParams.get("workflow");
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 40)));
  const rows = await listLedger(limit);
  const entries = workflow ? rows.data.filter((row) => row.workflowDomain === workflow) : rows.data;

  // Walk the chain newest -> oldest and confirm every prev hash links up.
  const sorted = [...rows.data].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const chainValidity = new Map<string, boolean>();
  sorted.forEach((row, index) => {
    chainValidity.set(row.id, index === 0 ? true : row.prevLedgerHash === sorted[index - 1].sha256AuditHash);
  });

  return NextResponse.json({
    ok: true,
    entries: entries.map((row) => ({
      ...row,
      chainValid: chainValidity.get(row.id) ?? null,
      workflow_label: WORKFLOWS[row.workflowDomain as WorkflowDomain]?.label ?? row.workflowDomain,
    })),
    chain: {
      length: rows.data.length,
      valid: entries.every((row) => chainValidity.get(row.id) === true),
      head: rows.data[0]?.sha256AuditHash ?? null,
      mode: rows.mode,
    },
    store_mode: rows.mode,
    store_error: rows.error,
    source: rows.mode === "live" ? "supabase" : "mock",
    exactness: rows.mode === "live" ? "exact" : "estimated",
  });
}

export async function POST(request: Request) {
  let body: {
    workflow?: string; party_a?: string; party_b?: string;
    party_a_language?: string; party_b_language?: string;
    party_a_cosine?: number; party_b_cosine?: number;
    source_transcript?: string; translated_transcript?: string;
    structured_contract?: Record<string, unknown>;
    embedding_b64?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: { code: "INVALID_REQUEST", message: "Expected a JSON contract payload." } }, { status: 400 });
  }
  const workflow = (body.workflow ?? "mandi") as WorkflowDomain;
  const meta = WORKFLOWS[workflow] ?? WORKFLOWS.mandi;
  if (!body.source_transcript || body.source_transcript.trim().length < 4) {
    return NextResponse.json({ ok: false, error: { code: "INVALID_REQUEST", message: "source_transcript is required to mint a Boli-Patra." } }, { status: 400 });
  }
  if (!body.structured_contract || Object.keys(body.structured_contract).length === 0) {
    return NextResponse.json({ ok: false, error: { code: "INVALID_REQUEST", message: "structured_contract is required — run the judge extraction first." } }, { status: 400 });
  }

  const partyACosine = clamp(body.party_a_cosine);
  const partyBCosine = clamp(body.party_b_cosine);
  if ((partyACosine ?? 0) < 0.86) {
    return NextResponse.json({ ok: false, error: { code: "VOICEPRINT_NOT_VERIFIED", message: `Party A cosine ${partyACosine ?? 0} is below the 0.86 escrow threshold — the contract cannot be signed.` } }, { status: 422 });
  }

  const partyA = body.party_a ?? meta.parties.a.name;
  const partyB = body.party_b ?? meta.parties.b.name;
  const minted = await mintLedgerEntry({
    workflowDomain: workflow,
    partyAName: partyA, partyBName: partyB,
    partyALanguage: body.party_a_language ?? meta.parties.a.language,
    partyBLanguage: body.party_b_language ?? meta.parties.b.language,
    partyACosine: partyACosine, partyBCosine: partyBCosine,
    sourceTranscript: body.source_transcript,
    translatedTranscript: body.translated_transcript ?? null,
    structuredContract: body.structured_contract,
    embeddingB64: body.embedding_b64,
  });

  const verification = await chainHash({ prev: minted.data.prevLedgerHash, partyA, partyB, contract: minted.data.structuredContract });

  return NextResponse.json({
    ok: true,
    entry: minted.data,
    receipt_url: `/receipt/${minted.data.id}`,
    chain_verified: verification === minted.data.sha256AuditHash,
    preview_hash: await sha256Short(minted.data.sha256AuditHash, 12),
    store_mode: minted.mode,
    store_error: minted.error,
    source: minted.mode === "live" ? "supabase" : "mock",
    exactness: minted.mode === "live" ? "exact" : "estimated",
  }, { status: 201 });
}

function clamp(value: number | undefined): number | null {
  if (value === undefined || value === null || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(1, Number(value)));
}
