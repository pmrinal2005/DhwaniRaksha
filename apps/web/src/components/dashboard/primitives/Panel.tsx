"use client";

import { useEffect, type MouseEvent, type ReactNode } from "react";
import { motion } from "motion/react";
import { useUiStore } from "@/lib/ui-store";
import { useTelemetryStore } from "@/lib/telemetry/store";

export function Panel({ id, title, subtitle, kicker, icon, actions, children, className = "", sourcePath, mock = false, hero = false }: {
  id: string; title: string; subtitle?: string; kicker?: string; icon?: ReactNode; actions?: ReactNode; children: ReactNode;
  className?: string; sourcePath: string; mock?: boolean; hero?: boolean;
}) {
  const auditOpen = useUiStore((state) => state.auditOpen);
  const audit = useTelemetryStore((state) => state.audit[sourcePath] ?? state.audit[id]);
  const registerAudit = useTelemetryStore((state) => state.registerAudit);
  useEffect(() => { registerAudit(id, sourcePath); }, [id, sourcePath, registerAudit]);
  const trackPointer = (event: MouseEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--pointer-x", `${event.clientX - bounds.left}px`);
    event.currentTarget.style.setProperty("--pointer-y", `${event.clientY - bounds.top}px`);
  };
  return (
    <motion.section layout id={id} className={`panel ${className} ${mock ? "mock" : ""} ${auditOpen ? "audit" : ""} ${hero ? "voice-hero" : ""}`} onMouseMove={trackPointer} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .5 }} aria-label={title}>
      <header className="panel-header">
        <div>
          {kicker && <div className="panel-kicker">{kicker}</div>}
          <h2 className="panel-title">{icon}{title}</h2>
          {subtitle && <p className="panel-subtitle">{subtitle}</p>}
        </div>
        {actions && <div style={{ display: "flex", alignItems: "center", gap: 6 }}>{actions}</div>}
      </header>
      {children}
      {auditOpen && <aside className="audit-tag" aria-label={`Provenance for ${title}`}>
        <span className="ember">{audit?.sourcePath ?? sourcePath}</span><br />
        {audit?.source ?? "unavailable"} · {audit?.updates ?? 0} updates<br />
        {audit?.lastUpdate ?? "no payload received"}
      </aside>}
    </motion.section>
  );
}

export function PanelContent({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`panel-content ${className}`}>{children}</div>;
}
