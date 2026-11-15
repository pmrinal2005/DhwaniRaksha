/**
 * GET /api/livekit/token?room=...&identity=...&name=...
 * Mints a short-lived LiveKit join token (HS256 JWT) — never in the browser.
 * Returns 501 with `configured: false` when LIVEKIT_* keys are absent, which the
 * HUD surfaces as "bridge offline" instead of a broken room.
 */
import { NextResponse } from "next/server";
import { createHmac, randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function signJwt(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(`${encodedHeader}.${encodedPayload}`).digest();
  return `${encodedHeader}.${encodedPayload}.${base64url(signature)}`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const secret = process.env.LIVEKIT_API_SECRET?.trim();
  const serverUrl = process.env.LIVEKIT_URL?.trim();
  const room = (url.searchParams.get("room") ?? "dhwani-arena").slice(0, 64);
  const identity = (url.searchParams.get("identity") ?? `guest-${randomUUID().slice(0, 8)}`).slice(0, 64);
  const name = (url.searchParams.get("name") ?? identity).slice(0, 64);

  if (!apiKey || !secret || !serverUrl) {
    return NextResponse.json({
      ok: false,
      configured: false,
      room,
      identity,
      message: "LiveKit Cloud keys are not configured. The HUD keeps the dual-voice bridge in single-browser split-view mode.",
      source: "computed",
      exactness: "exact",
    }, { status: 501 });
  }

  const now = Math.floor(Date.now() / 1000);
  const token = signJwt({
    iss: apiKey,
    sub: identity,
    name,
    nbf: now - 5,
    exp: now + 60 * 60 * 2,
    jti: randomUUID(),
    video: {
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
    metadata: JSON.stringify({ app: "dhwani-raksha", room }),
  }, secret);

  return NextResponse.json({
    ok: true,
    configured: true,
    token,
    room,
    identity,
    server_url: serverUrl,
    expires_in: 7200,
    source: "livekit",
    exactness: "exact",
  });
}
