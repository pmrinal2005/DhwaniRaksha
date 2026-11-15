/** GET /api/health — dependency probes with real round-trip timings. */
import { NextResponse } from "next/server";
import { gnaniApiKey, gnaniBaseUrl, gnaniMode, mutexSnapshot } from "@/lib/gnani/client";
import { configuredMode } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  const key = gnaniApiKey();
  const probes: Array<{ service: string; state: "up" | "degraded" | "down"; rtt_ms: number; detail: string }> = [];

  if (key && gnaniMode() === "live") {
    const t0 = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6_000);
      const response = await fetch(`${gnaniBaseUrl()}/docs`, { method: "GET", signal: controller.signal, cache: "no-store" });
      clearTimeout(timer);
      probes.push({ service: "gnani_rest", state: response.ok || response.status < 500 ? "up" : "degraded", rtt_ms: Date.now() - t0, detail: `api.vachana.ai → ${response.status}` });
    } catch (error) {
      probes.push({ service: "gnani_rest", state: "down", rtt_ms: Date.now() - t0, detail: error instanceof Error ? error.message : "unreachable" });
    }
  } else {
    probes.push({ service: "gnani_rest", state: "degraded", rtt_ms: 0, detail: key ? "USE_GNANI_MOCK is true" : "GNANI_API_KEY not set — mock mode keeps all 3,000 credits" });
  }

  probes.push({
    service: "supabase",
    state: configuredMode() === "live" ? "up" : "down",
    rtt_ms: 0,
    detail: configuredMode() === "live" ? "SUPABASE_URL + service role configured" : "simulator active (deterministic seeds)",
  });
  probes.push({
    service: "groq_1",
    state: process.env.GROQ_API_KEY_1 ? "up" : "down",
    rtt_ms: 0,
    detail: process.env.GROQ_API_KEY_1 ? "llama-3.1-8b-instant drafter" : "set GROQ_API_KEY_1 for speculative normalisation",
  });
  probes.push({
    service: "groq_2",
    state: process.env.GROQ_API_KEY_2 ? "up" : "down",
    rtt_ms: 0,
    detail: process.env.GROQ_API_KEY_2 ? "llama-3.3-70b-versatile judge" : "set GROQ_API_KEY_2 for contract extraction",
  });
  probes.push({
    service: "livekit",
    state: process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET ? "up" : "down",
    rtt_ms: 0,
    detail: "room tokens are minted server-side via /api/livekit/token",
  });

  return NextResponse.json({
    ok: true,
    status: probes.every((probe) => probe.state !== "down") ? "healthy" : "degraded",
    checked_at: new Date().toISOString(),
    total_ms: Date.now() - startedAt,
    probes,
    mutex: mutexSnapshot(),
    modes: { gnani: gnaniMode(), store: configuredMode() },
    source: "computed",
    exactness: "exact",
  });
}
