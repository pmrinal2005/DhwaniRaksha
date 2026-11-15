"use client";

import { create } from "zustand";

/** Cross-panel carrier for the current 768-d embedding and its verification/cloak results. */
interface VoiceprintState {
  vector: number[] | null;
  digest: string | null;
  handle: string | null;
  source: "gnani" | "mock" | null;
  cosine: number | null;
  band: "verified" | "noisy_warning" | "rejected" | null;
  compareVector: number[] | null;
  compareHandle: string | null;
  cloakedVector: number[] | null;
  angleDeg: number | null;
  relinkCosine: number | null;
  setEmbedding: (input: { vector: number[]; digest: string; handle: string; source: "gnani" | "mock" }) => void;
  setVerification: (input: { cosine: number; band: "verified" | "noisy_warning" | "rejected"; compareVector: number[] | null; compareHandle: string | null }) => void;
  setCloak: (input: { vector: number[]; angleDeg: number; relinkCosine: number }) => void;
  clearCloak: () => void;
}

export const useVoiceprintStore = create<VoiceprintState>((set) => ({
  vector: null, digest: null, handle: null, source: null,
  cosine: null, band: null, compareVector: null, compareHandle: null,
  cloakedVector: null, angleDeg: null, relinkCosine: null,
  setEmbedding: ({ vector, digest, handle, source }) => set({ vector, digest, handle, source }),
  setVerification: ({ cosine, band, compareVector, compareHandle }) => set({ cosine, band, compareVector, compareHandle }),
  setCloak: ({ vector, angleDeg, relinkCosine }) => set({ cloakedVector: vector, angleDeg, relinkCosine }),
  clearCloak: () => set({ cloakedVector: null, angleDeg: null, relinkCosine: null }),
}));
