/** GET /api/ledger/:id — a single Boli-Patra receipt with its chain position verified. */
import { NextResponse } from "next/server";
import { chainHash } from "@/lib/gnani/hash";
import { getLedgerEntry, listLedger } from "@/lib/server/store";
import { WORKFLOWS, type WorkflowDomain } from "@/lib/server/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const entry = await getLedgerEntry(id);
  if (!entry.data) {
    return NextResponse.json({ ok: false, error: { code: "NOT_FOUND", message: `No Boli-Patra with id ${id}.` } }, { status: 404 });
  }
  const all = await listLedger(200);
  const ordered = [...all.data].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const index = ordered.findIndex((row) => row.id === id);
  const previous = index > 0 ? ordered[index - 1] : null;

  const recomputed = await chainHash({
    prev: entry.data.prevLedgerHash,
    partyA: entry.data.partyAName,
    partyB: entry.data.partyBName,
    contract: entry.data.structuredContract,
  });

  return NextResponse.json({
    ok: true,
    entry: {
      ...entry.data,
      chainValid: previous ? entry.data.prevLedgerHash === previous.sha256AuditHash : true,
      workflow_label: WORKFLOWS[entry.data.workflowDomain as WorkflowDomain]?.label ?? entry.data.workflowDomain,
      workflow_native: WORKFLOWS[entry.data.workflowDomain as WorkflowDomain]?.native ?? "",
    },
    chain: {
      position: index + 1,
      of: ordered.length,
      prev_hash: entry.data.prevLedgerHash,
      recomputed_hash: recomputed,
      hash_valid: recomputed === entry.data.sha256AuditHash,
      previous_entry: previous ? { id: previous.id, sha256: previous.sha256AuditHash, createdAt: previous.createdAt } : null,
    },
    store_mode: entry.mode,
    source: entry.mode === "live" ? "supabase" : "mock",
    exactness: entry.mode === "live" ? "exact" : "estimated",
  });
}
