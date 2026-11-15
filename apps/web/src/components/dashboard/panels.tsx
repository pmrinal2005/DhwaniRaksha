"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  BatteryCharging, Boxes, Braces, CheckCircle2, ChevronRight, Cpu, Database, Fingerprint, GitBranch,
  HeartPulse, KeyRound, Layers, Lock, Receipt, ScanLine, ServerCog, ShieldCheck, Sparkles, Store, TrendingUp, Zap,
} from "lucide-react";
import { Panel, PanelContent } from "@/components/dashboard/primitives/Panel";
import { LiveBoundary, EmptyInline } from "@/components/dashboard/primitives/LiveBoundary";
import { NumberTween, Delta, StatusPill } from "@/components/dashboard/primitives/DataVisuals";
import { Sparkline, MiniBars } from "@/components/dashboard/primitives/Charts";
import { CosineDial, VoiceprintConstellation, VoiceprintGlyph } from "@/components/hud/VoiceprintConstellation";
import { HashChainStrip } from "@/components/hud/Receipt";
import { useRecorder } from "@/lib/use-recorder";
import { useVoiceprintStore } from "@/lib/voiceprint-store";
import { VoiceprintConstellationFallback } from "@/components/hud/fallbacks";
import {
  cloakVoice, embedVoice, verifyVoice, useCreditsLive, useInsights, useLedgerLive, useSynthesize, useTriageLive,
  type CreditResponse, type InsightsResponse, type LedgerResponse, type TriageResponse,
} from "@/lib/live-api";
import { WORKFLOWS, type WorkflowDomain } from "@/lib/server/catalog";
import { LOCALE_META, defaultVoiceFor } from "@/lib/gnani/voices";
import { formatNumber, formatTime, shortHash } from "@/lib/format";
import { useUiStore } from "@/lib/ui-store";
import { toast } from "sonner";
import { playBlob, base64ToBlob } from "@/lib/audio";

/* ------------------------------------------------------------------ helpers */

function boundary<T>(query: { isLoading: boolean; isError: boolean; error: Error | null; data?: T | undefined; refetch: () => void }, isEmpty: (data: T) => boolean) {
  return {
    isLoading: query.isLoading, isError: query.isError, error: query.error,
    isEmpty: Boolean(query.data) && isEmpty(query.data as T),
    source: query.data ? (query.data as { source?: string }).source : undefined,
    refetch: () => query.refetch(),
  };
}

/* ------------------------------------------------------------- workflow strip */

export function WorkflowStrip() {
  const activeWorkflow = useUiStore((state) => state.activeWorkflow);
  const setWorkflow = useUiStore((state) => state.setWorkflow);
  const insights = useInsights();
  const workflows = insights.data?.workflows ?? [];

  return (
    <div className="wf-switcher" role="tablist" aria-label="Bharat workflows">
      {(workflows.length ? workflows : Object.values(WORKFLOWS).map((meta) => ({ domain: meta.domain, label: meta.label, native: meta.native, utterances: 0, avg_latency_ms: null, minted_contracts: 0, fair_price_alerts: 0, sparkline: [] }))).map((workflow) => {
        const meta = WORKFLOWS[workflow.domain as WorkflowDomain];
        const active = activeWorkflow === workflow.domain;
        return (
          <motion.button
            key={workflow.domain}
            role="tab"
            aria-selected={active}
            className={`wf-card ${active ? "active" : ""}`}
            onClick={() => setWorkflow(workflow.domain as WorkflowDomain)}
            whileTap={{ scale: 0.992 }}
            layout
          >
            <div className="wf-kicker">{meta?.kicker ?? "workflow"}</div>
            <div className="wf-name">{workflow.label}<span className="wf-native">{workflow.native}</span></div>
            <div className="wf-stats">
              <div className="wf-stat"><b>{formatNumber(workflow.utterances)}</b><span>utterances</span></div>
              <div className="wf-stat"><b>{workflow.avg_latency_ms ? `${formatNumber(workflow.avg_latency_ms)}` : "—"}<small style={{ fontSize: 8, color: "var(--text-3)" }}>ms</small></b><span>avg latency</span></div>
              <div className="wf-stat"><b>{workflow.minted_contracts}</b><span>receipts</span></div>
            </div>
            <div style={{ marginTop: 9 }}>
              <Sparkline series={workflow.sparkline ?? []} height={22} color={active ? "var(--ember)" : "var(--violet)"} label={`${workflow.label} activity`} />
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------- stage strip */

const STAGE_ICONS: Record<string, React.ReactNode> = {
  vad: <ScanLine size={13} />, stt: <Layers size={13} />, rag: <Database size={13} />,
  judge: <Braces size={13} />, tts: <Sparkles size={13} />, ledger: <Receipt size={13} />,
};

export function StageStrip() {
  const insights = useInsights();
  const stages = insights.data?.stage_states;
  const credits = insights.data?.credits;
  const waterfall = insights.data?.latency_waterfall ?? [];
  const totalMedian = useMemo(() => {
    const medians = waterfall.map((row) => row.segments.reduce((sum, segment) => sum + segment.duration_ms, 0));
    return medians.length ? medians.sort((a, b) => a - b)[Math.floor(medians.length / 2)] : null;
  }, [waterfall]);

  return (
    <Panel
      id="stage"
      title="Pipeline stages"
      subtitle="VAD → Prisma → RAG context → judge → Timbre → ledger, with the live state of each hop."
      kicker="zero-credit instrumentation"
      icon={<GitBranch size={13} />}
      sourcePath="GET /api/insights · /api/credits"
      actions={totalMedian ? <span className="chip emerald">median {formatNumber(totalMedian)} ms</span> : <span className="chip">warming</span>}
    >
      <PanelContent>
        <div className="stage-rail">
          {["vad", "stt", "rag", "judge", "tts", "ledger"].map((key) => {
            const stage = stages?.[key] ?? { state: "idle", detail: "connecting" };
            const metric = key === "stt" ? (totalMedian ? { value: totalMedian * 0.32, unit: "ms" } : null)
              : key === "tts" ? (totalMedian ? { value: totalMedian * 0.41, unit: "ms" } : null)
              : key === "ledger" ? (credits ? { value: credits.burn_per_hour, unit: "cr/h" } : null)
              : key === "rag" ? { value: 200, unit: "terms" } : key === "judge" ? { value: insights.data?.modes.groq === "live" ? 70 : 8, unit: insights.data?.modes.groq === "live" ? "B" : "rules" } : null;
            return (
              <div className="stage-node" key={key} data-state={stage.state}>
                <div className="stage-head">
                  <span className="stage-icon">{STAGE_ICONS[key]}</span>
                  <span className="stage-name">{key === "vad" ? "edge vad" : key === "rag" ? "rag context" : key === "judge" ? "groq judge" : key === "ledger" ? "boli-patra" : key}</span>
                </div>
                <div className="stage-metric">{metric ? <>{formatNumber(metric.value)}<small>{metric.unit}</small></> : "—"}</div>
                <div className="stage-detail">{stage.detail}</div>
              </div>
            );
          })}
        </div>

        {waterfall.length > 0 && (
          <>
            <div className="hairline" />
            <div className="waterfall">
              {waterfall.map((row) => {
                const total = row.segments.reduce((sum, segment) => sum + segment.duration_ms, 0) || 1;
                return (
                  <div className="waterfall-row" key={row.domain}>
                    <span className="waterfall-label">{row.label}</span>
                    <div className="waterfall-track">
                      {row.segments.map((segment) => (
                        <span key={segment.key} className={`waterfall-seg ${segmentClass(segment.key)}`} style={{ width: `${(segment.duration_ms / total) * 100}%` }} title={`${segment.key}: ${formatNumber(segment.duration_ms)} ms`} />
                      ))}
                    </div>
                    <span className="waterfall-total">{formatNumber(total)} ms</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </PanelContent>
    </Panel>
  );
}

function segmentClass(key: string) {
  if (key.includes("vad") || key.includes("queue")) return "seg-vad";
  if (key.includes("stt")) return "seg-stt";
  if (key.includes("judge")) return "seg-judge";
  if (key.includes("tts")) return "seg-tts";
  return "seg-delivery";
}

/* ---------------------------------------------------------- credit firewall */

export function CreditFirewall() {
  const credits = useCreditsLive();
  const [tab, setTab] = useState<"burn" | "kinds">("burn");
  const data = credits.data;
  const spentRatio = data ? data.spent / Math.max(1, data.budget) : 0;

  return (
    <Panel
      id="credits"
      title="Credit firewall"
      subtitle="One serialised upstream lane, content-addressed audio cache, hard-stop floor."
      kicker="budget"
      icon={<BatteryCharging size={13} />}
      sourcePath="GET /api/credits"
      actions={<StatusPill status={(data?.burn_per_hour ?? 0) > 40 ? "negative" : "positive"}>{data ? `${data.burn_per_hour.toFixed(1)} cr/h` : "—"}</StatusPill>}
      className="grid-span-4"
    >
      <LiveBoundary id="credits" sourcePath="GET /api/credits" state={boundary<CreditResponse>(credits, () => false)} emptyTitle="No credit snapshot" emptyBody="The credit ledger has not reported yet." skeleton="chart">
        {data && (
          <PanelContent>
            <div className="meter-caption">
              <strong><NumberTween value={data.remaining} formatter={(value) => formatNumber(Math.round(value))} /><span style={{ fontSize: 10, color: "var(--text-3)", marginLeft: 5 }}>credits left</span></strong>
              <span className="chip">{data.calls} calls logged</span>
            </div>
            <div className="meter"><span style={{ width: `${Math.min(100, Math.max(2, (1 - spentRatio) * 100))}%` }} /></div>
            <div className="meter-ticks"><span>0</span><span>hard stop {data.hard_stop}</span><span>{formatNumber(data.budget)}</span></div>

            <div className="triple mt-12">
              <div><div className="big-num">{formatNumber(data.spent)}<small>spent</small></div></div>
              <div><div className="big-num">{data.saved_by_cache}<small>saved by cache</small></div></div>
              <div><div className="big-num">{data.cache_hit_ratio === null ? "—" : `${(data.cache_hit_ratio * 100).toFixed(0)}%`}<small>cache hit</small></div></div>
            </div>

            <div className="hairline" />
            <div className="flex-center gap-6" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <div className="segmented">
                <button className={tab === "burn" ? "active" : ""} onClick={() => setTab("burn")}>24 h burn</button>
                <button className={tab === "kinds" ? "active" : ""} onClick={() => setTab("kinds")}>by call type</button>
              </div>
              {data.projected_exhaustion_ts && <span className="chip amber">runs dry {formatTime(data.projected_exhaustion_ts)}</span>}
            </div>
            {tab === "burn" ? <Sparkline series={data.burn_series} height={44} label="Credits burned per hour" /> : (
              <div style={{ display: "grid", gap: 6 }}>
                {data.spend_breakdown.length === 0 && <EmptyInline>No upstream calls recorded yet.</EmptyInline>}
                {data.spend_breakdown.map((row) => {
                  const max = Math.max(...data.spend_breakdown.map((item) => item.credits), 0.001);
                  return (
                    <div className="lane" key={row.kind} style={{ gridTemplateColumns: "84px minmax(0,1fr) 44px" }}>
                      <span className="lane-label">{row.kind.replace("_", " ")}</span>
                      <span className="lane-track"><span className="lane-chip" style={{ width: `${(row.credits / max) * 100}%` }} /></span>
                      <span className="mono" style={{ fontSize: 8, textAlign: "right" }}>{row.credits.toFixed(1)}</span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="hairline" />
            <div className="health-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
              <MiniMetric icon={<ShieldCheck size={11} />} label="429 avoided" value={String(data.mode.mutex.total429Avoided)} />
              <MiniMetric icon={<Zap size={11} />} label="429 received" value={String(data.mode.mutex.total429Received)} tone={data.mode.mutex.total429Received > 0 ? "rose" : undefined} />
              <MiniMetric icon={<ServerCog size={11} />} label="serialised calls" value={String(data.mode.mutex.totalCalls)} />
              <MiniMetric icon={<Lock size={11} />} label="queue depth" value={String(data.mode.mutex.waiting)} />
            </div>
          </PanelContent>
        )}
      </LiveBoundary>
    </Panel>
  );
}

function MiniMetric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
      <span className={`chip ${tone ?? ""}`} style={{ padding: 0, width: 22, height: 22, justifyContent: "center", flexShrink: 0 }}>{icon}</span>
      <span style={{ minWidth: 0 }}>
        <span className="mini-label" style={{ display: "block" }}>{label}</span>
        <span className="mono" style={{ fontSize: 11, display: "block", marginTop: 1 }}>{value}</span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------- voiceprint hero */

const Constellation = dynamic(() => Promise.resolve(VoiceprintConstellation), { ssr: false, loading: () => <VoiceprintConstellationFallback /> });

export function VoiceprintHero() {
  const recorder = useRecorder();
  const synthesize = useSynthesize();
  const store = useVoiceprintStore();
  const [busy, setBusy] = useState<string | null>(null);

  const enrol = async () => {
    setBusy("embed");
    try {
      const result = await embedVoice(recorder.result?.cleanWav ?? null, { handle: "Arena speaker", role: "citizen", language: "hi-IN" });
      const vector = result.embedding_f32;
      store.setEmbedding({ vector, digest: result.digest, handle: result.handle, source: result.meta.mode === "live" ? "gnani" : "mock" });
      const verification = await verifyVoice({ live_embedding: result.speaker_embedding.embedding });
      store.setVerification({ cosine: verification.best_match?.cosine ?? 0, band: verification.band, compareVector: vector, compareHandle: verification.best_match?.handle ?? null });
      toast.success("Voiceprint extracted", { description: `768-d bfloat16 · ‖v‖ ${result.l2_norm.toFixed(3)} · ${verification.band.replace("_", " ")}` });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Embedding failed");
    } finally {
      setBusy(null);
    }
  };

  const cloak = async () => {
    if (!store.vector) { toast.error("Enrol a voiceprint first."); return; }
    setBusy("cloak");
    try {
      const result = await cloakVoice({ handle: store.handle ?? "Arena speaker" });
      store.setCloak({ vector: [], angleDeg: result.geometry.angle_deg, relinkCosine: result.strongest_link });
      const tts = await synthesize.mutateAsync({ text: "मेरी पहचान छिपी है, पर मेरी आवाज़ सच बोलेगी।", model: "vachana-vc-v1", language: "hi-IN", embedding: result.cloaked.embedding, workflow: "highway_112" });
      await playBlob(base64ToBlob(tts.audio.base64, tts.audio.mime), tts.audio.container, tts.audio.sample_rate);
      toast.success("Cloaked voice synthesised", { description: `Rotation ${result.geometry.angle_deg.toFixed(1)}° · strongest relink ${result.strongest_link.toFixed(3)}` });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Cloak failed");
    } finally {
      setBusy(null);
    }
  };

  const record = async () => {
    if (recorder.recording) { await recorder.stop(); return; }
    await recorder.start("rickshaw_horn", 5_000);
  };

  return (
    <Panel
      id="voiceprint"
      title="Voiceprint identity"
      subtitle="The exact [1, 768] torch.bfloat16 tensor Gnani returns, projected live."
      kicker="biometric escrow"
      icon={<Fingerprint size={13} />}
      sourcePath="POST /api/voice/embed"
      hero
      className="grid-span-4"
      actions={<span className="chip violet">{store.source === "gnani" ? "gnani tensor" : store.vector ? "simulated tensor" : "awaiting enrol"}</span>}
    >
      <div className="constellation-wrap" style={{ minHeight: 208 }}>
        <Constellation vector={store.vector} comparison={store.compareVector} cloaked={store.cloakedVector} cosine={store.cosine} angleDeg={store.angleDeg} height={208} />
        <div className="voice-cosine">
          <div className="voice-cosine-value">{store.cosine === null || store.cosine === undefined ? "—" : store.cosine.toFixed(3)}</div>
          <div className="voice-cosine-label">{store.band ? store.band.replace("_", " ") : "cosine similarity"}</div>
        </div>
        <button className={`power-button ${recorder.recording || store.vector ? "armed" : ""}`} onClick={record} aria-label={recorder.recording ? "Stop recording" : "Record a voice sample"} title={recorder.recording ? "Stop" : "Record 5 s"}>
          <Fingerprint size={18} />
        </button>
      </div>
      <PanelContent>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <CosineDial cosine={store.cosine} size={64} />
          <div style={{ minWidth: 0 }}>
            <div className="mini-label">thresholds</div>
            <div style={{ display: "flex", gap: 5, marginTop: 5, flexWrap: "wrap" }}>
              <span className="chip emerald">≥ 0.86 seal</span>
              <span className="chip amber">0.74–0.85 retry</span>
              <span className="chip rose">&lt; 0.74 reject</span>
            </div>
            <div style={{ fontSize: 8.5, color: "var(--text-3)", marginTop: 6 }}>Enrolled vector {store.compareHandle ?? "—"} · digest {store.digest ? shortHash(store.digest, 6) : "—"}</div>
          </div>
        </div>
        <div className="action-row">
          <button className="button primary" onClick={enrol} disabled={busy !== null}>
            <Fingerprint size={11} /> {busy === "embed" ? "Extracting…" : "Enrol & verify"}
          </button>
          <button className="button" onClick={cloak} disabled={busy !== null || !store.vector}>
            <Lock size={11} /> Cloak + speak
          </button>
        </div>
        {store.angleDeg !== null && (
          <div style={{ marginTop: 9, fontSize: 9, color: "var(--text-3)", lineHeight: 1.55 }}>
            Householder rotation <span className="ember mono">{store.angleDeg.toFixed(1)}°</span> · strongest relink after cloak <span className="mono">{store.relinkCosine?.toFixed(3)}</span> — norm preserved, identity rotated.
          </div>
        )}
      </PanelContent>
    </Panel>
  );
}

/* --------------------------------------------------------------- ledger panel */

export function LedgerPanel({ domain }: { domain: WorkflowDomain }) {
  const ledger = useLedgerLive();
  const meta = WORKFLOWS[domain];
  const rows = (ledger.data?.entries ?? []).filter((entry) => entry.workflowDomain === domain).slice(0, 4);

  return (
    <Panel
      id="ledger"
      title="Boli-Patra ledger"
      subtitle="Hash-chained, dual-signed oral contracts for this workflow."
      kicker={`${meta.label} · receipts`}
      icon={<Receipt size={13} />}
      sourcePath="GET /api/ledger"
      className="grid-span-8"
      actions={<Link className="text-button" href="/ledger">Open ledger <ChevronRight size={11} /></Link>}
    >
      <LiveBoundary id="ledger" sourcePath="GET /api/ledger" state={boundary<LedgerResponse>(ledger, (value) => value.entries.length === 0)} emptyTitle="No Boli-Patra yet" emptyBody="Run the session console and mint the first dual-signed receipt." skeleton="rows">
        <PanelContent>
          <div style={{ display: "grid", gap: 10 }}>
            {rows.map((entry) => (
              <motion.div key={entry.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <Link href={`/receipt/${entry.id}`} className="asset-card" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 10, alignItems: "center" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                      <span className={`chip ${entry.workflowDomain === "mandi" ? "ember" : entry.workflowDomain === "kirana" ? "violet" : entry.workflowDomain === "asha" ? "emerald" : "amber"}`}>{entry.workflow_label}</span>
                      <span className="mono" style={{ fontSize: 8, color: "var(--text-3)" }}>{formatTime(entry.createdAt)}</span>
                      {entry.chainValid ? <CheckCircle2 size={11} className="emerald" /> : <Lock size={11} className="rose" />}
                    </div>
                    <div className="truncate" style={{ fontSize: 11, color: "var(--text-1)" }}>{entry.sourceTranscript}</div>
                    <div style={{ display: "flex", gap: 10, marginTop: 6, fontSize: 8.5, color: "var(--text-3)" }}>
                      <span>{entry.partyAName} · cos {entry.partyACosine?.toFixed(2) ?? "—"}</span>
                      <span>↔</span>
                      <span>{entry.partyBName} · cos {entry.partyBCosine?.toFixed(2) ?? "—"}</span>
                    </div>
                    <div className="hash-flow" style={{ marginTop: 7, fontSize: 8 }}>
                      <span className="chip">{shortHash(entry.prevLedgerHash ?? "genesis", 5)}</span>
                      <ChevronRight size={9} />
                      <span className="chip emerald">{shortHash(entry.sha256AuditHash, 6)}</span>
                    </div>
                  </div>
                  <TotalChip contract={entry.structuredContract} />
                </Link>
              </motion.div>
            ))}
          </div>
        </PanelContent>
      </LiveBoundary>
    </Panel>
  );
}

function TotalChip({ contract }: { contract: Record<string, unknown> }) {
  const total = typeof contract.total_inr === "number" ? contract.total_inr : null;
  const triage = typeof contract.clinical_triage_level === "string" ? contract.clinical_triage_level : null;
  const incident = typeof contract.incident === "string" ? contract.incident : null;
  return (
    <div style={{ textAlign: "right", flexShrink: 0 }}>
      {total !== null ? (
        <>
          <div className="big-num" style={{ fontSize: 15 }}>₹{formatNumber(total)}</div>
          <div className="mini-label">contract value</div>
        </>
      ) : triage ? (
        <>
          <div className={`chip ${triage === "emergency" ? "rose" : triage === "urgent" ? "amber" : "emerald"}`}>{triage}</div>
          <div className="mini-label" style={{ marginTop: 5 }}>triage</div>
        </>
      ) : incident ? (
        <>
          <div className="chip amber">{incident.replace("_", " ")}</div>
          <div className="mini-label" style={{ marginTop: 5 }}>incident</div>
        </>
      ) : (
        <div className="chip">signed</div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- RAG panel */

export function RagContextPanel({ domain }: { domain: WorkflowDomain }) {
  const insights = useInsights();
  const meta = WORKFLOWS[domain];
  const cluster = insights.data?.rag.clusters.find((row) => row.domain === domain);
  return (
    <Panel
      id="rag"
      title="Prisma context injection"
      subtitle="Keyterms, topic and speaker names fetched per workflow before decoding."
      kicker="RAG-steered STT"
      icon={<Database size={13} />}
      sourcePath="GET /api/insights (rag)"
      className="grid-span-4"
      actions={<span className="chip">{cluster?.keyterms_total ?? 0} terms</span>}
    >
      <PanelContent>
        <div className="mini-label">topic ({cluster?.topic_chars ?? meta.topic.length} / 1600 chars)</div>
        <div className="boundary-copy" style={{ maxWidth: "none", marginTop: 5, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{meta.topic}</div>
        <div className="context-bar" style={{ marginTop: 7 }}><span style={{ width: `${Math.min(100, ((cluster?.topic_chars ?? meta.topic.length) / 1600) * 100)}%` }} /></div>

        <div className="mini-label mt-12">keyterm cluster</div>
        <div className="chip-row mt-8">
          {(cluster?.keyterms ?? meta.clusters[0].keyterms).slice(0, 14).map((term) => <span className="chip" key={term}>{term}</span>)}
        </div>
        <div className="hairline" />
        <div className="kv">
          <dt>speaker_names</dt><dd>{(cluster?.speaker_names ?? []).join(" · ") || meta.parties.a.name}</dd>
          <dt>previous_text</dt><dd>600 chars rolling</dd>
          <dt>assembly</dt><dd>&lt; 12 ms (cached)</dd>
          <dt>model</dt><dd>prisma-v3.0</dd>
        </div>
      </PanelContent>
    </Panel>
  );
}

/* -------------------------------------------------------------- triage panel */

export function TriagePanel() {
  const triage = useTriageLive();
  const rows = (triage.data?.logs ?? []).slice(0, 4);
  return (
    <Panel
      id="triage"
      title="ASHA-Kavach triage"
      subtitle="Deterministic vital rules → expressive, tagged guidance."
      kicker="rural health"
      icon={<HeartPulse size={13} />}
      sourcePath="GET /api/triage"
      className="grid-span-4"
      actions={<span className="chip emerald">{rows.filter((row) => row.clinicalTriageLevel === "routine").length} routine</span>}
    >
      <LiveBoundary id="triage" sourcePath="GET /api/triage" state={boundary<TriageResponse>(triage, (value) => value.logs.length === 0)} emptyTitle="No triage records" emptyBody="Dictate symptoms in the ASHA workflow or POST /api/triage." skeleton="rows">
        <PanelContent>
          <div style={{ display: "grid", gap: 9 }}>
            {rows.map((row) => (
              <div key={row.id} className="asset-card" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="truncate" style={{ fontSize: 10.5 }}>{row.symptoms || "symptoms captured"}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                    {row.ttsTags.map((tag) => <span key={tag} className="chip violet">{tag}</span>)}
                    <span className="chip">{row.language}</span>
                    <span className="mono" style={{ fontSize: 8, color: "var(--text-3)" }}>{formatTime(row.createdAt)}</span>
                  </div>
                </div>
                <span className={`chip ${row.clinicalTriageLevel === "emergency" ? "rose" : row.clinicalTriageLevel === "urgent" ? "amber" : row.clinicalTriageLevel === "watch" ? "violet" : "emerald"}`}>{row.clinicalTriageLevel}</span>
              </div>
            ))}
          </div>
        </PanelContent>
      </LiveBoundary>
    </Panel>
  );
}

/* ------------------------------------------------------------ participants */

export function ParticipantsPanel() {
  const insights = useInsights();
  const voiceprints = insights.data?.voiceprints ?? [];
  return (
    <Panel
      id="people"
      title="Voiceprint vault"
      subtitle="Enrolled identities available for escrow verification."
      kicker="identity"
      icon={<KeyRound size={13} />}
      sourcePath="GET /api/insights (voiceprints)"
      className="grid-span-4"
      actions={<Link className="text-button" href="/verify">Manage <ChevronRight size={11} /></Link>}
    >
      <PanelContent>
        {voiceprints.length === 0 ? <EmptyInline>No voiceprints enrolled — POST /api/voice/embed with persist=true.</EmptyInline> : (
          <div style={{ display: "grid", gap: 2 }}>
            {voiceprints.slice(0, 5).map((row) => (
              <div className="participant" key={row.id}>
                <span className="participant-avatar"><Fingerprint size={13} /></span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="participant-name">{row.handle}</div>
                  <div className="participant-meta">{row.role} · {row.language} · {shortHash(row.digest || row.id, 5)}</div>
                </div>
                <span className={`chip ${(row.last_cosine ?? 0) >= 0.86 ? "emerald" : (row.last_cosine ?? 0) >= 0.74 ? "amber" : ""}`}>
                  {row.last_cosine === null ? "unverified" : row.last_cosine.toFixed(3)}
                </span>
              </div>
            ))}
          </div>
        )}
      </PanelContent>
    </Panel>
  );
}

/* --------------------------------------------------------------- cache panel */

export function CachePanel() {
  const insights = useInsights();
  const rows = insights.data?.cache_rows ?? [];
  return (
    <Panel
      id="cache"
      title="Audio cache"
      subtitle="sha256(text · model · voice · language) → zero-credit replays."
      kicker="content addressable"
      icon={<Boxes size={13} />}
      sourcePath="GET /api/insights (cache)"
      className="grid-span-4"
      actions={<span className="chip">{rows.reduce((sum, row) => sum + row.creditsSaved, 0)} cr saved</span>}
    >
      <PanelContent>
        {rows.length === 0 ? <EmptyInline>Cache is empty. Golden demos will populate it.</EmptyInline> : (
          <div style={{ display: "grid", gap: 7 }}>
            {rows.slice(0, 5).map((row) => (
              <div key={row.textSha256} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8, alignItems: "center" }}>
                <div style={{ minWidth: 0 }}>
                  <div className="truncate" style={{ fontSize: 10 }}>{row.normalizedText || "cached synthesis"}</div>
                  <div className="mono truncate" style={{ fontSize: 7.5, color: "var(--text-3)", marginTop: 3 }}>{row.textSha256.slice(0, 26)}…</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="chip violet">{row.model.replace("timbre-", "").replace("vachana-", "")}</div>
                  <div className="mini-label" style={{ marginTop: 4 }}>{row.language}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </PanelContent>
    </Panel>
  );
}

/* ------------------------------------------------------------ mint activity */

export function MintActivity() {
  const ledger = useLedgerLive();
  const entries = ledger.data?.entries ?? [];
  const chart = useMemo(() => {
    const buckets = Array.from({ length: 8 }, () => ({ signed: 0, rejected: 0, total: 0 }));
    for (const entry of entries) {
      const age = Date.now() - new Date(entry.createdAt).getTime();
      const bucket = Math.min(7, Math.floor(age / (24 * 3_600_000 / 8)));
      const target = buckets[7 - bucket];
      if (entry.status === "rejected") target.rejected += 1; else target.signed += 1;
      target.total += 1;
    }
    return buckets;
  }, [entries]);
  return (
    <Panel
      id="mint"
      title="Receipt velocity"
      subtitle="Signed vs rejected receipts across the last 24 h."
      kicker="ledger health"
      icon={<TrendingUp size={13} />}
      sourcePath="GET /api/ledger"
      className="grid-span-4"
      actions={<StatusPill status={ledger.data?.chain.valid ? "positive" : "negative"}>{ledger.data?.chain.valid ? "chain valid" : "chain broken"}</StatusPill>}
    >
      <PanelContent>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 96 }}>
          {chart.map((bucket, index) => {
            const max = Math.max(...chart.map((item) => item.total), 1);
            return (
              <div key={index} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 2, height: "100%" }}>
                <div style={{ height: `${(bucket.signed / max) * 78}%`, background: "linear-gradient(180deg, var(--emerald), color-mix(in srgb, var(--emerald) 45%, transparent))", borderRadius: 3, minHeight: bucket.signed ? 3 : 0 }} title={`${bucket.signed} signed`} />
                <div style={{ height: `${(bucket.rejected / max) * 78}%`, background: "var(--rose)", opacity: .7, borderRadius: 3, minHeight: bucket.rejected ? 2 : 0 }} title={`${bucket.rejected} rejected`} />
              </div>
            );
          })}
        </div>
        <div className="hairline" />
        <div className="triple">
          <div><div className="big-num">{entries.length}<small>total receipts</small></div></div>
          <div><div className="big-num">{entries.filter((entry) => entry.workflowDomain === "mandi").length}<small>mandi deals</small></div></div>
          <div><div className="big-num">{shortHash(ledger.data?.chain.head ?? "genesis", 4)}<small>chain head</small></div></div>
        </div>
        <div className="mt-12">
          <HashChainStrip hashes={entries.slice(0, 7).map((entry) => ({ label: entry.id, value: entry.sha256AuditHash, ok: entry.chainValid !== false }))} valid={ledger.data?.chain.valid ?? true} />
        </div>
      </PanelContent>
    </Panel>
  );
}

/* --------------------------------------------------------- mulaw PSTN panel */

export function MulawPanel() {
  const synthesize = useSynthesize();
  const [text, setText] = useState("Tyre burst at NH-48 near Manesar toll. Ambulance dispatched. Stay on the line.");
  const play = async () => {
    try {
      const result = await synthesize.mutateAsync({ text, model: "timbre-v3.0", voice: "Avinash", language: "en-IN", container: "mulaw", workflow: "highway_112" });
      await playBlob(base64ToBlob(result.audio.base64, "audio/basic"), "mulaw", 8000);
      toast.success("8 kHz µ-law playback", { description: `${result.audio.bytes} bytes · ${result.meta.latencyMs} ms · G.711 PSTN` });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Synthesis failed");
    }
  };
  return (
    <Panel
      id="pstn"
      title="PSTN dispatch"
      subtitle="Timbre → container=mulaw → 8 kHz G.711 for feature phones and 112 lines."
      kicker="telephony"
      icon={<Cpu size={13} />}
      sourcePath="POST /api/tts (container=mulaw)"
      className="grid-span-4"
      actions={<span className="chip emerald">audio/basic</span>}
    >
      <PanelContent>
        <textarea className="input" value={text} onChange={(event) => setText(event.target.value)} rows={3} style={{ resize: "vertical", lineHeight: 1.6 }} aria-label="PSTN announcement text" />
        <div className="action-row mt-8">
          <button className="button primary" onClick={play} disabled={synthesize.isPending}><Zap size={11} /> {synthesize.isPending ? "Encoding…" : "Synthesize µ-law"}</button>
        </div>
        <div className="hairline" />
        <div className="kv">
          <dt>sample_rate</dt><dd>8000 Hz (forced)</dd>
          <dt>encoding</dt><dd>G.711 µ-law</dd>
          <dt>content-type</dt><dd>audio/basic</dd>
          <dt>container</dt><dd>mulaw</dd>
        </div>
        {synthesize.data && (
          <div className="chip-row mt-12">
            <span className="chip">{synthesize.data.audio.bytes} bytes</span>
            <span className="chip">{synthesize.data.meta.latencyMs} ms</span>
            <span className="chip violet">{synthesize.data.meta.mode}</span>
          </div>
        )}
      </PanelContent>
    </Panel>
  );
}

/* ------------------------------------------------------------ value summary */

export function ValueStrip() {
  const insights = useInsights();
  const insightsData: InsightsResponse | undefined = insights.data;
  const minted = insightsData?.workflows.reduce((sum, row) => sum + row.minted_contracts, 0) ?? 0;
  const alerts = insightsData?.workflows.reduce((sum, row) => sum + row.fair_price_alerts, 0) ?? 0;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 10 }}>
      {[
        { label: "receipts minted", value: minted, icon: <Receipt size={12} />, tone: "emerald" },
        { label: "fair-price alerts", value: alerts, icon: <TrendingUp size={12} />, tone: "amber" },
        { label: "voiceprints", value: insightsData?.voiceprints.length ?? 0, icon: <Fingerprint size={12} />, tone: "violet" },
        { label: "monitored clusters", value: insightsData?.rag.clusters.length ?? 0, icon: <Store size={12} />, tone: "ember" },
      ].map((item) => (
        <div key={item.label} className="asset-card" style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span className={`chip ${item.tone}`} style={{ width: 26, height: 26, padding: 0, justifyContent: "center" }}>{item.icon}</span>
          <div>
            <div className="asset-number">{item.value}</div>
            <div className="mini-label">{item.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

void Delta; void MiniBars; void VoiceprintGlyph; void LOCALE_META; void defaultVoiceFor;
