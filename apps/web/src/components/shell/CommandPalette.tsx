"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Command } from "cmdk";
import { ArrowRight, FlaskConical, Layers, Mic, Moon, Receipt, Search, Settings2, Sparkles, Sun, Users, Waves } from "lucide-react";
import { useUiStore } from "@/lib/ui-store";
import { WORKFLOWS, WORKFLOW_ORDER } from "@/lib/server/catalog";

/** ⌘K surface. Every entry performs a real action or navigates to real data. */
export function CommandPalette() {
  const open = useUiStore((state) => state.commandOpen);
  const setOpen = useUiStore((state) => state.setCommandOpen);
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  const setWorkflow = useUiStore((state) => state.setWorkflow);
  const lowBandwidth = useUiStore((state) => state.lowBandwidth);
  const setLowBandwidth = useUiStore((state) => state.setLowBandwidth);
  const router = useRouter();
  const [query, setQuery] = useState("");

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(!open);
      }
      if (event.key === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, setOpen]);

  const run = (action: () => void) => { action(); setOpen(false); setQuery(""); };

  const commands = useMemo(() => [
    { group: "Workflows", items: WORKFLOW_ORDER.map((domain) => ({
      id: `wf-${domain}`, label: `Focus ${WORKFLOWS[domain].label}`, hint: WORKFLOWS[domain].kicker, icon: Layers,
      action: () => { setWorkflow(domain); router.push("/"); },
    })) },
    { group: "Pages", items: [
      { id: "hud", label: "Command HUD", hint: "Mission control", icon: Waves, action: () => router.push("/") },
      { id: "arena", label: "Voice Arena", hint: "10-language clone playground", icon: Sparkles, action: () => router.push("/arena") },
      { id: "ledger", label: "Boli-Patra Ledger", hint: "Hash-chained receipts", icon: Receipt, action: () => router.push("/ledger") },
      { id: "verify", label: "Voiceprint vault", hint: "Enrol and verify identities", icon: Users, action: () => router.push("/verify") },
      { id: "conformance", label: "Conformance lab", hint: "Run the protocol suite", icon: FlaskConical, action: () => router.push("/conformance") },
      { id: "settings", label: "Configuration", hint: "Modes, keys, budgets", icon: Settings2, action: () => router.push("/settings") },
    ] },
    { group: "Controls", items: [
      { id: "theme", label: theme === "raat" ? "Switch to din (light) theme" : "Switch to raat (dark) theme", hint: "Appearance", icon: theme === "raat" ? Sun : Moon, action: () => setTheme(theme === "raat" ? "din" : "raat") },
      { id: "bw", label: lowBandwidth ? "Disable low-bandwidth mode" : "Enable low-bandwidth mode", hint: "2G / EDGE simulation", icon: Mic, action: () => setLowBandwidth(!lowBandwidth) },
    ] },
  ], [router, setTheme, theme, lowBandwidth, setLowBandwidth, setWorkflow]);

  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <Command label="Command palette" className="dialog" loop>
        <div className="command-input-wrap">
          <Search size={15} className="subtle" />
          <Command.Input value={query} onValueChange={setQuery} placeholder="Jump to a workflow, receipt, voiceprint or control…" className="command-input" autoFocus />
          <kbd className="keycap">ESC</kbd>
        </div>
        <Command.List className="command-results">
          <Command.Empty style={{ padding: 18, color: "var(--text-3)", fontSize: 11 }}>No matching action.</Command.Empty>
          {commands.map((group) => (
            <Command.Group key={group.group} heading={<span className="command-group-label">{group.group}</span>}>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Command.Item key={item.id} className="command-item" onSelect={() => run(item.action)}>
                    <Icon size={15} />
                    <span style={{ flex: 1 }}>{item.label}</span>
                    <span style={{ fontSize: 9, color: "var(--text-3)" }}>{item.hint}</span>
                    <ArrowRight size={12} className="subtle" />
                  </Command.Item>
                );
              })}
            </Command.Group>
          ))}
        </Command.List>
      </Command>
    </div>
  );
}
