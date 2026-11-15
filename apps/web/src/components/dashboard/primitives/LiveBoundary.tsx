"use client";

import { useEffect, type ReactNode } from "react";
import { AlertTriangle, ArrowUpRight, Inbox, RotateCcw } from "lucide-react";
import { motion } from "motion/react";
import { DashApiError } from "@/lib/api-client";
import { useUiStore } from "@/lib/ui-store";
import { useTelemetryStore } from "@/lib/telemetry/store";
import { translate } from "@/lib/i18n";

export type BoundaryState = { isLoading: boolean; isError: boolean; error: Error | null; isEmpty: boolean; source?: string; refetch?: () => void };

export function LiveBoundary({ id, sourcePath, state, emptyTitle, emptyBody, emptyAction, children, skeleton = "chart" }: {
  id: string; sourcePath: string; state: BoundaryState; emptyTitle: string; emptyBody: string; emptyAction?: ReactNode;
  children: ReactNode; skeleton?: "chart" | "rows" | "hero";
}) {
  const language = useUiStore((store) => store.language);
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const markAudit = useTelemetryStore((store) => store.markAudit);
  useEffect(() => { if (state.source) markAudit(id, state.source as Parameters<typeof markAudit>[1]); }, [id, state.source, markAudit]);
  let content: ReactNode;
  if (state.isLoading) content = <Skeleton kind={skeleton} />;
  else if (state.isError) {
    const error = state.error;
    const code = error instanceof DashApiError ? error.code : "LIVE_DATA_ERROR";
    content = <div className="boundary-state" role="alert">
      <div className="boundary-symbol"><AlertTriangle size={18} className="rose" /></div>
      <div className="error-code">{code}</div>
      <div className="boundary-copy">{error?.message || "The live data source could not be read."}</div>
      {state.refetch && <button className="button" style={{ marginTop: 14 }} onClick={state.refetch}><RotateCcw size={13} />{t("retry")}</button>}
    </div>;
  } else if (state.isEmpty) content = <div className="boundary-state">
    <div className="boundary-symbol"><Inbox size={18} /></div>
    <div className="boundary-title">{emptyTitle}</div>
    <div className="boundary-copy">{emptyBody}</div>
    {emptyAction && <div style={{ marginTop: 14 }}>{emptyAction}</div>}
  </div>;
  else content = <motion.div className="live-boundary" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{children}</motion.div>;
  return <div className="live-boundary" data-source={sourcePath} data-widget={id}>
    {content}
    {!state.isLoading && !state.isError && !state.isEmpty && state.source && <Provenance source={state.source} />}
  </div>;
}

function Skeleton({ kind }: { kind: "chart" | "rows" | "hero" }) {
  return <div className="panel-content" aria-busy="true" aria-label="Loading live data">
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <div className="skeleton" style={{ width: "35%", height: 12 }} />
      <div className="skeleton" style={{ width: "16%", height: 12 }} />
    </div>
    {kind === "rows" ? <div style={{ display: "grid", gap: 12, marginTop: 22 }}>{["a", "b", "c", "d"].map((key) => <div className="skeleton" key={key} style={{ height: 32 }} />)}</div> : <>
      <div className="skeleton" style={{ width: "45%", height: kind === "hero" ? 50 : 32, marginTop: 22 }} />
      <div className="skeleton" style={{ width: "100%", height: 100, marginTop: 22, borderRadius: 12 }} />
    </>}
  </div>;
}

export function Provenance({ source, exactness }: { source: string; exactness?: string }) {
  const audit = useUiStore((store) => store.auditOpen);
  if (!audit) return null;
  return <span className="pill" style={{ position: "absolute", top: 8, right: 8 }}><ArrowUpRight size={9} />{source}{exactness === "estimated" ? " · est." : ""}</span>;
}

export function EstTag({ exactness }: { exactness?: "exact" | "estimated" }) {
  return exactness === "estimated" ? <span className="pill warning" title="Estimated value">est.</span> : null;
}

export function EmptyInline({ children }: { children: ReactNode }) {
  return <div className="boundary-state" style={{ minHeight: 90, padding: 14 }}><Inbox size={17} className="subtle" /><div className="boundary-copy" style={{ marginTop: 8 }}>{children}</div></div>;
}
