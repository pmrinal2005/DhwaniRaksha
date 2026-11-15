import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TimeWindow } from "@/lib/telemetry/event-schema";

export type LanguageCode = "en" | "hi" | "mr" | "ta" | "te" | "kn" | "bn" | "gu" | "ml" | "pa";
export type Theme = "raat" | "din";

interface UiState {
  theme: Theme;
  language: LanguageCode;
  window: TimeWindow;
  activeWorkflow: string | null;
  workflowOrder: string[];
  sidebarExpanded: boolean;
  rightRailOpen: boolean;
  commandOpen: boolean;
  auditOpen: boolean;
  micArmed: boolean;
  lowBandwidth: boolean;
  flowMetric: "bytes" | "credits" | "latency";
  eventFilter: string | null;
  setTheme: (theme: Theme) => void;
  setLanguage: (language: LanguageCode) => void;
  setWindow: (window: TimeWindow) => void;
  setWorkflow: (workflow: string) => void;
  setWorkflowOrder: (order: string[]) => void;
  toggleSidebar: () => void;
  toggleRightRail: () => void;
  closeRightRail: () => void;
  setCommandOpen: (open: boolean) => void;
  toggleAudit: () => void;
  setMicArmed: (armed: boolean) => void;
  setLowBandwidth: (enabled: boolean) => void;
  setFlowMetric: (metric: UiState["flowMetric"]) => void;
  setEventFilter: (filter: string | null) => void;
}

export const useUiStore = create<UiState>()(persist((set) => ({
  theme: "raat", language: "en", window: "24h", activeWorkflow: null, workflowOrder: [],
  sidebarExpanded: false, rightRailOpen: true, commandOpen: false, auditOpen: false, micArmed: false,
  lowBandwidth: false, flowMetric: "bytes", eventFilter: null,
  setTheme: (theme) => set({ theme }),
  setLanguage: (language) => set({ language }),
  setWindow: (window) => set({ window }),
  setWorkflow: (activeWorkflow) => set({ activeWorkflow }),
  setWorkflowOrder: (workflowOrder) => set({ workflowOrder }),
  toggleSidebar: () => set((state) => ({ sidebarExpanded: !state.sidebarExpanded })),
  toggleRightRail: () => set((state) => ({ rightRailOpen: !state.rightRailOpen })),
  closeRightRail: () => set({ rightRailOpen: false }),
  setCommandOpen: (commandOpen) => set({ commandOpen }),
  toggleAudit: () => set((state) => ({ auditOpen: !state.auditOpen })),
  setMicArmed: (micArmed) => set({ micArmed }),
  setLowBandwidth: (lowBandwidth) => set({ lowBandwidth }),
  setFlowMetric: (flowMetric) => set({ flowMetric }),
  setEventFilter: (eventFilter) => set({ eventFilter }),
}), {
  name: "mudra-vani-ui",
  partialize: (state) => ({ theme: state.theme, language: state.language, window: state.window, workflowOrder: state.workflowOrder, lowBandwidth: state.lowBandwidth }),
  skipHydration: true,
}));
