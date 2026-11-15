/** GET /api/credits — the 3,000-credit firewall meter, sourced from gnani_credit_ledger. */
import { NextResponse } from "next/server";
import { gnaniMode, mutexSnapshot } from "@/lib/gnani/client";
import { configuredMode, listCache, listCredits } from "@/lib/server/store";
import { GOAL } from "@/lib/server/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [credits, cache] = await Promise.all([listCredits(), listCache()]);
  const now = Date.now();
  const spent = Number(credits.data.reduce((sum, row) => sum + row.credits, 0).toFixed(2));
  const savedByCache = cache.data.reduce((sum, row) => sum + row.creditsSaved, 0);
  const remaining = Math.max(0, GOAL.credits - spent);
  const hourAgo = now - 3_600_000;
  const burnPerHour = Number(credits.data
    .filter((row) => new Date(row.createdAt).getTime() >= hourAgo)
    .reduce((sum, row) => sum + row.credits, 0).toFixed(2));

  const burnSeries = Array.from({ length: 24 }, (_, index) => {
    const from = now - (24 - index) * 3_600_000;
    const to = from + 3_600_000;
    return Number(credits.data.filter((row) => { const t = new Date(row.createdAt).getTime(); return t >= from && t < to; }).reduce((sum, row) => sum + row.credits, 0).toFixed(2));
  });

  const byKind = new Map<string, number>();
  for (const row of credits.data) byKind.set(row.callKind, (byKind.get(row.callKind) ?? 0) + row.credits);

  return NextResponse.json({
    ok: true,
    budget: GOAL.credits,
    spent,
    saved_by_cache: savedByCache,
    remaining,
    burn_per_hour: burnPerHour,
    projected_exhaustion_ts: burnPerHour > 0 ? new Date(now + (remaining / burnPerHour) * 3_600_000).toISOString() : null,
    cache_hit_ratio: credits.data.length ? Math.min(1, savedByCache / Math.max(1, savedByCache + credits.data.length)) : null,
    blocked_silence_bytes: 0,
    hard_stop: GOAL.hardStopFloor,
    burn_series: burnSeries,
    spend_breakdown: Array.from(byKind.entries()).map(([kind, value]) => ({ kind, credits: Number(value.toFixed(2)), exactness: "estimated" as const })),
    calls: credits.data.length,
    exactness: "estimated",
    source: configuredMode() === "live" ? "supabase" : "mock",
    mode: { gnani: gnaniMode(), store: configuredMode(), mutex: mutexSnapshot() },
  });
}
