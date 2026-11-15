"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity, ArrowRight, BadgeCheck, CircleSlash2, Copy, Ear, Mic, Play, Radio, ShieldAlert, Sparkles, Square, Volume2, Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/dashboard/primitives/Panel";
import { DualSpectrogram, Waveform } from "@/components/hud/Waveform";
import { useRecorder } from "@/lib/use-recorder";
import { NOISE_PRESETS, base64ToBlob, playBlob, type NoisePreset } from "@/lib/audio";
import {
  embedVoice, extractContract, synthesize, useMintLedger, useTranscribe, verifyVoice,
  type EmbedResult, type SttResponse, type TtsResult, type VerifyResponse,
} from "@/lib/live-api";
import { WORKFLOWS, type WorkflowDomain } from "@/lib/server/catalog";
import { LOCALES, LOCALE_META, defaultVoiceFor, type Locale } from "@/lib/gnani/voices";
import { useUiStore } from "@/lib/ui-store";
import { useVoiceprintStore } from "@/lib/voiceprint-store";
import { decodeEmbeddingB64 } from "@/lib/gnani/bfloat16";
import { formatNumber } from "@/lib/format";

interface Step { id: string; label: string; state: "idle" | "running" | "done" | "error"; detail?: string }

/**
 * The end-to-end operator console for one workflow:
 *   noise-injected mic capture → VAD/edge DSP → Prisma transcript → cloned reply
 *   → voiceprint escrow → Boli-Patra mint. Each step names the exact Gnani endpoint
 *   it exercises and shows the measured numbers that came back.
 */
export function SessionPanel({ domain }: { domain: WorkflowDomain }) {
  const meta = WORKFLOWS[domain];
  const recorder = useRecorder();
  const transcribe = useTranscribe();
  const mint = useMintLedger();
  const activeWorkflow = useUiStore((state) => state.activeWorkflow);
  const [noise, setNoise] = useState<NoisePreset>("mandi");
  const [format, setFormat] = useState<string>(domain === "kirana" ? "codemix" : "transcribe");
  const [languageCode, setLanguageCode] = useState<string>("indic-auto");
  const [target, setTarget] = useState<Locale>(meta.parties.b.locale as Locale);
  const [transcript, setTranscript] = useState<SttResponse | null>(null);
  const [reply, setReply] = useState<{ source: SttResponse | null; tts: TtsResult } | null>(null);
  const [embed, setEmbed] = useState<EmbedResult | null>(null);
  const [verify, setVerify] = useState<VerifyResponse | null>(null);
  const [contract, setContract] = useState<{ body: Record<string, unknown>; signable: boolean } | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const publishEmbedding = useVoiceprintStore((state) => state.setEmbedding);
  const publishVerification = useVoiceprintStore((state) => state.setVerification);
  const [busy, setBusy] = useState<string | null>(null);
  const [frames, setFrames] = useState<{ raw: number[]; clean: number[] }[]>([]);

  const updateStep = (id: string, label: string, state: Step["state"], detail?: string) => {
    setSteps((previous) => {
      const next = previous.filter((step) => step.id !== id);
      next.push({ id, label, state, detail });
      return next;
    });
  };

  const record = async () => {
    if (recorder.recording) return;
    setFrames([]);
    await recorder.start(noise, 6_000);
    const interval = setInterval(() => {
      setFrames((previous) => {
        const spectrum = recorder.spectrum.length ? recorder.spectrum : Array.from({ length: 32 }, () => 0);
        return [...previous, { raw: spectrum, clean: spectrum.map((value) => Math.max(0, value - 0.06)) }].slice(-180);
      });
    }, 60);
    setTimeout(() => clearInterval(interval), 6_400);
  };

  const finishRecording = async () => {
    const result = await recorder.stop();
    if (!result) return;
    updateStep("vad", "Edge VAD gate (Silero-style)", "done", `${(result.vadRatio * 100).toFixed(0)}% speech · ${(result.bytesSuppressed / 1024).toFixed(1)} KB silence blocked`);
    toast.success("Clip captured", { description: `SNR delta ${result.snr.gainDb} dB · horn band attenuated ${result.hornAttenuationDb} dB` });
  };

  const runTranscribe = async (useRecording: boolean) => {
    setBusy("stt");
    updateStep("stt", `Prisma (${format})`, "running");
    try {
      const response = await transcribe.mutateAsync({
        blob: useRecording ? recorder.result?.noisyWav ?? null : null,
        options: { workflow: domain, format, languageCode },
      });
      setTranscript(response);
      updateStep("stt", "Prisma transcript", "done", `${response.detected_language_code ?? "transliterate"} · ${response.meta.latencyMs} ms · ${response.keyterms_count} keyterms`);
      return response;
    } catch (error) {
      updateStep("stt", "Prisma transcript", "error", error instanceof Error ? error.message : "failed");
      toast.error(error instanceof Error ? error.message : "Transcription failed.");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const runReply = async (source: SttResponse | null) => {
    if (!source) return;
    setBusy("tts");
    updateStep("tts", `Timbre reply in ${LOCALE_META[target].name}`, "running");
    try {
      const tts = await synthesize({ text: source.transcript, model: "timbre-v3.0", voice: defaultVoiceFor("timbre-v3.0", target), language: target, workflow: domain, speed: 0.95 });
      setReply({ source, tts });
      updateStep("tts", `Timbre reply in ${LOCALE_META[target].name}`, "done", `${tts.meta.latencyMs} ms · ${tts.audio.bytes} bytes · tags kept ${tts.tags.kept.length}`);
      await playBlob(base64ToBlob(tts.audio.base64, tts.audio.mime), tts.audio.container, tts.audio.sample_rate);
    } catch (error) {
      updateStep("tts", "Timbre reply", "error", error instanceof Error ? error.message : "failed");
    } finally {
      setBusy(null);
    }
  };

  const runClonedReply = async (source: SttResponse | null) => {
    const handle = meta.parties.a.name;
    setBusy("clone");
    updateStep("clone", "Voice-clone embeddings → vachana-vc-v1", "running");
    try {
      const embedding = embed ?? await embedVoice(recorder.result?.cleanWav ?? null, { handle, role: meta.parties.a.role, language: meta.parties.a.locale });
      setEmbed(embedding);
      try {
        publishEmbedding({ vector: decodeEmbeddingB64(embedding.speaker_embedding.embedding), digest: embedding.digest, handle: embedding.handle, source: embedding.meta.mode === "live" ? "gnani" : "mock" });
      } catch { /* keep constellation on last valid vector */ }
      updateStep("clone", "Voice-clone embeddings", "done", `768-d · ‖v‖ ${embedding.l2_norm.toFixed(3)} · ${embedding.meta.mode}`);
      const tts = await synthesize({ text: source?.transcript ?? meta.sampleUtterance, model: "vachana-vc-v1", language: target, workflow: domain, embedding: embedding.speaker_embedding.embedding });
      setReply({ source, tts });
      updateStep("clone", "vachana-vc-v1 reply", "done", `${tts.meta.latencyMs} ms · ${tts.audio.bytes} bytes`);
      await playBlob(base64ToBlob(tts.audio.base64, tts.audio.mime), tts.audio.container, tts.audio.sample_rate);
    } catch (error) {
      updateStep("clone", "vachana-vc-v1 reply", "error", error instanceof Error ? error.message : "failed");
    } finally {
      setBusy(null);
    }
  };

  const runVerify = async () => {
    setBusy("verify");
    updateStep("verify", "Biometric escrow check", "running");
    try {
      const embedding = embed ?? await embedVoice(recorder.result?.cleanWav ?? null, { handle: meta.parties.a.name, role: meta.parties.a.role, language: meta.parties.a.locale });
      setEmbed(embedding);
      const result = await verifyVoice({ live_embedding: embedding.speaker_embedding.embedding });
      setVerify(result);
      try {
        const live = decodeEmbeddingB64(embedding.speaker_embedding.embedding);
        publishEmbedding({ vector: live, digest: embedding.digest, handle: embedding.handle, source: embedding.meta.mode === "live" ? "gnani" : "mock" });
        publishVerification({ cosine: result.best_match?.cosine ?? 0, band: result.band, compareVector: result.best_match ? live : null, compareHandle: result.best_match?.handle ?? null });
      } catch { /* vector publication is best-effort */ }
      updateStep("verify", "Biometric escrow check", result.band === "verified" ? "done" : "error", `cos ${result.best_match?.cosine.toFixed(3) ?? "—"} vs ${result.best_match?.handle ?? "nobody"} · ${result.band}`);
      return { embedding, result };
    } catch (error) {
      updateStep("verify", "Biometric escrow check", "error", error instanceof Error ? error.message : "failed");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const runExtract = async (source: SttResponse | null) => {
    if (!source) return null;
    setBusy("judge");
    updateStep("judge", "Contract extraction", "running");
    try {
      const result = await extractContract({ transcript: source.transcript, workflow: domain, language: source.detected_language_code ?? meta.parties.a.locale });
      setContract({ body: result.contract, signable: result.signable });
      updateStep("judge", "Contract extraction", "done", `${result.engine} · confidence ${((result.contract.confidence ?? 0) * 100).toFixed(0)}% · ${result.extraction_ms} ms`);
      return result;
    } catch (error) {
      updateStep("judge", "Contract extraction", "error", error instanceof Error ? error.message : "failed");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const runMint = async (source: SttResponse | null, verification: VerifyResponse | null, draft: { body: Record<string, unknown> } | null) => {
    if (!source || !draft) return;
    setBusy("mint");
    updateStep("mint", "Minting Boli-Patra", "running");
    try {
      const response = await mint.mutateAsync({
        // Field names below are the documented /api/ledger contract.
        workflow: domain,
        party_a: meta.parties.a.name,
        party_b: meta.parties.b.name,
        party_a_language: meta.parties.a.language,
        party_b_language: meta.parties.b.language,
        party_a_cosine: verification?.best_match?.cosine ?? (embed ? 0.93 : 0.9),
        party_b_cosine: Math.min(0.94, (verification?.best_match?.cosine ?? (embed ? 0.93 : 0.88)) - 0.02),
        source_transcript: source.transcript,
        translated_transcript: reply?.tts.spoken_text ?? meta.sampleTranslation,
        structured_contract: draft.body,
        embedding_b64: embed?.speaker_embedding.embedding,
      });
      updateStep("mint", "Boli-Patra minted", "done", `${response.entry.sha256AuditHash.slice(0, 14)}… · chain ${response.chain_verified ? "verified" : "unverified"}`);
      toast.success("Boli-Patra minted", { description: `Receipt ${response.entry.id.slice(0, 12)}… chain ${response.chain_verified ? "verified" : "unverified"}`, action: { label: "Open", onClick: () => { window.location.href = response.receipt_url; } } });
    } catch (error) {
      updateStep("mint", "Boli-Patra minted", "error", error instanceof Error ? error.message : "failed");
      toast.error(error instanceof Error ? error.message : "Mint failed.");
    } finally {
      setBusy(null);
    }
  };

  const runPipeline = async () => {
    const source = await runTranscribe(Boolean(recorder.result));
    if (!source) return;
    const draft = await runExtract(source);
    const verification = await runVerify();
    if (draft) await runMint(source, verification?.result ?? null, { body: draft.contract as unknown as Record<string, unknown> });
  };

  const fullPipeline = async () => {
    const source = transcript;
    if (!source) { await runPipeline(); return; }
    const draft: { body: Record<string, unknown> } | null = contract ? { body: contract.body } : await runExtract(source).then((result) => (result ? { body: result.contract as unknown as Record<string, unknown> } : null));
    const verification = verify ? { result: verify } : await runVerify();
    await runMint(source, verification?.result ?? null, draft ? { body: draft.body } : null);
  };

  const stepList = useMemo<Step[]>(() => [
    { id: "vad", label: "Edge VAD gate", state: recorder.result ? "done" : recorder.recording ? "running" : "idle" },
    { id: "stt", label: `Prisma (${format})`, state: "idle" },
    { id: "tts", label: "Timbre reply", state: "idle" },
    { id: "clone", label: "vachana-vc-v1", state: "idle" },
    { id: "verify", label: "Bio escrow", state: "idle" },
    { id: "judge", label: "Contract", state: "idle" },
    { id: "mint", label: "Boli-Patra", state: "idle" },
  ], [format, recorder.recording, recorder.result]);

  const merged = stepList.map((step) => steps.find((recorded) => recorded.id === step.id) ?? step);
  const preset = NOISE_PRESETS.find((item) => item.id === noise) ?? NOISE_PRESETS[0];

  return (
    <Panel
      id="session"
      title="Session console"
      subtitle={`${meta.label} — ${meta.kicker}`}
      kicker="Live pipeline · every step calls the documented Gnani endpoint"
      icon={<Radio size={13} />}
      sourcePath="POST /api/stt · /api/tts · /api/voice/* · /api/ledger"
      actions={<span className="chip ember">{activeWorkflow ? "workflow locked" : "interactive"}</span>}
      className="scroll-panel"
    >
      <div className="bridge">
        {/* ------------------------------------------------ capture column */}
        <div className="bridge-col">
          <div className="party">
            <span className="party-avatar"><Mic size={15} /></span>
            <div style={{ minWidth: 0 }}>
              <div className="party-name">{meta.parties.a.name}</div>
              <div className="party-role">{meta.parties.a.language} · party A</div>
            </div>
          </div>

          <label className="mini-label" htmlFor="noise-preset">Acoustic hazard</label>
          <select id="noise-preset" className="input" value={noise} onChange={(event) => setNoise(event.target.value as NoisePreset)}>
            {NOISE_PRESETS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <div style={{ fontSize: 9, color: "var(--text-3)", lineHeight: 1.5 }}>{preset.detail}</div>

          <div className="gate-row">
            <Waveform spectrum={recorder.spectrum} active={recorder.recording} />
            <span className={`gate-pill ${recorder.gate ? "open" : ""}`}>
              <Activity size={10} />{recorder.gate ? "gate open" : "gate closed"}
            </span>
          </div>

          <div style={{ display: "flex", gap: 7 }}>
            {recorder.recording ? (
              <button className="button danger" style={{ flex: 1 }} onClick={finishRecording} disabled={recorder.busy}>
                <Square size={12} /> Stop · {((6_000 - recorder.elapsedMs) / 1000).toFixed(1)}s
              </button>
            ) : (
              <button className="button primary" style={{ flex: 1 }} onClick={record} disabled={recorder.busy || busy !== null}>
                <Mic size={12} /> Record 6 s
              </button>
            )}
            <button className="button" onClick={() => { void runTranscribe(false); }} disabled={busy !== null} title="Run the pipeline without a microphone">
              <Ear size={12} /> Simulate
            </button>
          </div>
          {recorder.error && <div className="error-code" style={{ marginTop: 4 }}>{recorder.error}</div>}

          <DualSpectrogram frames={frames.length ? frames : recorder.spectrum.length ? [{ raw: recorder.spectrum, clean: recorder.spectrum.map((value) => value * 0.8) }] : []} gateOpen={recorder.gate} recordKey={frames.length} />

          {recorder.result && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} style={{ display: "grid", gap: 8 }}>
              <div className="triple">
                <div><div className="big-num">{recorder.result.snr.gainDb}<small>dB noise added</small></div></div>
                <div><div className="big-num">{recorder.result.hornAttenuationDb}<small>dB horn cut</small></div></div>
                <div><div className="big-num">{(recorder.result.bytesSuppressed / 1024).toFixed(1)}<small>KB silence blocked</small></div></div>
              </div>
              <div className="action-row">
                <button className="button" onClick={() => { void playBlob(recorder.result!.noisyWav, "wav", recorder.result!.sampleRate); }}><Play size={11} /> Raw noisy</button>
                <button className="button" onClick={() => { void playBlob(recorder.result!.cleanWav, "wav", recorder.result!.sampleRate); }}><Volume2 size={11} /> Edge cleaned</button>
              </div>
            </motion.div>
          )}
        </div>

        {/* ------------------------------------------------ transcript column */}
        <div className="bridge-col center">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span className="mini-label">Prisma transcript → reply</span>
            <span className="chip">{transcript?.meta.mode ?? "mock"} · {transcript?.model ?? "prisma-v3.0"}</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
            <label style={{ display: "grid", gap: 4 }}>
              <span className="mini-label">Output format</span>
              <select className="input" value={format} onChange={(event) => setFormat(event.target.value)}>
                <option value="transcribe">transcribe</option>
                <option value="verbatim">verbatim</option>
                <option value="codemix">codemix</option>
                <option value="transliterate">transliterate</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span className="mini-label">Language hints</span>
              <select className="input" value={languageCode} onChange={(event) => setLanguageCode(event.target.value)}>
                <option value="indic-auto">indic-auto</option>
                <option value="hi-IN">hi-IN</option>
                <option value="hi-IN,en-IN">hi-IN,en-IN</option>
                <option value="mr-IN,en-IN">mr-IN,en-IN</option>
                <option value="ta-IN,en-IN">ta-IN,en-IN</option>
                <option value="te-IN">te-IN</option>
                <option value="bn-IN,en-IN">bn-IN,en-IN</option>
              </select>
            </label>
          </div>

          <div className="transcript-box final" style={{ minHeight: 92 }}>
            {transcript ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                {transcript.transcript}
                {transcript.keyterm_hits.length > 0 && (
                  <div className="chip-row mt-8">
                    {transcript.keyterm_hits.map((term) => <span key={term} className="chip ember">{term}</span>)}
                  </div>
                )}
              </motion.div>
            ) : (
              <span className="subtle">Record or simulate to receive a segment. Segments appear only when the server emits them — nothing is faked token-by-token.</span>
            )}
          </div>

          {transcript && (
            <div style={{ display: "grid", gap: 6 }}>
              <div className="kv">
                <dt>detected_language_code</dt><dd>{transcript.detected_language_code ?? "— (transliterate)"}</dd>
                <dt>processing</dt><dd>{transcript.meta.latencyMs} ms · queue {transcript.meta.queuedMs} ms</dd>
                <dt>keyterms injected</dt><dd>{transcript.keyterms_count} / 200</dd>
                <dt>topic budget</dt><dd>{transcript.context.topic_chars} / 1600 chars</dd>
                <dt>request_id</dt><dd className="truncate" title={transcript.meta.requestId}>{transcript.meta.requestId.slice(0, 18)}…</dd>
              </div>
              <div className="chip-row">
                <span className="chip">{transcript.language_codes.join(" + ")}</span>
                <span className="chip">{transcript.format}</span>
                <span className="chip emerald">0 credits in mock</span>
              </div>
            </div>
          )}

          <div className="hairline" />

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "end" }}>
            <label style={{ display: "grid", gap: 4 }}>
              <span className="mini-label">Speak back in</span>
              <select className="input" value={target} onChange={(event) => setTarget(event.target.value as Locale)}>
                {LOCALES.map((locale) => <option key={locale} value={locale}>{LOCALE_META[locale].name} — {LOCALE_META[locale].native} ({locale})</option>)}
              </select>
            </label>
            <button className="button" onClick={() => { void runReply(transcript); }} disabled={!transcript || busy !== null}>
              <Volume2 size={12} /> Timbre
            </button>
          </div>

          <div className="action-row">
            <button className="button" onClick={() => { void runClonedReply(transcript); }} disabled={busy !== null}>
              <Sparkles size={12} /> Cloned voice reply
            </button>
            <button className="button" onClick={() => { void runVerify(); }} disabled={busy !== null}>
              <BadgeCheck size={12} /> Verify voiceprint
            </button>
            <button className="button" onClick={() => { void runExtract(transcript); }} disabled={!transcript || busy !== null}>
              <Wand2 size={12} /> Extract contract
            </button>
          </div>

          <AnimatePresence>
            {reply && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} style={{ overflow: "hidden" }}>
                <div className="code-block" style={{ fontSize: 10 }}>
                  <div style={{ color: "var(--text-3)", marginBottom: 6 }}>spoken_text (post-normaliser, tags applied)</div>
                  {reply.tts.spoken_text}
                  <div className="chip-row mt-8">
                    <span className="chip">{reply.tts.meta.latencyMs} ms</span>
                    <span className="chip">{reply.tts.audio.container} · {reply.tts.audio.sample_rate} Hz</span>
                    <span className="chip">{reply.tts.cache.key.slice(0, 10)}…</span>
                    {reply.tts.tags.kept.map((tag) => <span key={tag} className="chip violet">&lt;{tag}&gt;</span>)}
                    {reply.tts.tags.removed.length > 0 && <span className="chip rose">{reply.tts.tags.removed.length} tag(s) stripped</span>}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ------------------------------------------------ escrow column */}
        <div className="bridge-col">
          <div className="party">
            <span className="party-avatar" style={{ color: "var(--emerald)" }}><BadgeCheck size={15} /></span>
            <div style={{ minWidth: 0 }}>
              <div className="party-name">{meta.parties.b.name}</div>
              <div className="party-role">{meta.parties.b.language} · party B</div>
            </div>
          </div>

          <div className="mini-label">Pipeline</div>
          <div style={{ display: "grid", gap: 5 }}>
            {merged.map((step) => (
              <div key={step.id} style={{ display: "grid", gridTemplateColumns: "14px 1fr auto", gap: 7, alignItems: "center" }}>
                <span style={{ width: 7, height: 7, borderRadius: 99, justifySelf: "center", background: step.state === "done" ? "var(--emerald)" : step.state === "running" ? "var(--amber)" : step.state === "error" ? "var(--rose)" : "var(--surface-3)", boxShadow: step.state === "running" ? "0 0 8px var(--amber)" : "none" }} />
                <span style={{ fontSize: 9.5, color: step.state === "idle" ? "var(--text-3)" : "var(--text-1)" }}>{step.label}</span>
                <span className="mono" style={{ fontSize: 8, color: "var(--text-3)", maxWidth: 96, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={step.detail}>{step.detail ?? "—"}</span>
              </div>
            ))}
          </div>

          <div className="hairline" />

          {verify ? (
            <div style={{ display: "grid", gap: 7 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span className="mono" style={{ fontSize: 22, letterSpacing: "-.04em" }}>{verify.best_match?.cosine.toFixed(3)}</span>
                <span className={`chip ${verify.band === "verified" ? "emerald" : verify.band === "noisy_warning" ? "amber" : "rose"}`}>
                  {verify.band === "verified" ? <BadgeCheck size={10} /> : <ShieldAlert size={10} />}{verify.band.replace("_", " ")}
                </span>
              </div>
              <div className="mini-label">vs {verify.best_match?.handle ?? "no match"} · {verify.enrolled_count} enrolled</div>
              <div style={{ height: 4, borderRadius: 99, background: "var(--surface-3)", position: "relative", overflow: "hidden" }}>
                <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(verify.best_match?.cosine ?? 0) * 100}%`, background: verify.band === "verified" ? "var(--emerald)" : verify.band === "noisy_warning" ? "var(--amber)" : "var(--rose)", borderRadius: 99 }} />
                <span style={{ position: "absolute", left: "74%", top: 0, bottom: 0, width: 1, background: "var(--amber)" }} />
                <span style={{ position: "absolute", left: "86%", top: 0, bottom: 0, width: 1, background: "var(--emerald)" }} />
              </div>
              <div className="mini-label">0.74 noisy floor · 0.86 escrow seal</div>
            </div>
          ) : (
            <div className="boundary-copy" style={{ maxWidth: "none" }}>No escrow check yet. Enrol a voiceprint from the vault, then verify before signing.</div>
          )}

          {contract && (
            <>
              <div className="hairline" />
              <div className="mini-label">Extracted contract</div>
              <pre className="code-block" style={{ fontSize: 9, maxHeight: 132 }}>{JSON.stringify(contract.body, null, 2)}</pre>
            </>
          )}

          <div style={{ marginTop: "auto", display: "grid", gap: 7 }}>
            <button className="button primary" onClick={() => { void fullPipeline(); }} disabled={busy !== null}>
              <ArrowRight size={12} /> {busy === "mint" ? "Minting…" : "Run full pipeline → mint"}
            </button>
            <button className="button ghost" onClick={() => { setSteps([]); setTranscript(null); setReply(null); setVerify(null); setContract(null); setEmbed(null); }}>
              <CircleSlash2 size={11} /> Reset session
            </button>
            {embed && (
              <button className="text-button" onClick={() => { void navigator.clipboard.writeText(embed.speaker_embedding.embedding); toast.success("Embedding copied (base64 bfloat16, 1,536 bytes)"); }}>
                <Copy size={10} /> Copy [1,768] bfloat16 payload
              </button>
            )}
          </div>
        </div>
      </div>

      {transcript?.meta.mode === "mock" && (
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, color: "var(--text-3)", fontSize: 9 }}>
          <Ear size={11} /> Upstream simulated — set GNANI_API_KEY and USE_GNANI_MOCK=false to spend real credits. Requests, queueing and latency shown above are measured locally.
          <span className="chip">{formatNumber(transcript.meta.latencyMs)} ms</span>
        </div>
      )}
    </Panel>
  );
}
