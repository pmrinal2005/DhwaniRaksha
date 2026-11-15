"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Languages, Mic, Play, Sparkles, Square, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/shell/AppShell";
import { Panel, PanelContent } from "@/components/dashboard/primitives/Panel";
import { VoiceprintConstellation } from "@/components/hud/VoiceprintConstellation";
import { Waveform } from "@/components/hud/Waveform";
import { useRecorder } from "@/lib/use-recorder";
import { useVoiceprintStore } from "@/lib/voiceprint-store";
import { base64ToBlob, playBlob, NOISE_PRESETS, type NoisePreset } from "@/lib/audio";
import { embedVoice, synthesize, type EmbedResult } from "@/lib/live-api";
import { LOCALES, LOCALE_META, VOICE_PICKS, type Locale } from "@/lib/gnani/voices";

const SENTENCES: Record<Locale, string> = {
  "hi-IN": "नमस्ते, मैं अपनी ही आवाज़ में दस भाषाओं में बोल सकता हूँ। आपका स्वागत है।",
  "en-IN": "Hello, this is my own voice speaking a completely different language. Welcome to Dhwani-Raksha.",
  "ta-IN": "வணக்கம், இது என் சொந்தக் குரல் தமிழில் பேசுகிறது. உங்களை வரவேற்கிறேன்.",
  "te-IN": "నమస్కారం, ఇది నా స్వంత గొంతు తెలుగులో మాట్లాడుతోంది. స్వాగతం.",
  "kn-IN": "ನಮಸ್ಕಾರ, ಇದು ನನ್ನದೇ ಧ್ವನಿ ಕನ್ನಡದಲ್ಲಿ ಮಾತನಾಡುತ್ತಿದೆ. ಸ್ವಾಗತ.",
  "ml-IN": "നമസ്കാരം, ഇത് എന്റെ സ്വന്തം ശബ്ദം മലയാളത്തിൽ സംസാരിക്കുന്നു. സ്വാഗതം.",
  "mr-IN": "नमस्कार, हा माझाच आवाज मराठीत बोलत आहे. तुमचे स्वागत आहे.",
  "pa-IN": "ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਇਹ ਮੇਰੀ ਆਪਣੀ ਆਵਾਜ਼ ਪੰਜਾਬੀ ਵਿੱਚ ਬੋਲ ਰਹੀ ਹੈ। ਜੀ ਆਇਆਂ ਨੂੰ।",
  "bn-IN": "নমস্কার, এটি আমার নিজের কণ্ঠ বাংলায় বলছে। স্বাগতম।",
  "gu-IN": "નમસ્તે, આ મારો પોતાનો અવાજ ગુજરાતીમાં બોલી રહ્યો છે. સ્વાગત છે.",
};

/**
 * Crowd-favourite surface: record six seconds once, hear that exact 768-d voiceprint
 * speak all ten locales. Every tile is backed by a real synthesise call.
 */
export default function ArenaPage() {
  const recorder = useRecorder();
  const store = useVoiceprintStore();
  const [embed, setEmbed] = useState<EmbedResult | null>(null);
  const [busyLang, setBusyLang] = useState<Locale | null>(null);
  const [heard, setHeard] = useState<Locale[]>([]);
  const [noise, setNoise] = useState<NoisePreset>("mandi");
  const [lastMeta, setLastMeta] = useState<{ language: Locale; latency: number; bytes: number; mode: string } | null>(null);

  const record = async () => {
    if (recorder.recording) { await recorder.stop(); return; }
    await recorder.start(noise, 6_000);
  };

  const enrol = async () => {
    try {
      const result = await embedVoice(recorder.result?.cleanWav ?? null, { handle: "Arena speaker", role: "citizen", language: "hi-IN" });
      setEmbed(result);
      if (result.embedding_f32) store.setEmbedding({ vector: result.embedding_f32, digest: result.digest, handle: result.handle, source: result.meta.mode === "live" ? "gnani" : "mock" });
      toast.success("Voiceprint locked", { description: `${result.sample_seconds}s reference · [1,768] bfloat16 · ${result.meta.mode}` });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not extract the embedding");
    }
  };

  const speak = async (locale: Locale) => {
    if (!embed) { toast.error("Record once, then extract the voiceprint first."); return; }
    setBusyLang(locale);
    try {
      const result = await synthesize({
        text: SENTENCES[locale], model: "vachana-vc-v1", language: locale,
        embedding: embed.speaker_embedding.embedding, workflow: "mandi",
      });
      setLastMeta({ language: locale, latency: result.meta.latencyMs, bytes: result.audio.bytes, mode: result.meta.mode });
      await playBlob(base64ToBlob(result.audio.base64, result.audio.mime), result.audio.container, result.audio.sample_rate);
      setHeard((previous) => previous.includes(locale) ? previous : [...previous, locale]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Synthesis failed");
    } finally {
      setBusyLang(null);
    }
  };

  const speakAll = async () => {
    for (const locale of LOCALES) {
      // sequential on purpose: one active upstream request at a time
      await speak(locale);
    }
  };

  return (
    <AppShell>
      <div className="dashboard-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /><Sparkles size={11} /> Voice Arena · दस भाषाएँ, एक आवाज़</div>
          <h1 className="page-title">Your voice, all ten languages</h1>
          <p className="page-subtitle">One six-second sample becomes a 768-dimensional voiceprint. Every tile re-synthesises through vachana-vc-v1 in the locale you pick.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <span className="chip emerald">{heard.length} / 10 heard</span>
          <span className="chip">{embed ? `‖v‖ ${embed.l2_norm.toFixed(3)}` : "no voiceprint yet"}</span>
          {lastMeta && <span className="chip violet">{lastMeta.latency} ms · {lastMeta.mode}</span>}
        </div>
      </div>

      <div className="arena-grid">
        <Panel id="arena-record" title="1 · Capture a reference" subtitle="5–30 seconds of clear speech is enough for Gnani's clone embeddings." kicker="step one" icon={<Mic size={13} />} sourcePath="POST /api/voice/embed">
          <PanelContent>
            <label className="mini-label" htmlFor="arena-noise">Acoustic hazard</label>
            <select id="arena-noise" className="input mt-8" value={noise} onChange={(event) => setNoise(event.target.value as NoisePreset)}>
              {NOISE_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label} — {preset.detail}</option>)}
            </select>

            <div className="mt-12" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Waveform spectrum={recorder.spectrum} active={recorder.recording} height={34} />
              <span className={`gate-pill ${recorder.gate ? "open" : ""}`}>{recorder.recording ? `${((6_000 - recorder.elapsedMs) / 1000).toFixed(1)}s` : "idle"}</span>
            </div>

            <div className="action-row mt-12">
              <button className={`button ${recorder.recording ? "danger" : "primary"}`} onClick={record} disabled={recorder.busy}>
                {recorder.recording ? <><Square size={12} /> Stop</> : <><Mic size={12} /> Record 6 s</>}
              </button>
              <button className="button" onClick={enrol} disabled={recorder.busy}>
                <Sparkles size={12} /> Extract voiceprint
              </button>
            </div>

            {recorder.error && <div className="error-code mt-8">{recorder.error}</div>}
            {recorder.result && (
              <div className="triple mt-12">
                <div><div className="big-num">{recorder.result.speechSeconds}<small>s speech</small></div></div>
                <div><div className="big-num">{recorder.result.snr.gainDb}<small>dB noise</small></div></div>
                <div><div className="big-num">{(recorder.result.bytesSuppressed / 1024).toFixed(1)}<small>KB blocked</small></div></div>
              </div>
            )}

            <div className="hairline" />
            <div className="kv">
              <dt>endpoint</dt><dd>POST /api/v1/tts/voice-clone/embeddings</dd>
              <dt>tensor</dt><dd>[1, 768] · torch.bfloat16</dd>
              <dt>payload</dt><dd>1,536 bytes · base64</dd>
              <dt>digest</dt><dd>{embed ? embed.digest.slice(0, 18) : "—"}</dd>
            </div>
          </PanelContent>
        </Panel>

        <Panel id="arena-constellation" title="2 · See the voiceprint" subtitle="The actual tensor Gnani returned, projected into three axes." kicker="identity" icon={<Languages size={13} />} sourcePath="POST /api/voice/verify">
          <div className="constellation-wrap" style={{ minHeight: 236 }}>
            <VoiceprintConstellation vector={store.vector} cosine={store.cosine} height={236} />
            <div className="voice-cosine">
              <div className="voice-cosine-value">{embed ? embed.l2_norm.toFixed(2) : "—"}</div>
              <div className="voice-cosine-label">l2 norm</div>
            </div>
          </div>
          <PanelContent>
            <div className="action-row">
              <button className="button primary" onClick={speakAll} disabled={!embed || busyLang !== null}>
                <Volume2 size={12} /> Speak all ten
              </button>
              <button className="button" onClick={() => setHeard([])}>Reset counter</button>
            </div>
            <div className="chip-row mt-12">
              {heard.map((locale) => <span className="chip emerald" key={locale}><Check size={9} />{LOCALE_META[locale].name}</span>)}
              {heard.length === 0 && <span className="subtle" style={{ fontSize: 10 }}>No language played yet.</span>}
            </div>
          </PanelContent>
        </Panel>

        <Panel id="arena-languages" title="3 · Pick a language" subtitle="Timbre v3.0 voices speak all ten locales; the clone keeps your identity." kicker="ten voices, one speaker" icon={<Play size={13} />} sourcePath="POST /api/tts (vachana-vc-v1)">
          <PanelContent>
            <div className="lang-tiles">
              {LOCALES.map((locale) => {
                const busy = busyLang === locale;
                const done = heard.includes(locale);
                return (
                  <motion.button key={locale} className={`lang-tile ${busy ? "busy" : ""}`} onClick={() => { void speak(locale); }} disabled={busyLang !== null || !embed} whileTap={{ scale: 0.985 }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="lang-native">{LOCALE_META[locale].name}</div>
                      <div className="lang-meta">{locale.replace("-IN", "")} · {LOCALE_META[locale].native}</div>
                    </div>
                    <span className="lang-check">
                      <AnimatePresence mode="wait" initial={false}>
                        {busy ? <motion.span key="busy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="chip amber">…</motion.span>
                          : done ? <motion.span key="done" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}><Check size={12} /></motion.span>
                          : <motion.span key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><Play size={11} className="subtle" /></motion.span>}
                      </AnimatePresence>
                    </span>
                  </motion.button>
                );
              })}
            </div>
            <div className="hairline" />
            <div className="mini-label">catalog voices used for the fallback path</div>
            <div className="chip-row mt-8">
              {LOCALES.slice(0, 6).map((locale) => <span className="chip violet" key={locale}>{LOCALE_META[locale].name}: {VOICE_PICKS[locale].v3}</span>)}
            </div>
          </PanelContent>
        </Panel>
      </div>
    </AppShell>
  );
}
