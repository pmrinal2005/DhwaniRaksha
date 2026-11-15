"use client";

import { useEffect, useRef } from "react";
import { Room, RoomEvent, ConnectionQuality, type Participant } from "livekit-client";
import { toast } from "sonner";


export function useLiveKitParticipants() {
  const roomRef = useRef<Room | null>(null);
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
    const roomName = process.env.NEXT_PUBLIC_LIVEKIT_ROOM;
    const tokenEndpoint = process.env.NEXT_PUBLIC_LIVEKIT_TOKEN_ENDPOINT;
    if (!url || !roomName || !tokenEndpoint) return;
    let disposed = false;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    const publishParticipants = () => {
      const participants = [room.localParticipant, ...room.remoteParticipants.values()];
      participants.forEach((participant: Participant) => {
        const event = {
          type: "livekit.participant", ts: new Date().toISOString(), source: "livekit", exactness: "exact",
          payload: { id: participant.identity, name: participant.name || participant.identity, speaking: participant.isSpeaking, connection_quality: ConnectionQuality[participant.connectionQuality] ?? "unknown", metadata: participant.metadata },
        };
        // LiveKit is kept separate until the dashboard contract has a matching event.
        window.dispatchEvent(new CustomEvent("mudra:livekit", { detail: event }));
      });
    };
    const events = [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.ActiveSpeakersChanged, RoomEvent.ConnectionQualityChanged, RoomEvent.ParticipantMetadataChanged];
    events.forEach((event) => room.on(event, publishParticipants));
    const connect = async () => {
      try {
        const response = await fetch(`${tokenEndpoint}?room=${encodeURIComponent(roomName)}`, { credentials: "include" });
        if (!response.ok) throw new Error(`LiveKit token endpoint returned ${response.status}`);
        const body = await response.json() as { token?: string };
        if (!body.token) throw new Error("LiveKit token response did not contain a token.");
        if (!disposed) { await room.connect(url, body.token); publishParticipants(); }
      } catch (error) { if (!disposed) toast.error(error instanceof Error ? error.message : "LiveKit room could not be joined."); }
    };
    void connect();
    return () => { disposed = true; events.forEach((event) => room.off(event, publishParticipants)); void room.disconnect(); roomRef.current = null; };
  }, []);
}
