"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import {
  Activity, BookOpenCheck, FlaskConical, Gauge, LayoutDashboard, Mic, Receipt, Settings2, Sparkles, TerminalSquare, Users,
} from "lucide-react";
import { useUiStore } from "@/lib/ui-store";

const LINKS = [
  { href: "/", label: "Command HUD", icon: LayoutDashboard },
  { href: "/arena", label: "Voice Arena", icon: Sparkles },
  { href: "/ledger", label: "Boli-Patra Ledger", icon: Receipt },
] as const;

const UTILITY = [
  { href: "/verify", label: "Voiceprint vault", icon: Users },
  { href: "/conformance", label: "Conformance lab", icon: FlaskConical },
  { href: "/settings", label: "Configuration", icon: Settings2 },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const expanded = useUiStore((state) => state.sidebarExpanded);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const micArmed = useUiStore((state) => state.micArmed);

  const renderLink = (link: { href: string; label: string; icon: typeof Gauge }) => {
    const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
    const Icon = link.icon;
    return (
      <Link key={link.href} href={link.href as Route} className={`rail-link ${active ? "active" : ""}`} title={link.label} aria-label={link.label} aria-current={active ? "page" : undefined}>
        <Icon size={17} strokeWidth={1.8} />
        <span className="rail-label">{link.label}</span>
      </Link>
    );
  };

  return (
    <nav className="left-rail" aria-label="Primary">
      <button className="rail-link" onClick={toggleSidebar} aria-label={expanded ? "Collapse navigation" : "Expand navigation"} title="Expand / collapse">
        <Activity size={17} strokeWidth={1.8} />
        <span className="rail-label">Collapse</span>
      </button>
      <div className="rail-separator" />
      <div className="rail-nav">
        {LINKS.map(renderLink)}
        <div className="rail-separator" />
        {UTILITY.map(renderLink)}
      </div>
      <div className="rail-bottom">
        <span className={`rail-link ${micArmed ? "" : ""}`} style={{ cursor: "default", color: micArmed ? "var(--ember)" : undefined }} title={micArmed ? "Microphone armed — VAD gate active" : "Microphone idle"}>
          <Mic size={17} strokeWidth={1.8} className={micArmed ? "pulse" : ""} />
          <span className="rail-label">{micArmed ? "Mic armed" : "Mic idle"}</span>
        </span>
        <a className="rail-link" href="https://docs.gnani.ai/api/introduction/introduction" target="_blank" rel="noreferrer" title="Gnani API reference">
          <BookOpenCheck size={17} strokeWidth={1.8} />
          <span className="rail-label">Gnani docs</span>
        </a>
        <span className="rail-link" title="Build hash" style={{ cursor: "default" }}>
          <TerminalSquare size={17} strokeWidth={1.8} />
          <span className="rail-label">v1.0.0 · omega</span>
        </span>
      </div>
    </nav>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const items = [...LINKS, UTILITY[1]];
  return (
    <nav className="mobile-nav" aria-label="Mobile">
      {items.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link key={item.href} href={item.href} className={`rail-link ${active ? "active" : ""}`} aria-label={item.label}>
            <Icon size={18} strokeWidth={1.8} />
          </Link>
        );
      })}
    </nav>
  );
}
