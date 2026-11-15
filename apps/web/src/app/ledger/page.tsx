"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "motion/react";
import { ArrowUpRight, CheckCircle2, ChevronRight, Link2, Receipt, ShieldAlert } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { Panel } from "@/components/dashboard/primitives/Panel";
import { LiveBoundary } from "@/components/dashboard/primitives/LiveBoundary";
import { useLedgerLive } from "@/lib/live-api";
import { WORKFLOWS, WORKFLOW_ORDER, type WorkflowDomain } from "@/lib/server/catalog";
import { formatDate, formatNumber, shortHash } from "@/lib/format";
import { useUiStore } from "@/lib/ui-store";

export default function LedgerPage() {
  const [filter, setFilter] = useState<WorkflowDomain | "all">("all");
  const ledger = useLedgerLive();
  const rightRailOpen = useUiStore((state) => state.rightRailOpen);
  const entries = ledger.data?.entries ?? [];
  const filtered = filter === "all" ? entries : entries.filter((entry) => entry.workflowDomain === filter);
  const chain = ledger.data?.chain;

  return (
    <AppShell hideRail={!rightRailOpen}>
      <div className="dashboard-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /><Receipt size={11} /> Boli-Patra ledger · बोली-पत्र</div>
          <h1 className="page-title">Oral contracts, hash-chained</h1>
          <p className="page-subtitle">Every receipt carries both parties&apos; voiceprint scores, the extracted contract, and a SHA-256 link to the previous entry.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <span className={`chip ${chain?.valid ? "emerald" : "rose"}`}>{chain?.valid ? <CheckCircle2 size={10} /> : <ShieldAlert size={10} />}{chain?.valid ? "chain verified" : "chain broken"}</span>
          <span className="chip">{entries.length} receipts</span>
          <span className="chip">head {shortHash(chain?.head ?? "genesis", 5)}</span>
          <span className="chip">{ledger.data?.store_mode ?? "sim"} store</span>
        </div>
      </div>

      <div className="flex-center gap-8" style={{ marginBottom: 14, flexWrap: "wrap" }}>
        <button className={`button ${filter === "all" ? "primary" : ""}`} onClick={() => setFilter("all")}>All workflows</button>
        {WORKFLOW_ORDER.map((domain) => (
          <button key={domain} className={`button ${filter === domain ? "primary" : ""}`} onClick={() => setFilter(domain)}>
            {WORKFLOWS[domain].label}
          </button>
        ))}
        <button className="text-button" style={{ marginLeft: "auto" }} onClick={() => { void ledger.refetch(); }}>Refresh <ChevronRight size={11} /></button>
      </div>

      <Panel id="ledger-table" title="Receipts" subtitle="Newest first. Chain validity is recomputed on every read." kicker="ledger" icon={<Link2 size={13} />} sourcePath="GET /api/ledger">
        <LiveBoundary id="ledger-table" sourcePath="GET /api/ledger" state={{ isLoading: ledger.isLoading, isError: ledger.isError, error: ledger.error, isEmpty: Boolean(ledger.data) && filtered.length === 0, source: ledger.data?.source, refetch: () => { void ledger.refetch(); } }} emptyTitle="No receipts for this filter" emptyBody="Mint one from the Command HUD session console." skeleton="rows">
          <div style={{ display: "grid", gap: 10, padding: 16 }}>
            {filtered.map((entry, index) => (
              <motion.div key={entry.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(0.3, index * 0.03) }}>
                <Link href={`/receipt/${entry.id}`} className="asset-card" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,0.9fr) auto", gap: 14, alignItems: "center" }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="flex-center gap-6" style={{ marginBottom: 5 }}>
                      <span className={`chip ${entry.workflowDomain === "mandi" ? "ember" : entry.workflowDomain === "kirana" ? "violet" : entry.workflowDomain === "asha" ? "emerald" : "amber"}`}>{entry.workflow_label}</span>
                      <span className="chip">{entry.status}</span>
                      {entry.chainValid ? <CheckCircle2 size={11} className="emerald" /> : <ShieldAlert size={11} className="rose" />}
                    </div>
                    <div className="truncate" style={{ fontSize: 11.5 }}>{entry.sourceTranscript}</div>
                    <div style={{ fontSize: 8.5, color: "var(--text-3)", marginTop: 5 }}>
                      {entry.partyAName} ({entry.partyALanguage}) ↔ {entry.partyBName} ({entry.partyBLanguage}) · {formatDate(entry.createdAt)}
                    </div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="mini-label">hash chain</div>
                    <div className="hash-flow" style={{ marginTop: 5, fontSize: 8 }}>
                      <span className="chip">{shortHash(entry.prevLedgerHash ?? "genesis", 4)}</span>
                      <ChevronRight size={9} />
                      <span className="chip emerald">{shortHash(entry.sha256AuditHash, 5)}</span>
                    </div>
                    <div className="chip-row mt-8">
                      <span className={`chip ${(entry.partyACosine ?? 0) >= 0.86 ? "emerald" : "amber"}`}>A cos {entry.partyACosine?.toFixed(3) ?? "—"}</span>
                      <span className={`chip ${(entry.partyBCosine ?? 0) >= 0.86 ? "emerald" : "amber"}`}>B cos {entry.partyBCosine?.toFixed(3) ?? "—"}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    {typeof entry.structuredContract.total_inr === "number" ? (
                      <>
                        <div className="big-num" style={{ fontSize: 17 }}>₹{formatNumber(entry.structuredContract.total_inr as number)}</div>
                        <div className="mini-label">contract value</div>
                      </>
                    ) : (
                      <div className="chip amber">{(entry.structuredContract.clinical_triage_level as string) ?? (entry.structuredContract.incident as string) ?? "signed"}</div>
                    )}
                    <div className="mt-8"><ArrowUpRight size={14} className="subtle" /></div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        </LiveBoundary>
      </Panel>
    </AppShell>
  );
}

void WORKFLOW_ORDER.length;
