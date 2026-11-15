"use client";

import { useEffect } from "react";
import { motion } from "motion/react";
import { Activity, ArrowUpRight, Waves } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { SessionPanel } from "@/components/dashboard/SessionPanel";
import {
  CachePanel, CreditFirewall, LedgerPanel, MintActivity, MulawPanel, ParticipantsPanel, RagContextPanel,
  StageStrip, TriagePanel, ValueStrip, VoiceprintHero, WorkflowStrip,
} from "@/components/dashboard/panels";
import { useInsights } from "@/lib/live-api";
import { useUiStore } from "@/lib/ui-store";
import { WORKFLOWS, type WorkflowDomain } from "@/lib/server/catalog";
import { formatDate, formatNumber } from "@/lib/format";
import { useTelemetryStore } from "@/lib/telemetry/store";

export default function CommandHud() {
  const activeWorkflow = useUiStore((state) => state.activeWorkflow);
  const setWorkflow = useUiStore((state) => state.setWorkflow);
  const rightRailOpen = useUiStore((state) => state.rightRailOpen);
  const connection = useTelemetryStore((state) => state.connection);
  const insights = useInsights();

  useEffect(() => { if (!activeWorkflow) setWorkflow("mandi"); }, [activeWorkflow, setWorkflow]);

  const domain = (activeWorkflow ?? "mandi") as WorkflowDomain;
  const meta = WORKFLOWS[domain];
  const data = insights.data;
  const workflowStat = data?.workflows.find((row) => row.domain === domain);
  const credits = data?.credits;

  return (
    <AppShell>
      <div className="dashboard-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /><Waves size={11} /> Command HUD · {meta.kicker}</div>
          <h1 className="page-title">{meta.label}</h1>
          <p className="page-subtitle">{meta.scenario}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <span className="chip emerald"><span className="health-led up" />telemetry {connection}</span>
          <span className="chip">{workflowStat ? `${formatNumber(workflowStat.utterances)} utterances` : "aggregating"}</span>
          <span className="chip">{workflowStat?.avg_cosine ? `avg cos ${workflowStat.avg_cosine.toFixed(3)}` : "cos —"}</span>
          <span className="chip amber">hard stop {credits?.hard_stop ?? 150} cr</span>
          <span className="chip">
            <Activity size={9} /> updated {data ? formatDate(data.generated_at) : "—"}
          </span>
          <a className="button ghost" href="https://docs.gnani.ai/api/introduction/introduction" target="_blank" rel="noreferrer" style={{ minHeight: 28 }}>
            Gnani protocol <ArrowUpRight size={11} />
          </a>
        </div>
      </div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <WorkflowStrip />
      </motion.div>

      <div style={{ marginTop: 14 }}>
        <StageStrip />
      </div>

      <div className="dashboard-grid" style={{ marginTop: 14 }}>
        <div className="grid-span-12">
          <SessionPanel domain={domain} />
        </div>

        <VoiceprintHero />
        <LedgerPanel domain={domain} />

        <CreditFirewall />
        <RagContextPanel domain={domain} />
        <TriagePanel />

        <ParticipantsPanel />
        <CachePanel />
        <MulawPanel />

        <div className="grid-span-12">
          <div className="dashboard-grid" style={{ gap: 14 }}>
            <MintActivity />
            <div className="grid-span-8">
              <ValueStrip />
              <div style={{ marginTop: 14 }}>
                <StageLegend domain={domain} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {!rightRailOpen && (
        <div style={{ marginTop: 16, fontSize: 10, color: "var(--text-3)" }}>
          Telemetry rail hidden — reopen it from the topbar to watch every request, retry and mint event.
        </div>
      )}
    </AppShell>
  );
}

function StageLegend({ domain }: { domain: WorkflowDomain }) {
  const meta = WORKFLOWS[domain];
  const insights = useInsights();
  const data = insights.data;
  const row = data?.latency_waterfall.find((item) => item.domain === domain);
  const total = row?.segments.reduce((sum, segment) => sum + segment.duration_ms, 0) ?? 0;
  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
        <div>
          <div className="panel-kicker">latency budget · {meta.label}</div>
          <div className="panel-title" style={{ marginTop: 4 }}>Where every millisecond of a {meta.label} turn goes</div>
        </div>
        <span className="chip emerald">{formatNumber(total)} ms median</span>
      </div>
      <div className="waterfall">
        {(row?.segments ?? []).map((segment) => (
          <div className="waterfall-row" key={segment.key}>
            <span className="waterfall-label">{segment.key}</span>
            <div className="waterfall-track">
              <span className={`waterfall-seg ${segment.key.includes("vad") ? "seg-vad" : segment.key.includes("stt") ? "seg-stt" : segment.key.includes("judge") ? "seg-judge" : segment.key.includes("tts") ? "seg-tts" : "seg-delivery"}`} style={{ width: `${total ? (segment.duration_ms / total) * 100 : 0}%` }} />
            </div>
            <span className="waterfall-total">{formatNumber(segment.duration_ms)} ms</span>
          </div>
        ))}
      </div>
      <div className="hairline" />
      <div className="chip-row">
        <span className="chip emerald">VAD-gated bytes only</span>
        <span className="chip">≤ 200 keyterms · 1600-char topic</span>
        <span className="chip">single-active mutex</span>
        <span className="chip">cache before credits</span>
        <span className="chip violet">{meta.parties.a.language} → {meta.parties.b.language}</span>
      </div>
    </div>
  );
}
