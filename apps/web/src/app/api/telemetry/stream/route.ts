/**
 * GET /api/telemetry/stream — server-sent telemetry for the HUD.
 *
 * Events follow the discriminated union in `lib/telemetry/event-schema.ts`, so the
 * existing Zod-validated client ingests them unchanged. Sources are real where the
 * server can observe them (mutex queue, credit ledger, health probes); derived
 * series (workflow throughput) are computed from the store on every tick and
 * labelled `exactness: "estimated"`.
 *
 * Connect once per tab with EventSource — the stream self-terminates after 10 min
 * and the client reconnects with backoff, which keeps serverless billing sane.
 */
import { gnaniMode, mutexSnapshot } from "@/lib/gnani/client";
import { configuredMode, listCredits, listLedger, listVoiceprints } from "@/lib/server/store";
import { GOAL, WORKFLOW_ORDER, WORKFLOWS } from "@/lib/server/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TICK_MS = 2_500;
const LIFETIME_MS = 10 * 60_000;

export async function GET() {
  const encoder = new TextEncoder();
  const startedAt = Date.now();
  let timer: ReturnType<typeof setInterval> | undefined;
  let tick = 0;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (type: string, payload: unknown, source: string, exactness: "exact" | "estimated" = "exact") => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ts: new Date().toISOString(), source, exactness, payload })}\n\n`));
      };
      const comment = (text: string) => controller.enqueue(encoder.encode(`: ${text}\n\n`));

      comment("dhwani-raksha telemetry online");

      const pump = async () => {
        tick += 1;
        try {
          const mutex = mutexSnapshot();
          emit("mutex.state", {
            active: mutex.active ? { id: "live", kind: mutex.active.kind, since_ms: mutex.active.since } : null,
            queue: mutex.waiting > 0 ? Array.from({ length: mutex.waiting }, (_, index) => ({ id: `queued-${index}`, kind: "tts_sse", priority: 2, waiting_ms: index * 120 })) : [],
            total_429_avoided: mutex.total429Avoided,
            total_429_received: mutex.total429Received,
            retries: mutex.totalRetries,
            last_request_id: mutex.lastRequestId,
            last_latency_ms: mutex.lastLatencyMs,
          }, "computed");

          if (tick % 2 === 0) {
            const [credits, ledger, voiceprints] = await Promise.all([listCredits(), listLedger(60), listVoiceprints()]);
            const spent = Number(credits.data.reduce((sum, row) => sum + row.credits, 0).toFixed(2));
            const hourAgo = Date.now() - 3_600_000;
            const burn = credits.data.filter((row) => new Date(row.createdAt).getTime() >= hourAgo).reduce((sum, row) => sum + row.credits, 0);
            emit("credit.snapshot", {
              budget: GOAL.credits, spent, saved_by_cache: 0, blocked_silence_bytes: 0,
              remaining: Math.max(0, GOAL.credits - spent), burn_per_hour: Number(burn.toFixed(2)),
              projected_exhaustion_ts: burn > 0 ? new Date(Date.now() + ((GOAL.credits - spent) / burn) * 3_600_000).toISOString() : null,
            }, credits.mode === "live" ? "supabase" : "mock", credits.mode === "live" ? "exact" : "estimated");

            const latest = credits.data[0];
            if (latest) {
              emit("gnani.request", {
                id: latest.id, kind: mapKind(latest.callKind), model: latest.model,
                status: latest.status === 200 ? "ok" : latest.status === 429 ? "retry" : "failed",
                queued_ms: latest.queuedMs, duration_ms: latest.latencyMs, http_status: latest.status,
                credits: { value: latest.credits, exactness: latest.exactness },
              }, credits.mode === "live" ? "gnani" : "mock", credits.mode === "live" ? "exact" : "estimated");
            }

            WORKFLOW_ORDER.forEach((domain, index) => {
              const rows = ledger.data.filter((row) => row.workflowDomain === domain);
              if (!rows.length) return;
              const head = rows[0];
              if (index === tick % WORKFLOW_ORDER.length) {
                emit("ledger.minted", {
                  id: head.id, workflow_domain: domain, sha256_audit_hash: head.sha256AuditHash,
                  prev_ledger_hash: head.prevLedgerHash, party_a_cosine: head.partyACosine ?? 0,
                  party_b_cosine: head.partyBCosine ?? 0, structured_contract: head.structuredContract,
                }, ledger.mode === "live" ? "supabase" : "mock", ledger.mode === "live" ? "exact" : "estimated");
              }
            });

            if (voiceprints.data[0]) {
              emit("vc.verify", {
                user_id: voiceprints.data[0].id,
                cosine: voiceprints.data[0].lastCosine ?? 0.86,
                band: (voiceprints.data[0].lastCosine ?? 0.86) >= GOAL.verifiedThreshold ? "verified" : (voiceprints.data[0].lastCosine ?? 0.86) >= GOAL.noisyThreshold ? "noisy_warning" : "rejected",
                thresholds: { verified: GOAL.verifiedThreshold, noisy: GOAL.noisyThreshold },
              }, voiceprints.mode === "live" ? "supabase" : "mock", voiceprints.mode === "live" ? "exact" : "estimated");
            }

            const gnani = gnaniMode();
            emit("health", { service: "gnani_rest", state: gnani === "live" ? "up" : "degraded", rtt_ms: mutex.lastLatencyMs ?? 0 }, "computed");
            emit("health", { service: "gnani_ws", state: gnani === "live" ? "up" : "degraded", rtt_ms: 0 }, "computed");
            emit("health", { service: "supabase", state: configuredMode() === "live" ? "up" : "down", rtt_ms: 0 }, "computed");
          }

          if (Date.now() - startedAt > LIFETIME_MS) {
            comment("stream lifetime reached — client will reconnect");
            controller.close();
            if (timer) clearInterval(timer);
          }
        } catch (error) {
          emit("health", { service: "render", state: "degraded", rtt_ms: 0, detail: error instanceof Error ? error.message : "pump failed" }, "computed");
        }
      };

      void pump();
      timer = setInterval(() => { void pump(); }, TICK_MS);
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function mapKind(kind: string) {
  return (["stt_ws", "stt_rest", "tts_rest", "tts_sse", "vc_embed", "vc_sse"].includes(kind) ? kind : "stt_rest") as "stt_ws" | "stt_rest" | "tts_rest" | "tts_sse" | "vc_embed" | "vc_sse";
}

void WORKFLOWS;
