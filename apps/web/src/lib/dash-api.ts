import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDashboard } from "@/lib/api-client";
import { creditsSchema, ledgerSchema, overviewSchema, peopleSchema, pricesSchema, ragSchema, settingsSchema, triageSchema, verificationScoresSchema, voiceprintsSchema } from "@/lib/contracts";
import type { TimeWindow } from "@/lib/telemetry/event-schema";
import { LAYOUT } from "@/components/dashboard/primitives/tokens";

function queryOptions<T extends z.ZodType>(path: string, schema: T) {
  return {
    queryKey: [path],
    queryFn: () => getDashboard(path, schema),
    staleTime: LAYOUT.staleMs,
    refetchInterval: LAYOUT.refetchMs,
    retry: LAYOUT.queryRetry,
    refetchOnWindowFocus: false,
  };
}

export function useOverview(window: TimeWindow) { return useQuery(queryOptions(`/api/dash/overview?window=${window}`, overviewSchema)); }
export function useCredits(window: TimeWindow) { return useQuery(queryOptions(`/api/dash/credits?window=${window}`, creditsSchema)); }
export function useLedger(window: TimeWindow, workflow?: string | null) { return useQuery(queryOptions(`/api/dash/ledger?window=${window}${workflow ? `&workflow=${encodeURIComponent(workflow)}` : ""}`, ledgerSchema)); }
export function useLedgerEntry(id: string) { return useQuery({ ...queryOptions(`/api/dash/ledger/${encodeURIComponent(id)}`, ledgerSchema.shape.entries.element), refetchInterval: false }); }
export function useVoiceprints() { return useQuery(queryOptions("/api/dash/voiceprints", voiceprintsSchema)); }
export function useVerificationScores() { return useQuery(queryOptions("/api/dash/verification-scores", verificationScoresSchema)); }
export function useRagContext(workflow?: string | null) { return useQuery({ ...queryOptions(`/api/dash/rag/clusters?workflow=${encodeURIComponent(workflow ?? "")}`, ragSchema), enabled: Boolean(workflow) }); }
export function usePrices(workflow?: string | null) { return useQuery({ ...queryOptions(`/api/dash/prices?workflow=${encodeURIComponent(workflow ?? "")}`, pricesSchema), enabled: Boolean(workflow) }); }
export function useTriage(workflow?: string | null) { return useQuery({ ...queryOptions(`/api/dash/triage/recent?workflow=${encodeURIComponent(workflow ?? "")}`, triageSchema), enabled: Boolean(workflow) }); }
export function usePeople() { return useQuery(queryOptions("/api/dash/participants", peopleSchema)); }
export function useSettings() { return useQuery({ ...queryOptions("/api/dash/routes", settingsSchema), refetchInterval: false }); }

export function useHealDashboard() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith("/api/dash/") });
}
