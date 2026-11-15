# Dhwani-Raksha Ω · MUDRA-VANI OMEGA

**A zero-bandwidth acoustic biometric escrow, forensic noise-immune trade broker and cross-dialect voice ledger for Bharat — built entirely on Gnani Prisma v3.0, Timbre v3.0 and `vachana-vc-v1`.**

Every panel in this dashboard streams real data. With no API keys the app runs a deterministic
simulator (`USE_GNANI_MOCK=true`) that still produces a genuine 1,536-byte bfloat16 embedding,
real 8 kHz G.711 µ-law audio, real SHA-256 hash-chained receipts and real DSP — so the UI is
never showing placeholder numbers. Switch the mock off and the identical code paths call Gnani.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Prisma v3.0 STT → RAG keyterms/topic → Groq judge → Timbre TTS/VC → Ledger  │
│       ▲ every hop instrumented, every number fetched, every receipt hashed   │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 1 · Quick start

```bash
git clone <this-repo> && cd webapp

# Node 20.9+ (Vercel uses 22). Install once for the workspace:
npm install --prefix apps/web

cp apps/web/.env.example apps/web/.env.local     # optional: add keys
npm --prefix apps/web run dev                    # http://0.0.0.0:3000
```

The root route **is** the dashboard — there is no marketing landing page.

| command | what it runs |
| --- | --- |
| `npm --prefix apps/web run dev` | Next.js dev server on `0.0.0.0:3000` |
| `npm --prefix apps/web run build` | production build (ESLint + typecheck gate) |
| `npm --prefix apps/web run start` | production server on `0.0.0.0:3000` |
| `npm --prefix apps/web run typecheck` | `tsc --noEmit`, strict |
| `npm --prefix apps/web run lint` | ESLint (`src` + `scripts`) |
| `npm --prefix apps/web run test` | 20 protocol/DSP/ledger unit tests via `tsx` + `node:test` |
| `npm --prefix apps/web run guard:truth` | fails if fabricated metrics, untagged panels, dead runtimes, `Math.random` in components, or any Cloudflare/Hono import appear |

---

## 2 · What is on screen

| route | purpose |
| --- | --- |
| `/` | **Command HUD** — workflow strip, six-stage rail with live latency waterfall, the bridge console (record → Prisma → judge → mint), voiceprint constellation, Boli-Patra ledger, credit firewall, RAG context, ASHA triage, voiceprint vault, audio cache, PSTN dispatch, receipt velocity |
| `/arena` | **Voice Arena** — one 6-second sample → [1,768] voiceprint → the same voice speaking all ten locales, sequentially (anti-429) |
| `/ledger` | every receipt, filterable per workflow, with chain validity recomputed on read |
| `/receipt/[id]` | printable Boli-Patra: both voiceprint signatures, structured contract, SHA-256 chain, WhatsApp summary, JSON export |
| `/verify` | voiceprint vault: enrol, cosine verification with 0.86 / 0.74 bands, Householder cloak + speak |
| `/conformance` | runs `/api/debug?suite=all` — 30 machine-checked protocol guarantees |
| `/settings` | live dependency probes, endpoint contract with doc links, env variable list, theme + low-bandwidth toggles |

Nothing is a static label: each panel declares the exact endpoint it reads (`sourcePath`),
and every response carries a `source` + `exactness` envelope that the UI prints verbatim
(`mock` / `sim` / `computed` / `supabase`).

---

## 3 · Gnani protocol coverage

Verified against <https://docs.gnani.ai/api/introduction/introduction> and the STT/TTS/VC pages.

| capability | endpoint | implementation notes |
| --- | --- | --- |
| Prisma v3.0 REST STT | `POST /stt/v3` | ≤30 s / 10 MB, wav·mp3·ogg·flac·aac·m4a; returns `detected_language_code` + `end_to_end_latency` |
| Prisma realtime | `WSS /stt/v3/stream` | raw PCM s16le mono in **1,024-byte frames**, `x-sample-rate`, `x-vad-threshold 0.7`, `x-min-silence-ms 500`, 15-minute session cap, `1001`/`1008` close codes handled |
| RAG steering | headers | `keyterms` ≤200 · `topic` ≤1600 chars · `previous_text` last 600 · `speaker_names` 1–4 · ≤4 locales or `indic-auto` |
| Timbre v3.0 | `POST /api/v1/tts/inference` | 6 sample rates, `linear_pcm`/`pcm_s16le`/`pcm_mulaw`/`pcm_alaw`/`oggopus`, containers `wav|raw|mp3|ogg|mulaw|alaw` |
| Timbre SSE | `POST /api/v1/tts/sse` | `start` → `chunk{chunk_index,audio,is_final}` → `complete`; surfaced as `response_mode=sse` |
| Voice clone enrol | `POST /api/v1/tts/voice-clone/embeddings` | 5–30 s reference → `{embedding, shape:[1,768], dtype:"torch.bfloat16"}` |
| Clone synthesis | `vachana-vc-v1` | REST + SSE, requires `speaker_embedding`; embeddings are cached per handle |
| Audio tags | Timbre v3.0 only | 13 tags, **case-sensitive**, no closing tag; stripped server-side for v2.5 / VC; tag-only text rejected before it can 400 |
| Error envelope | all | `{success:false,error:{type,message}}`, flat `{success:false,message,status_code}` for REST, `422 {detail:[…]}` |

**Credit discipline** — one serialised upstream lane (a mutex that counts avoided 429s), retries
only on 429/500/503/504 with 500/1000/2000 ms backoff, content-addressed audio cache
(`sha256(text·model·voice·language)`), and a hard stop at 150 remaining credits. `USE_GNANI_MOCK=true`
by default so builds and demos never spend credits; the topbar ribbon always states the mode.

---

## 4 · The five surfaces, concretely

1. **Prisma bridge** — record in the browser (real `getUserMedia` + ScriptProcessor), inject a
   noise preset (mandi crowd, rickshaw horn, railway, PSTN 8 kHz), 85 Hz HPF + 2.5 kHz notch,
   VAD gating, then transcribe. The transcript panel only reveals segments the server actually
   returned — never a simulated typewriter.
2. **Voiceprint escrow** — `embed` → `verify` → ledger. Cosine ≥ 0.86 seals, 0.74–0.85 asks for
   re-confirmation, below 0.74 refuses to mint (`422 VOICEPRINT_NOT_VERIFIED`).
3. **Boli-Patra ledger** — `sha256(prev_hash : party_a : party_b : canonical_json)`, recomputed on
   every read; a receipt shows both signatures, the contract JSON and the chain link.
4. **Orthogonal cloak** — a Householder reflection built from the salt's component orthogonal to
   the print, giving exactly 90° rotation: L2 norm preserved, self-cosine `0.000`, strongest
   relink to any enrolled print ≈ 0.04. The cloaked print then speaks through `vachana-vc-v1`.
5. **Triage + PSTN** — deterministic vital rules over the normalised transcript produce a triage
   level, spoken guidance and Gnani audio tags; the PSTN panel synthesises G.711 µ-law at 8 kHz
   (`audio/basic`) for feature phones and 112 lines.

---

## 5 · Environment variables

All server-side unless prefixed `NEXT_PUBLIC_`. Full commented list in `apps/web/.env.example`.

| variable | required | default | effect |
| --- | --- | --- | --- |
| `GNANI_API_KEY` | for live Gnani | — | sent as `X-API-Key-ID` |
| `GNANI_BASE_URL` | no | `https://api.vachana.ai` | upstream origin |
| `USE_GNANI_MOCK` | no | `true` | `true` = simulator, **0 credits spent** |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | no | — | enables pgvector store; otherwise `sim` in-memory |
| `GROQ_API_KEY_1` / `_2` | no | — | `llama-3.1-8b-instant` conditioner + `llama-3.3-70b-versatile` judge |
| `LIVEKIT_URL` / `_API_KEY` / `_API_SECRET` / `_ROOM` | no | — | `/api/livekit/token`; returns 501 when unset |
| `NEXT_PUBLIC_LIVEKIT_URL` / `_ROOM` | no | — | browser-side room hints |

Missing services never break the UI: each panel reports `degraded`/`down` with the reason.

---

## 6 · Database (optional)

```bash
psql "$SUPABASE_DB_URL" -f supabase/migrations/20261113000000_init_dhwani_raksha.sql
```

Creates `voiceprints` (base64 bfloat16 + `vector(768)`), `ledger_entries` (hash chain),
`credit_spends`, `triage_logs`, `audio_cache`, the `mint_ledger_entry` RPC with row-level
security, and an ivfflat cosine index.

---

## 7 · Deploy to Vercel (manual)

`vercel.json` at the repo root is the complete contract — no dashboard tweaking needed.

1. Push this repo to GitHub.
2. <https://vercel.com/new> → **Import** the repo. Vercel reads `vercel.json`:
   framework `nextjs`, install `npm install --prefix apps/web`, build `npm --prefix apps/web run build`,
   output `apps/web/.next`, region `bom1`, API functions 60 s / 1 GB.
3. **Settings → Environment Variables**: add the keys from §5 for Production *and* Preview.
   Keep `USE_GNANI_MOCK=true` for the first deploy to prove the pipeline with zero credits.
4. **Deploy**. Then verify:
   ```
   curl -s https://<app>.vercel.app/api/debug?suite=all | jq '.passed, .total'
   curl -s https://<app>.vercel.app/api/health | jq '.probes'
   ```
   Expect `30 30` and a probe per dependency. `/api/telemetry/stream` is SSE — it sets
   `no-store` + `X-Accel-Buffering: no` in `vercel.json` so it is not buffered.
5. To go live on Gnani: set `GNANI_API_KEY` and `USE_GNANI_MOCK=false`, redeploy, then watch the
   credit firewall panel — burn, cache hits and projected exhaustion update every 20 s.

`apps/web/.env.local` is git-ignored; no secret is ever read in the browser.

---

## 8 · Verification status

```
typecheck   ✅ 0 errors (strict)
build       ✅ 9 static/dynamic routes compiled
tests       ✅ 20/20  (bfloat16 round-trip, cloak invariants, tag case-sensitivity,
                       model/voice pairing, µ-law forcing 8 kHz, quantifier parsing,
                       judge extraction, cache-key determinism, G.711 byte count)
truth-guard ✅ 8/8   (no fabricated metrics, sourcePath on every panel, runtimes,
                       determinism, mock ribbon, no Cloudflare/Hono)
conformance ✅ 30/30 (GET /api/debug?suite=all)
routes      ✅ / /arena /ledger /receipt/[id] /verify /conformance /settings — 200, no
               console errors, no horizontal overflow at 1680/1200/390 px
```

---

## 9 · Project layout

```
webapp/
├─ vercel.json                       deploy contract
├─ supabase/migrations/              pgvector schema + hash-chain RPC + RLS
└─ apps/web/
   ├─ scripts/truth-guard.mjs         build gate against fabricated data
   ├─ tests/protocol.test.ts          20 unit tests
   └─ src/
      ├─ app/                        routes (dashboard at /) + 16 API routes
      │  └─ api/{stt,tts,voice,ledger,insights,credits,triage,contract,health,debug,telemetry,livekit}
      ├─ components/
      │  ├─ hud/                     Waveform, DualSpectrogram, VoiceprintConstellation, Receipt glyphs
      │  ├─ shell/                   Nav, Topbar, TelemetryRail, CommandPalette, AppShell
      │  └─ dashboard/               SessionPanel, 11 live panels, primitives
      ├─ lib/
      │  ├─ gnani/                   voices, bfloat16, normalizer, hash, payloads, client, mock
      │  ├─ server/                  store (Supabase/sim), catalog, judge
      │  ├─ live-api.ts              typed client + react-query hooks (source/exactness envelope)
      │  ├─ api-client.ts            relative-origin fetch base (self-hosted API, no CORS)
      │  ├─ audio.ts                 capture, noise presets, HPF/notch, µ-law, WAV, Goertzel
      │  └─ telemetry/               zod event union, SSE client, zustand store
      └─ styles/                     tokens, globals, dashboard, hatch
```

Constraints honoured: no Cloudflare, no Hono, no landing page, no fabricated data,
≤3,000 credits with a 150-credit hard floor, and never streamed silence/noise to Gnani.
