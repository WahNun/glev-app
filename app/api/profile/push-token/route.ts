/**
 * PATCH /api/profile/push-token
 *
 * Persists the device push token (FCM for Android, APNs for iOS) returned
 * by Capacitor's PushNotifications.registration event into the user's
 * profiles row. Called from lib/pushNotifications.ts immediately after
 * the native registration event fires.
 *
 * Body: { token: string; platform: "ios" | "android" }
 *
 * The endpoint is intentionally a PATCH (not PUT) — it only writes the
 * three push-token columns and leaves the rest of the profile untouched.
 *
 * Auth: cookie session (web) or Bearer token (native Capacitor shell).
 * Returns 204 No Content on success.
 */

import { NextRequest, NextResponse } from "next/server";
import { authedClient, badJson } from "@/app/api/insulin/_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_PLATFORMS = new Set(["ios", "android"]);

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const auth = await authedClient(req);
  if (!auth.user) return badJson("unauthorized", 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badJson("invalid json body", 400);
  }

  if (!body || typeof body !== "object") return badJson("body must be an object", 400);
  const { token, platform } = body as Record<string, unknown>;

  if (typeof token !== "string" || token.trim().length === 0) {
    return badJson("token is required and must be a non-empty string", 400);
  }
  if (!VALID_PLATFORMS.has(String(platform))) {
    return badJson("platform must be 'ios' or 'android'", 400);
  }

  const trimmedToken = token.trim();

  const { error } = await auth.sb
    .from("profiles")
    .update({
      push_token: trimmedToken,
      push_platform: platform as string,
      push_token_updated_at: new Date().toISOString(),
    })
    .eq("user_id", auth.user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
