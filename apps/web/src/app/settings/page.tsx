"use client";

import { useState } from "react";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Copy, KeyRound, Settings2, ShieldCheck, TerminalSquare, XCircle } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/shell/AppShell";
import { Panel, PanelContent } from "@/components/dashboard/primitives/Panel";
import { useHealth, useInsights } from "@/lib/live-api";
import { useUiStore } from "@/lib/ui-store";
import { TIMBRE_V3_VOICES, TIMBRE_V25_VOICES, AUDIO_TAG_EXAMPLES, CONTEXT_LIMITS } from "@/lib/gnani/voices";

const ENV_VARS = [
  { key: "GNANI_API_KEY", detail: "X-API-Key-ID for api.vachana.ai", group: "Gnani" },
  { key: "USE_GNANI_MOCK", detail: "true keeps all 3,000 credits (default)", group: "Gnani" },
  { key: "GNANI_BASE_URL", detail: "https://api.vachana.ai", group: "Gnani" },
  { key: "SUPABASE_URL", detail: "Postgres + pgvector project URL", group: "Supabase" },
  { key: "SUPABASE_SERVICE_ROLE_KEY", detail: "server-only service role key", group: "Supabase" },
  { key: "GROQ_API_KEY_1", detail: "llama-3.1-8b-instant speculative drafter", group: "Groq" },
  { key: "GROQ_API_KEY_2", detail: "llama-3.3-70b-versatile contract judge", group: "Groq" },
  { key: "LIVEKIT_URL", detail: "wss room URL for the dual-voice bridge", group: "LiveKit" },
  { key: "LIVEKIT_API_KEY", detail: "token issuer key", group: "LiveKit" },
  { key: "LIVEKIT_API_SECRET", detail: "token issuer secret", group: "LiveKit" },
] as const;

const ENDPOINTS = [
  { method: "POST", path: "/stt/v3", doc: "https://docs.gnani.ai/api/STT/speech-to-text", note: "REST transcription ≤ 30 s, multipart" },
  { method: "WSS", path: "/stt/v3/stream", doc: "https://docs.gnani.ai/api/STT/stt-websocket", note: "1,024-byte PCM frames + commit frame" },
  { method: "POST", path: "/api/v1/tts/inference", doc: "https://docs.gnani.ai/api/TTS/tts-inference", note: "binary audio, wav/mp3/ogg/mulaw/alaw" },
  { method: "POST", path: "/api/v1/tts/sse", doc: "https://docs.gnani.ai/api/TTS/tts-sse", note: "start / chunk / complete events" },
  { method: "POST", path: "/api/v1/tts/voice-clone/embeddings", doc: "https://docs.gnani.ai/api/VC/voice-clone-embeddings", note: "[1,768] torch.bfloat16" },
  { method: "POST", path: "/api/v1/tts/inference (vachana-vc-v1)", doc: "https://docs.gnani.ai/api/VC/vc-inference", note: "cloned voice REST" },
  { method: "POST", path: "/api/v1/tts/sse (vachana-vc-v1)", doc: "https://docs.gnani.ai/api/VC/vc-sse", note: "cloned voice streaming" },
] as const;

export default function SettingsPage() {
  const health = useHealth();
  const insights = useInsights();
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  const lowBandwidth = useUiStore((state) => state.lowBandwidth);
  const setLowBandwidth = useUiStore((state) => state.setLowBandwidth);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(value);
    toast.success("Copied");
    setTimeout(() => setCopied(null), 1_600);
  };

  const probes = health.data?.probes ?? [];
  const modes = insights.data?.modes;

  return (
    <AppShell>
      <div className="dashboard-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /><Settings2 size={11} /> Configuration</div>
          <h1 className="page-title">Runtime contract</h1>
          <p className="page-subtitle">Exactly which endpoints, models, keys and guardrails this deployment is using right now.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <span className="chip">{health.data?.status ?? "checking"}</span>
          {modes && <span className="chip emerald">gnani {modes.gnani}</span>}
          {modes && <span className="chip violet">store {modes.store}</span>}
          {modes && <span className="chip amber">groq {modes.groq}</span>}
        </div>
      </div>

      <div className="dashboard-grid">
        <Panel id="probes" title="Dependency probes" subtitle="Measured at request time, not inferred." kicker="health" icon={<ShieldCheck size={13} />} sourcePath="GET /api/health" className="grid-span-6">
          <PanelContent>
            <div style={{ display: "grid", gap: 7 }}>
              {probes.map((probe) => (
                <div key={probe.service} style={{ display: "grid", gridTemplateColumns: "14px minmax(0,1fr) auto auto", gap: 9, alignItems: "center" }}>
                  {probe.state === "up" ? <CheckCircle2 size={13} className="emerald" /> : probe.state === "degraded" ? <AlertTriangle size={13} className="amber" /> : <XCircle size={13} className="rose" />}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 10.5 }}>{probe.service}</div>
                    <div className="truncate" style={{ fontSize: 8.5, color: "var(--text-3)" }}>{probe.detail}</div>
                  </div>
                  <span className="mono" style={{ fontSize: 8.5, color: "var(--text-3)" }}>{probe.rtt_ms ? `${probe.rtt_ms} ms` : "—"}</span>
                  <span className={`chip ${probe.state === "up" ? "emerald" : probe.state === "degraded" ? "amber" : "rose"}`}>{probe.state}</span>
                </div>
              ))}
              {probes.length === 0 && <div className="subtle" style={{ fontSize: 10 }}>Waiting for the first health probe…</div>}
            </div>
            <div className="hairline" />
            <div style={{ fontSize: 9, color: "var(--text-3)", lineHeight: 1.6 }}>
              Set the variables below in Vercel → Project → Settings → Environment Variables, then redeploy. Nothing is read from the browser at runtime except the LiveKit public URL.
            </div>
          </PanelContent>
        </Panel>

        <Panel id="env" title="Environment variables" subtitle="Server-only unless prefixed NEXT_PUBLIC_." kicker="keys" icon={<KeyRound size={13} />} sourcePath="process.env" className="grid-span-6">
          <PanelContent>
            <div style={{ display: "grid", gap: 6 }}>
              {ENV_VARS.map((variable) => (
                <div key={variable.key} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 10, alignItems: "center", paddingBottom: 6, borderBottom: "1px solid var(--stroke)" }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="mono" style={{ fontSize: 9.5 }}>{variable.key}</div>
                    <div style={{ fontSize: 8.5, color: "var(--text-3)", marginTop: 2 }}>{variable.group} · {variable.detail}</div>
                  </div>
                  <button className="icon-button" style={{ width: 26, height: 26 }} onClick={() => { void copy(variable.key); }} aria-label={`Copy ${variable.key}`}>
                    {copied === variable.key ? <CheckCircle2 size={12} className="emerald" /> : <Copy size={12} />}
                  </button>
                </div>
              ))}
            </div>
            <div className="chip-row mt-12">
              <span className="chip emerald">USE_GNANI_MOCK=true → 0 credits</span>
              <span className="chip amber">hard stop 150 credits</span>
              <span className="chip">retry 429/500/503/504 · 0.5/1/2 s</span>
            </div>
          </PanelContent>
        </Panel>

        <Panel id="endpoints" title="Endpoint contract" subtitle="Paths, methods and the doc page each one implements." kicker="protocol" icon={<TerminalSquare size={13} />} sourcePath="lib/gnani/voices.ts" className="grid-span-8">
          <PanelContent>
            <div style={{ display: "grid", gap: 5 }}>
              {ENDPOINTS.map((endpoint) => (
                <a key={endpoint.path} href={endpoint.doc} target="_blank" rel="noreferrer" style={{ display: "grid", gridTemplateColumns: "44px minmax(0,1.3fr) minmax(0,1fr) 12px", gap: 9, alignItems: "center", padding: "7px 0", borderBottom: "1px solid var(--stroke)" }}>
                  <span className={`chip ${endpoint.method === "WSS" ? "violet" : "ember"}`}>{endpoint.method}</span>
                  <span className="mono truncate" style={{ fontSize: 9.5 }}>{endpoint.path}</span>
                  <span className="truncate" style={{ fontSize: 9, color: "var(--text-3)" }}>{endpoint.note}</span>
                  <ArrowUpRight size={11} className="subtle" />
                </a>
              ))}
            </div>
            <div className="hairline" />
            <div className="kv">
              <dt>keyterms ceiling</dt><dd>{CONTEXT_LIMITS.keyterms}</dd>
              <dt>topic ceiling</dt><dd>{CONTEXT_LIMITS.topic} chars</dd>
              <dt>previous_text</dt><dd>{CONTEXT_LIMITS.previousText} chars</dd>
              <dt>speaker_names</dt><dd>1–{CONTEXT_LIMITS.speakerNames}</dd>
              <dt>languages per request</dt><dd>≤ {CONTEXT_LIMITS.languages}</dd>
              <dt>REST clip</dt><dd>{CONTEXT_LIMITS.restAudioSeconds} s · 10 MB</dd>
              <dt>WS frame</dt><dd>{CONTEXT_LIMITS.wsFrameBytes} bytes</dd>
              <dt>upstream timeout</dt><dd>{CONTEXT_LIMITS.upstreamTimeoutMs} ms</dd>
            </div>
          </PanelContent>
        </Panel>

        <Panel id="prefs" title="Session preferences" subtitle="Persisted locally; never sent to Gnani." kicker="ui" icon={<Settings2 size={13} />} sourcePath="zustand/ui-store" className="grid-span-4">
          <PanelContent>
            <div style={{ display: "grid", gap: 10 }}>
              <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontSize: 10.5 }}>Theme</span>
                <div className="segmented">
                  <button className={theme === "raat" ? "active" : ""} onClick={() => setTheme("raat")}>raat</button>
                  <button className={theme === "din" ? "active" : ""} onClick={() => setTheme("din")}>din</button>
                </div>
              </label>
              <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontSize: 10.5 }}>Low-bandwidth mode</span>
                <button role="switch" aria-checked={lowBandwidth} className={`toggle ${lowBandwidth ? "on" : ""}`} onClick={() => setLowBandwidth(!lowBandwidth)} aria-label="Low bandwidth" />
              </label>
              <div className="hairline" />
              <div className="kv">
                <dt>v3 voices</dt><dd>{TIMBRE_V3_VOICES.length}</dd>
                <dt>v2.5 voices</dt><dd>{TIMBRE_V25_VOICES.length}</dd>
                <dt>audio tags</dt><dd>{AUDIO_TAG_EXAMPLES.length} shown · 13 total</dd>
                <dt>probe total</dt><dd>{health.data ? `${health.data.total_ms} ms` : "—"}</dd>
              </div>
              <div className="chip-row">
                {AUDIO_TAG_EXAMPLES.slice(0, 6).map((tag) => <span key={tag.tag} className="chip violet" title={tag.effect}>&lt;{tag.tag}&gt;</span>)}
              </div>
              <div style={{ fontSize: 8.5, color: "var(--text-3)", lineHeight: 1.6 }}>
                Tags are case-sensitive and only valid on timbre-v3.0; the server strips them for timbre-v2.5 and vachana-vc-v1 before every call.
              </div>
            </div>
          </PanelContent>
        </Panel>
      </div>
    </AppShell>
  );
}
