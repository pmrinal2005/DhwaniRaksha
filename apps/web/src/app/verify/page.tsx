"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { BadgeCheck, Fingerprint, Lock, Mic, ShieldAlert, Siren, Square, Upload } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/shell/AppShell";
import { Panel, PanelContent } from "@/components/dashboard/primitives/Panel";
import { LiveBoundary } from "@/components/dashboard/primitives/LiveBoundary";
import { VoiceprintConstellation, CosineDial } from "@/components/hud/VoiceprintConstellation";
import { useRecorder } from "@/lib/use-recorder";
import { useVoiceprintStore } from "@/lib/voiceprint-store";
import { base64ToBlob, playBlob, NOISE_PRESETS, type NoisePreset } from "@/lib/audio";
import { cloakVoice, embedVoice, synthesize, useInsights, verifyVoice, type CloakResponse, type VerifyResponse } from "@/lib/live-api";
import { decodeEmbeddingB64 } from "@/lib/gnani/bfloat16";
import { shortHash } from "@/lib/format";
import { LOCALE_META, type Locale } from "@/lib/gnani/voices";

/** Voiceprint vault: enrol, verify against the enrolled set, and cloak for whistleblowers. */
export default function VerifyPage() {
  const recorder = useRecorder();
  const store = useVoiceprintStore();
  const insights = useInsights();
  const [handle, setHandle] = useState("Arena speaker");
  const [role, setRole] = useState("citizen");
  const [language, setLanguage] = useState<Locale>("hi-IN");
  const [noise, setNoise] = useState<NoisePreset>("none");
  const [busy, setBusy] = useState<string | null>(null);
  const [verify, setVerify] = useState<VerifyResponse | null>(null);
  const [cloak, setCloak] = useState<CloakResponse | null>(null);
  const enrolled = insights.data?.voiceprints ?? [];

  const record = async () => {
    if (recorder.recording) { await recorder.stop(); return; }
    await recorder.start(noise, 6_000);
  };

  const enrol = async (persist: boolean) => {
    setBusy("enrol");
    try {
      const result = await embedVoice(recorder.result?.cleanWav ?? null, { handle, role, language, persist });
      store.setEmbedding({ vector: result.embedding_f32, digest: result.digest, handle: result.handle, source: result.meta.mode === "live" ? "gnani" : "mock" });
      const verification = await verifyVoice({ live_embedding: result.speaker_embedding.embedding });
      setVerify(verification);
      store.setVerification({ cosine: verification.best_match?.cosine ?? 0, band: verification.band, compareVector: result.embedding_f32, compareHandle: verification.best_match?.handle ?? null });
      toast.success(persist ? "Voiceprint enrolled" : "Voiceprint extracted", { description: `${result.sample_seconds}s sample · ${verification.band.replace("_", " ")} · stored ${result.store_mode ?? "session"}` });
      if (persist) void insights.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Enrolment failed");
    } finally {
      setBusy(null);
    }
  };

  const runVerify = async () => {
    setBusy("verify");
    try {
      const result = await verifyVoice({ handle });
      setVerify(result);
      if (result.best_match) {
        const vector = decodeEmbeddingB64(store.vector ? "" : "") as unknown as number[];
        void vector;
      }
      toast.success("Verification complete", { description: `Best match ${result.best_match?.handle ?? "none"} · ${result.band.replace("_", " ")}` });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Verification failed");
    } finally {
      setBusy(null);
    }
  };

  const runCloak = async () => {
    setBusy("cloak");
    try {
      const result = await cloakVoice({ handle, salt: "mudra-vani-cloak-v1" });
      setCloak(result);
      const cloaked = decodeEmbeddingB64(result.cloaked.embedding);
      store.setCloak({ vector: cloaked, angleDeg: result.geometry.angle_deg, relinkCosine: result.strongest_link });
      const tts = await synthesize({ text: "मेरी पहचान सुरक्षित है, मेरी बात सच है।", model: "vachana-vc-v1", language: "hi-IN", embedding: result.cloaked.embedding, workflow: "highway_112" });
      await playBlob(base64ToBlob(tts.audio.base64, tts.audio.mime), tts.audio.container, tts.audio.sample_rate);
      toast.success("Cloak verified", { description: `rotation ${result.geometry.angle_deg.toFixed(1)}° · strongest relink ${result.strongest_link.toFixed(3)}` });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Cloak failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <AppShell>
      <div className="dashboard-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /><Fingerprint size={11} /> Voiceprint vault · 768-dimensional escrow</div>
          <h1 className="page-title">Identity you can verify, never store in plain text</h1>
          <p className="page-subtitle">Enrol a six-second sample, confirm cosine similarity above the 0.86 escrow seal, then rotate the vector with a Householder reflection before anonymous testimony.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <span className="chip">{enrolled.length} enrolled</span>
          <span className="chip emerald">≥ 0.86 seal</span>
          <span className="chip amber">0.74–0.85 retry</span>
          <span className="chip rose">&lt; 0.74 reject</span>
        </div>
      </div>

      <div className="dashboard-grid">
        <Panel id="enrol" title="Capture & enrol" subtitle="5–30 s clean speech. Noise injection keeps the VAD honest." kicker="step 1" icon={<Mic size={13} />} sourcePath="POST /api/voice/embed" className="grid-span-4">
          <PanelContent>
            <label className="mini-label">handle</label>
            <input className="input mt-8" value={handle} onChange={(event) => setHandle(event.target.value)} placeholder="Ramesh Patil" />
            <div className="triple mt-12">
              <label style={{ display: "grid", gap: 4 }}>
                <span className="mini-label">role</span>
                <select className="input" value={role} onChange={(event) => setRole(event.target.value)}>
                  {["citizen", "farmer", "trader", "kirana", "asha"].map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span className="mini-label">language</span>
                <select className="input" value={language} onChange={(event) => setLanguage(event.target.value as Locale)}>
                  {(Object.keys(LOCALE_META) as Locale[]).map((item) => <option key={item} value={item}>{LOCALE_META[item].name}</option>)}
                </select>
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span className="mini-label">noise</span>
                <select className="input" value={noise} onChange={(event) => setNoise(event.target.value as NoisePreset)}>
                  {NOISE_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.id}</option>)}
                </select>
              </label>
            </div>
            <div className="action-row mt-12">
              <button className={`button ${recorder.recording ? "danger" : ""}`} onClick={record} disabled={recorder.busy}>
                {recorder.recording ? <><Square size={12} /> Stop</> : <><Mic size={12} /> Record 6 s</>}
              </button>
              <button className="button" onClick={() => { void enrol(false); }} disabled={busy !== null}><Upload size={12} /> Extract</button>
              <button className="button primary" onClick={() => { void enrol(true); }} disabled={busy !== null}><BadgeCheck size={12} /> Enrol</button>
            </div>
            {recorder.error && <div className="error-code mt-8">{recorder.error}</div>}
            {recorder.result && (
              <div className="kv mt-12">
                <dt>sample length</dt><dd>{recorder.result.durationMs} ms</dd>
                <dt>speech ratio</dt><dd>{(recorder.result.vadRatio * 100).toFixed(0)}%</dd>
                <dt>bytes blocked</dt><dd>{recorder.result.bytesSuppressed}</dd>
              </div>
            )}
          </PanelContent>
        </Panel>

        <Panel id="constellation" title="Live constellation" subtitle="Green cloud = nearest enrolled vector, violet = yours, orange = cloaked." kicker="step 2" icon={<Fingerprint size={13} />} sourcePath="POST /api/voice/verify" className="grid-span-4">
          <div className="constellation-wrap" style={{ minHeight: 232 }}>
            <VoiceprintConstellation vector={store.vector} comparison={store.compareVector} cloaked={store.cloakedVector} cosine={store.cosine} angleDeg={store.angleDeg} height={232} />
            <div className="voice-cosine">
              <div className="voice-cosine-value">{store.cosine === null ? "—" : store.cosine.toFixed(3)}</div>
              <div className="voice-cosine-label">{store.band?.replace("_", " ") ?? "cosine"}</div>
            </div>
          </div>
          <PanelContent>
            <div className="flex-center gap-10">
              <CosineDial cosine={store.cosine} size={72} />
              <div style={{ minWidth: 0 }}>
                <div className="kv">
                  <dt>digest</dt><dd>{store.digest ? shortHash(store.digest, 7) : "—"}</dd>
                  <dt>cloak rotation</dt><dd>{store.angleDeg ? `${store.angleDeg.toFixed(1)}°` : "—"}</dd>
                  <dt>relink</dt><dd>{store.relinkCosine !== null ? store.relinkCosine.toFixed(3) : "—"}</dd>
                </div>
              </div>
            </div>
            <div className="action-row mt-12">
              <button className="button" onClick={() => { void runVerify(); }} disabled={busy !== null}><ShieldAlert size={11} /> Verify handle</button>
              <button className="button primary" onClick={() => { void runCloak(); }} disabled={busy !== null}><Lock size={11} /> Cloak & speak</button>
            </div>
          </PanelContent>
        </Panel>

        <Panel id="enrolled" title="Enrolled identities" subtitle="Stored as base64 bfloat16 + float32 vector(768) in pgvector." kicker="vault" icon={<BadgeCheck size={13} />} sourcePath="GET /api/insights (voiceprints)" className="grid-span-4">
          <LiveBoundary id="enrolled" sourcePath="voiceprints" state={{ isLoading: insights.isLoading, isError: insights.isError, error: insights.error, isEmpty: Boolean(insights.data) && enrolled.length === 0, source: insights.data?.source, refetch: () => { void insights.refetch(); } }} emptyTitle="Vault empty" emptyBody="Enrol the first identity to populate the constellation." skeleton="rows">
            <PanelContent>
              <div style={{ display: "grid", gap: 2 }}>
                {enrolled.map((row) => (
                  <div className="participant" key={row.id}>
                    <span className="participant-avatar"><Fingerprint size={13} /></span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="participant-name">{row.handle}</div>
                      <div className="participant-meta">{row.role} · {row.language} · {shortHash(row.digest || row.id, 5)}</div>
                    </div>
                    <span className={`chip ${(row.last_cosine ?? 0) >= 0.86 ? "emerald" : (row.last_cosine ?? 0) >= 0.74 ? "amber" : ""}`}>{row.last_cosine?.toFixed(3) ?? "—"}</span>
                  </div>
                ))}
              </div>
              {verify && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-12">
                  <div className="mini-label">nearest neighbours for {verify.live_digest.slice(0, 12)}…</div>
                  <div style={{ display: "grid", gap: 5, marginTop: 8 }}>
                    {verify.comparisons.slice(0, 4).map((row) => (
                      <div className="lane" key={row.id} style={{ gridTemplateColumns: "88px minmax(0,1fr) 38px" }}>
                        <span className="lane-label truncate">{row.handle}</span>
                        <span className="lane-track"><span className="lane-chip" style={{ width: `${row.cosine * 100}%`, background: row.band === "verified" ? "var(--emerald)" : row.band === "noisy_warning" ? "var(--amber)" : "var(--rose)" }} /></span>
                        <span className="mono" style={{ fontSize: 8.5, textAlign: "right" }}>{row.cosine.toFixed(3)}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </PanelContent>
          </LiveBoundary>
        </Panel>

        {cloak && (
          <Panel id="cloak" title="Orthogonal privacy cloak" subtitle="H = I − 2uuᵀ applied in O(d); the norm is preserved, the identity is not." kicker="whistleblower" icon={<Siren size={13} />} sourcePath="POST /api/voice/cloak" className="grid-span-12">
            <PanelContent>
              <div className="triple">
                <div><div className="big-num">{cloak.geometry.angle_deg.toFixed(2)}°<small>householder rotation</small></div></div>
                <div><div className="big-num">{cloak.strongest_link.toFixed(3)}<small>strongest relink</small></div></div>
                <div><div className="big-num">{cloak.geometry.norm_preserved ? "yes" : "no"}<small>norm preserved</small></div></div>
              </div>
              <div className="hairline" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 12 }}>
                <div>
                  <div className="mini-label">original digest</div>
                  <div className="code-block" style={{ fontSize: 9, marginTop: 6 }}>{cloak.original.digest} · ‖v‖ {cloak.original.norm}</div>
                </div>
                <div>
                  <div className="mini-label">cloaked digest</div>
                  <div className="code-block" style={{ fontSize: 9, marginTop: 6 }}>{cloak.cloaked.digest} · ‖v‖ {cloak.cloaked.norm}</div>
                </div>
              </div>
              <div className="chip-row mt-12">
                {cloak.nearest_after_cloak.map((row) => <span key={row.handle} className="chip">{row.handle}: {row.cosine.toFixed(3)}</span>)}
                <span className="chip emerald">salt {cloak.normal_digest}</span>
              </div>
              <p style={{ fontSize: 10, color: "var(--text-3)", marginTop: 10, lineHeight: 1.6 }}>{cloak.note}</p>
            </PanelContent>
          </Panel>
        )}
      </div>
    </AppShell>
  );
}
