"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { LAYOUT } from "@/components/dashboard/primitives/tokens";
import { useUiStore } from "@/lib/ui-store";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: LAYOUT.queryRetry, refetchOnWindowFocus: false } } }));
  const theme = useUiStore((state) => state.theme);
  return (
    <QueryClientProvider client={client}>
      <MotionConfig reducedMotion="user" transition={{ type: "spring", stiffness: 260, damping: 24 }}>
        {children}
        <Toaster theme={theme === "raat" ? "dark" : "light"} position="bottom-right" toastOptions={{ duration: LAYOUT.toastDuration }} />
      </MotionConfig>
    </QueryClientProvider>
  );
}
