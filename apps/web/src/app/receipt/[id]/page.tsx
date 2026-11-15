"use client";

import Link from "next/link";
import { use } from "react";
import { ArrowLeft, CheckCircle2, Download, Link2, Printer, ShieldAlert, Share2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/shell/AppShell";
import { LiveBoundary } from "@/components/dashboard/primitives/LiveBoundary";
import { HashGlyph } from "@/components/hud/Receipt";
import { VoiceprintGlyph } from "@/components/hud/VoiceprintConstellation";
import { useLedgerEntryLive, type LedgerEntryResponse } from "@/lib/live-api";
import { seededUnitVector } from "@/lib/gnani/bfloat16";
import { formatDate, formatNumber, shortHash } from "@/lib/format";
import { normalizeIndicText } from "@/lib/gnani/normalizer";

/** Printable, shareable Boli-Patra receipt. Cmd/Ctrl+P gives the paper contract. */
export default function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const query = useLedgerEntryLive(id);
  const data = query.data;
  const entry = data?.entry;
  const chain = data?.chain;

  const share = async () => {
    const url = typeof window === "undefined" ? "" : window.location.href;
    const text = entry
      ? `Boli-Patra ${entry.workflow_label} · ${entry.partyAName} ↔ ${entry.partyBName} · ${typeof entry.structuredContract.total_inr === "number" ? `₹${formatNumber(entry.structuredContract.total_inr as number)}` : String(entry.structuredContract.clinical_triage_level ?? entry.structuredContract.incident ?? "signed")} · hash ${entry.sha256AuditHash.slice(0, 16)}…`
      : "Boli-Patra receipt";
    if (navigator.share) {
      try { await navigator.share({ title: "Boli-Patra receipt", text, url }); return; } catch { /* fall through */ }
    }
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast.success("Receipt summary copied — paste it into WhatsApp.");
  };

  const amountWords = entry && typeof entry.structuredContract.total_inr === "number"
    ? normalizeIndicText(`₹${entry.structuredContract.total_inr}`, "hi-IN").text
    : null;

  return (
    <AppShell>
      <div className="receipt-shell">
        <div className="no-print" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <Link href="/ledger" className="text-button"><ArrowLeft size={12} /> Back to ledger</Link>
          <div style={{ display: "flex", gap: 7 }}>
            <button className="button" onClick={() => window.print()}><Printer size={12} /> Print / PDF</button>
            <button className="button" onClick={share}><Share2 size={12} /> WhatsApp summary</button>
            <button className="button primary" onClick={async () => {
              try {
                const response = await fetch(`/api/ledger/${id}`);
                const body = await response.json();
                const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement("a");
                anchor.href = url; anchor.download = `boli-patra-${id}.json`; anchor.click();
                URL.revokeObjectURL(url);
              } catch { toast.error("Export failed"); }
            }}><Download size={12} /> Export JSON</button>
          </div>
        </div>

        <LiveBoundary id="receipt" sourcePath={`GET /api/ledger/${id}`} state={{ isLoading: query.isLoading, isError: query.isError, error: query.error, isEmpty: Boolean(data) && !entry, refetch: () => { void query.refetch(); } }} emptyTitle="Receipt not found" emptyBody="This receipt id does not exist in the ledger." skeleton="hero">
          {entry && chain && (
            <article className="receipt-card">
              <div className="receipt-watermark">BOLI-PATRA</div>
              <header className="receipt-band">
                <div>
                  <div className="eyebrow"><span className="eyebrow-line" /> Boli-Patra · बोली-पत्र</div>
                  <h1 style={{ font: "600 22px var(--font-space), sans-serif", letterSpacing: "-.04em", margin: "7px 0 4px" }}>{entry.workflow_label} <span style={{ fontSize: 13, color: "var(--text-3)" }}>{entry.workflow_native}</span></h1>
                  <div style={{ fontSize: 10, color: "var(--text-3)" }}>Receipt {shortHash(entry.id, 8)} · minted {formatDate(entry.createdAt)}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ textAlign: "right" }}>
                    <div className={`chip ${chain.hash_valid ? "emerald" : "rose"}`} style={{ marginLeft: "auto" }}>{chain.hash_valid ? <CheckCircle2 size={10} /> : <ShieldAlert size={10} />}{chain.hash_valid ? "hash verified" : "hash mismatch"}</div>
                    <div className="mini-label" style={{ marginTop: 6 }}>chain position {chain.position} / {chain.of}</div>
                  </div>
                  <HashGlyph value={entry.sha256AuditHash} size={92} />
                </div>
              </header>

              <div className="receipt-body">
                {typeof entry.structuredContract.total_inr === "number" && (
                  <div className="receipt-total">
                    <div>
                      <div className="mini-label">contract value</div>
                      <strong>₹{formatNumber(entry.structuredContract.total_inr as number)}</strong>
                      {amountWords && <div className="receipt-words" style={{ marginTop: 6 }}>{amountWords}</div>}
                    </div>
                    <div style={{ textAlign: "right", display: "grid", gap: 4 }}>
                      {entry.structuredContract.quantity_quintal !== undefined && <span className="chip">{String(entry.structuredContract.quantity_quintal)} quintal</span>}
                      {entry.structuredContract.rate_per_quintal !== undefined && <span className="chip">₹{formatNumber(entry.structuredContract.rate_per_quintal as number)} / quintal</span>}
                      {entry.structuredContract.credit_days !== undefined && <span className="chip amber">{String(entry.structuredContract.credit_days)} days credit</span>}
                    </div>
                  </div>
                )}

                <div className="sig-grid">
                  <div className="sig-card">
                    <div className="flex-center gap-6" style={{ justifyContent: "space-between" }}>
                      <div>
                        <div className="mini-label">party A · voiceprint signature</div>
                        <div style={{ fontSize: 12, marginTop: 3 }}>{entry.partyAName}</div>
                        <div style={{ fontSize: 9, color: "var(--text-3)" }}>{entry.partyALanguage}</div>
                      </div>
                      <span className={`chip ${(entry.partyACosine ?? 0) >= 0.86 ? "emerald" : "amber"}`}>cos {entry.partyACosine?.toFixed(3) ?? "—"}</span>
                    </div>
                    <VoiceprintGlyph vector={seededUnitVector(`${entry.partyAName}:mudra-vani-enrolment`)} />
                  </div>
                  <div className="sig-card">
                    <div className="flex-center gap-6" style={{ justifyContent: "space-between" }}>
                      <div>
                        <div className="mini-label">party B · voiceprint signature</div>
                        <div style={{ fontSize: 12, marginTop: 3 }}>{entry.partyBName}</div>
                        <div style={{ fontSize: 9, color: "var(--text-3)" }}>{entry.partyBLanguage}</div>
                      </div>
                      <span className={`chip ${(entry.partyBCosine ?? 0) >= 0.86 ? "emerald" : "amber"}`}>cos {entry.partyBCosine?.toFixed(3) ?? "—"}</span>
                    </div>
                    <VoiceprintGlyph vector={seededUnitVector(`${entry.partyBName}:mudra-vani-enrolment`)} color="var(--emerald)" />
                  </div>
                </div>

                <div>
                  <div className="mini-label">spoken source (Prisma transcript)</div>
                  <div className="code-block" style={{ marginTop: 6, fontSize: 11.5 }}>{entry.sourceTranscript}</div>
                  {entry.translatedTranscript && (
                    <>
                      <div className="mini-label mt-12">bridged meaning</div>
                      <div className="code-block" style={{ marginTop: 6, fontSize: 11 }}>{entry.translatedTranscript}</div>
                    </>
                  )}
                </div>

                <div className="receipt-grid">
                  <div className="sig-card">
                    <div className="mini-label">structured contract</div>
                    <pre className="code-block" style={{ fontSize: 9.5, margin: 0 }}>{JSON.stringify(entry.structuredContract, null, 2)}</pre>
                  </div>
                  <div className="sig-card">
                    <div className="mini-label">SHA-256 audit chain</div>
                    <div className="kv" style={{ marginTop: 6 }}>
                      <dt>previous</dt><dd className="truncate" title={entry.prevLedgerHash ?? "genesis"}>{shortHash(entry.prevLedgerHash ?? "genesis", 10)}</dd>
                      <dt>this receipt</dt><dd className="truncate" title={entry.sha256AuditHash}>{shortHash(entry.sha256AuditHash, 10)}</dd>
                      <dt>recomputed</dt><dd className="truncate" title={chain.recomputed_hash}>{shortHash(chain.recomputed_hash, 10)}</dd>
                      <dt>link</dt><dd>{chain.hash_valid ? "valid" : "mismatch"}</dd>
                    </div>
                    <div className="code-block" style={{ fontSize: 8, marginTop: 8, wordBreak: "break-all" }}>{entry.sha256AuditHash}</div>
                    {chain.previous_entry && (
                      <Link className="text-button" href={`/receipt/${chain.previous_entry.id}`} style={{ marginTop: 6 }}>
                        <Link2 size={10} /> previous receipt {shortHash(chain.previous_entry.sha256, 5)}
                      </Link>
                    )}
                  </div>
                </div>

                <div style={{ borderTop: "1px dashed var(--stroke)", paddingTop: 12, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", fontSize: 9, color: "var(--text-3)" }}>
                  <span>Verifiable in any browser: recompute sha256(prev_hash : partyA : partyB : canonical_json).</span>
                  <span>Dhwani-Raksha Ω · Gnani Prisma v3.0 · Timbre v3.0 · vachana-vc-v1</span>
                </div>
              </div>
            </article>
          )}
        </LiveBoundary>
      </div>
    </AppShell>
  );
}

void ({} as LedgerEntryResponse);
