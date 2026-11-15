"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useUiStore } from "@/lib/ui-store";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { MobileNav, Sidebar } from "@/components/shell/Nav";
import { TelemetryRail } from "@/components/shell/TelemetryRail";
import { Topbar } from "@/components/shell/Topbar";

/** Below 1500px the telemetry rail becomes a fixed drawer — this scrim makes that
 *  explicit instead of letting it look like clipped page content. It is only
 *  mounted while the rail is open, and only ever paints below 1500px. */
function RailScrim() {
  const toggleRightRail = useUiStore((state) => state.toggleRightRail);
  return <button className="rail-scrim" aria-label="Close telemetry rail" onClick={toggleRightRail} />;
}

export function AppShell({ children, hideRail = false }: { children: ReactNode; hideRail?: boolean }) {
  const theme = useUiStore((state) => state.theme);
  const sidebarExpanded = useUiStore((state) => state.sidebarExpanded);
  const rightRailOpen = useUiStore((state) => state.rightRailOpen);
  const [narrowViewport, setNarrowViewport] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    // The telemetry rail is a fixed drawer only below 1500px; track that breakpoint
    // so the scrim exists exactly when the drawer can overlay content.
    const query = window.matchMedia("(max-width: 1500px)");
    const sync = () => {
      setNarrowViewport(query.matches);
      // A persisted "rail open" would otherwise launch a phone/tablet straight into
      // a full-bleed drawer. Below 1500px the rail starts closed and is opt-in.
      if (query.matches) useUiStore.getState().closeRightRail();
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return (
    <div className="app-canvas">
      <Topbar />
      <div className={`workspace ${sidebarExpanded ? "rail-expanded" : ""} ${rightRailOpen && !hideRail ? "" : "right-closed"}`}>
        <Sidebar />
        <main className="dashboard-main">{children}</main>
        {hideRail ? null : <TelemetryRail />}
        {rightRailOpen && !hideRail && narrowViewport && <RailScrim />}
      </div>
      <MobileNav />
      <CommandPalette />
    </div>
  );
}
