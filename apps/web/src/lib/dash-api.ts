import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDashboard } from "@/lib/api-client";
import { creditsSchema, ledgerSchema, overviewSchema, peopleSchema, pricesSchema, ragSchema, settingsSchema, triageSchema, verificationScoresSchema, voiceprintsSchema, type Overview, type Credits, type Ledger, type Voiceprints, type VerificationScores, type RagContext, type Prices, type Triage, type People, type Settings } from "@/lib/contracts";
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

export function useOverview(window: TimeWindow) { return useQuery(queryOptions<Overview>(`/api/dash/overview?window=${window}`, overviewSchema)); }
export function useCredits(window: TimeWindow) { return useQuery(queryOptions<Credits>(`/api/dash/credits?window=${window}`, creditsSchema)); }
export function useLedger(window: TimeWindow, workflow?: string | null) { return useQuery(queryOptions<Ledger>(`/api/dash/ledger?window=${window}${workflow ? `&workflow=${encodeURIComponent(workflow)}` : ""}`, ledgerSchema)); }
export function useLedgerEntry(id: string) { return useQuery({ ...queryOptions<Ledger["entries"][number]>(`/api/dash/ledger/${encodeURIComponent(id)}`, ledgerSchema.shape.entries.element), refetchInterval: false }); }
export function useVoiceprints() { return useQuery(queryOptions<Voiceprints>("/api/dash/voiceprints", voiceprintsSchema)); }
export function useVerificationScores() { return useQuery(queryOptions<VerificationScores>("/api/dash/verification-scores", verificationScoresSchema)); }
export function useRagContext(workflow?: string | null) { return useQuery({ ...queryOptions<RagContext>(`/api/dash/rag/clusters?workflow=${encodeURIComponent(workflow ?? "")}`, ragSchema), enabled: Boolean(workflow) }); }
export function usePrices(workflow?: string | null) { return useQuery({ ...queryOptions<Prices>(`/api/dash/prices?workflow=${encodeURIComponent(workflow ?? "")}`, pricesSchema), enabled: Boolean(workflow) }); }
export function useTriage(workflow?: string | null) { return useQuery({ ...queryOptions<Triage>(`/api/dash/triage/recent?workflow=${encodeURIComponent(workflow ?? "")}`, triageSchema), enabled: Boolean(workflow) }); }
export function usePeople() { return useQuery(queryOptions<People>("/api/dash/participants", peopleSchema)); }
export function useSettings() { return useQuery({ ...queryOptions<Settings>("/api/dash/routes", settingsSchema), refetchInterval: false }); }

export function useHealDashboard() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith("/api/dash/") });
}
