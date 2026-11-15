"use client";

/** Shimmer card used while the 3D constellation chunk loads. */
export function VoiceprintConstellationFallback() {
  return (
    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }} aria-hidden="true">
      <div className="skeleton" style={{ width: 150, height: 150, borderRadius: "50%" }} />
    </div>
  );
}
