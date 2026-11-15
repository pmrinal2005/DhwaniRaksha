"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { AlertTriangle, CheckCircle2, FlaskConical, Loader2, Play, XCircle } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { Panel, PanelContent } from "@/components/dashboard/primitives/Panel";
import { api } from "@/lib/live-api";

interface Check { id: string; group: string; ok: boolean; detail: string }
interface SuiteResponse { ok: boolean; passed: number; total: number; checks: Check[]; modes: { gnani: string; key_present: boolean; store: string } }

/** Runs the live protocol conformance suite against the deployed routes. */
export default function ConformancePage() {
  const [suite, setSuite] = useState<SuiteResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setRunning(true); setError(null);
    try {
      const response = await api<SuiteResponse>("/api/debug?suite=all");
      setSuite(response);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Suite failed");
    } finally {
      setRunning(false);
    }
  }, []);

  useEffect(() => { void run(); }, [run]);

  const groups = Array.from(new Set(suite?.checks.map((check) => check.group) ?? []));

  return (
    <AppShell>
      <div className="dashboard-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /><FlaskConical size={11} /> Conformance lab</div>
          <h1 className="page-title">Protocol guarantees, machine-checked</h1>
          <p className="page-subtitle">Every check exercises the same code paths the dashboard uses in production — no mocks of our own API.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {suite && <span className={`chip ${suite.ok ? "emerald" : "rose"}`}>{suite.passed}/{suite.total} passing</span>}
          {suite && <span className="chip">gnani {suite.modes.gnani}</span>}
          {suite && <span className="chip">store {suite.modes.store}</span>}
          <button className="button primary" onClick={() => { void run(); }} disabled={running}>
            {running ? <><Loader2 size={12} className="spin" /> Running</> : <><Play size={12} /> Re-run suite</>}
          </button>
        </div>
      </div>

      {error && (
        <div className="boundary-state" role="alert">
          <div className="boundary-symbol"><AlertTriangle size={18} className="rose" /></div>
          <div className="error-code">SUITE_FAILED</div>
          <div className="boundary-copy">{error}</div>
        </div>
      )}

      <div className="dashboard-grid">
        {groups.map((group) => {
          const checks = suite?.checks.filter((check) => check.group === group) ?? [];
          const passed = checks.filter((check) => check.ok).length;
          return (
            <Panel
              key={group}
              id={`group-${group}`}
              title={group}
              subtitle={`${passed} / ${checks.length} checks`}
              kicker="conformance"
              icon={passed === checks.length ? <CheckCircle2 size={13} className="emerald" /> : <XCircle size={13} className="rose" />}
              sourcePath="GET /api/debug?suite=all"
              className="grid-span-6"
            >
              <PanelContent>
                <div style={{ display: "grid", gap: 7 }}>
                  {checks.map((check, index) => (
                    <motion.div key={check.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.02 }} style={{ display: "grid", gridTemplateColumns: "16px minmax(0,1fr) auto", gap: 9, alignItems: "start" }}>
                      {check.ok ? <CheckCircle2 size={13} className="emerald" style={{ marginTop: 1 }} /> : <XCircle size={13} className="rose" style={{ marginTop: 1 }} />}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 10.5, color: check.ok ? "var(--text-1)" : "var(--rose)" }}>{check.id}</div>
                        <div className="mono" style={{ fontSize: 8.5, color: "var(--text-3)", marginTop: 3, wordBreak: "break-word" }}>{check.detail}</div>
                      </div>
                      <span className={`chip ${check.ok ? "emerald" : "rose"}`}>{check.ok ? "pass" : "fail"}</span>
                    </motion.div>
                  ))}
                </div>
              </PanelContent>
            </Panel>
          );
        })}
        {!suite && !error && (
          <div className="grid-span-12">
            <div className="boundary-state"><Loader2 size={18} className="spin" /><div className="boundary-copy" style={{ marginTop: 10 }}>Running the protocol suite…</div></div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
