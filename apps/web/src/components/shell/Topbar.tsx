"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Bell, Command, Gauge, Moon, PanelRight, Search, Sun } from "lucide-react";
import { useUiStore } from "@/lib/ui-store";
import { useTelemetryConnection } from "@/lib/telemetry/sse-client";
import { useTelemetryStore } from "@/lib/telemetry/store";
import { useInsights } from "@/lib/live-api";
import { WORKFLOWS, WORKFLOW_ORDER } from "@/lib/server/catalog";

export function Topbar() {
  const pathname = usePathname();
  const setCommandOpen = useUiStore((state) => state.setCommandOpen);
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  const activeWorkflow = useUiStore((state) => state.activeWorkflow);
  const setWorkflow = useUiStore((state) => state.setWorkflow);
  const toggleRightRail = useUiStore((state) => state.toggleRightRail);
  const rightRailOpen = useUiStore((state) => state.rightRailOpen);
  const connection = useTelemetryStore((state) => state.connection);
  const insights = useInsights();
  const [clock, setClock] = useState<string>("");

  useTelemetryConnection(() => { /* reconnection hook — queries refetch on their own intervals */ });

  useEffect(() => {
    const tick = () => setClock(new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  const gnaniMode = insights.data?.modes.gnani ?? "mock";
  const storeMode = insights.data?.modes.store ?? "sim";
  const credits = insights.data?.credits;

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <path d="M3 12h2l2.2-6 3 12 2.6-9 2.2 6.2 1.6-3.2H21" />
            </svg>
          </span>
          <div>
            <div className="brand-name">Dhwani-Raksha <span className="brand-name-omega">Ω</span></div>
            <div className="brand-edition">MUDRA-VANI OMEGA · GNANI SPEECH API</div>
          </div>
        </div>

        <span className="topbar-divider" />

        <button className="command-trigger" onClick={() => setCommandOpen(true)} aria-label="Open command palette">
          <Search size={14} />
          <span className="command-label" style={{ flex: 1, textAlign: "left", fontSize: 11 }}>Search command center</span>
          <kbd className="keycap">⌘K</kbd>
        </button>

        <nav className="workflow-tabs" aria-label="Workflows">
          <button
            className="workflow-tab"
            data-active={!activeWorkflow}
            style={{ color: !activeWorkflow ? "var(--text-1)" : undefined }}
            onClick={() => { setWorkflow(WORKFLOW_ORDER[0]); }}
          >
            {pathname === "/" ? "Overview" : "Back to HUD"}
          </button>
          {WORKFLOW_ORDER.map((domain) => (
            <button
              key={domain}
              className={`workflow-tab ${activeWorkflow === domain && pathname === "/" ? "active" : ""}`}
              onClick={() => setWorkflow(domain)}
              title={WORKFLOWS[domain].scenario}
            >
              {WORKFLOWS[domain].label}
            </button>
          ))}
        </nav>

        <div className="top-actions">
          <span className="status-chip desktop-action" title="Gnani API mode">
            <span className={`led ${gnaniMode === "live" ? "live" : "warn"}`} />
            GNANI <strong>{gnaniMode.toUpperCase()}</strong>
          </span>
          <span className="status-chip desktop-action" title="Supabase mode">
            <span className={`led ${storeMode === "live" ? "live" : "warn"}`} />
            STORE <strong>{storeMode.toUpperCase()}</strong>
          </span>
          <span className="status-chip desktop-action" title="Credit firewall">
            <span className={`led ${credits && credits.remaining < 400 ? "down" : "live"}`} />
            <strong>{credits ? `${credits.remaining.toFixed(0)}` : "3000"}</strong>/3000 CR
          </span>
          <span className="status-chip" title="Telemetry stream">
            <span className={`led ${connection === "live" ? "live" : "warn"}`} />
            <span className="mono">{clock || "--:--:--"}</span>
            <span style={{ color: "var(--text-3)" }}>IST</span>
          </span>
          <button className="icon-button desktop-action" onClick={() => setTheme(theme === "raat" ? "din" : "raat")} aria-label="Switch theme" title="Switch theme">
            {theme === "raat" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button className="icon-button desktop-action" onClick={() => setCommandOpen(true)} aria-label="Command palette" title="Command palette">
            <Command size={15} />
          </button>
          <button className={`icon-button ${rightRailOpen ? "" : ""}`} onClick={toggleRightRail} aria-label="Toggle telemetry rail" title="Toggle telemetry rail" style={{ color: rightRailOpen ? "var(--ember)" : undefined }}>
            <PanelRight size={15} />
          </button>
          <button className="avatar-button" aria-label="Session" title="Zero-password biometric escrow session">
            <Gauge size={15} />
          </button>
        </div>
      </header>
      {gnaniMode === "mock" ? (
        <div className="mock-ribbon" role="status">
          Mock mode · 3,000 Gnani credits protected · every panel streams real data with simulated upstream
        </div>
      ) : null}
      {pathname === "/" ? (
        <span className="sr-only">
          <Bell size={1} />
        </span>
      ) : null}
    </>
  );
}
