import { NextRequest, NextResponse } from "next/server";
import { authedClient } from "@/app/api/insulin/_helpers";

/**
 * POST /api/ai/consent
 *
 * Writes `profiles.ai_consent_at = NOW()` and
 * `profiles.ai_consent_version = 'v1.0'` for the authed user. Used by
 * the consent modal's "Aktivieren →" button (see useGlevAI hook /
 * GlevAIConsentModal). The legacy `user_settings.ai_consent` boolean is
 * intentionally NOT touched here — see DECISIONS.md D-013 for the
 * rationale (timestamped+versioned consent on `profiles` is the new
 * source of truth; the old column will be retired in a later cleanup
 * task).
 *
 * Returns the persisted `ai_consent_at` timestamp so the client can
 * optimistically flip its local consent state without a separate read.
 */
const CONSENT_VERSION = "v1.0";

export async function POST(req: NextRequest) {
  const auth = await authedClient(req);
  if (!auth.user || !auth.sb) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const { sb, user } = auth;

  const { data, error } = await sb
    .from("profiles")
    .update({
      ai_consent_at: new Date().toISOString(),
      ai_consent_version: CONSENT_VERSION,
    })
    .eq("user_id", user.id)
    .select("ai_consent_at, ai_consent_version")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    // No `profiles` row yet — fall back to insert. (Newer users get one
    // on signup, but very old accounts predate that trigger.)
    const { data: ins, error: insErr } = await sb
      .from("profiles")
      .insert({
        user_id: user.id,
        ai_consent_at: new Date().toISOString(),
        ai_consent_version: CONSENT_VERSION,
      })
      .select("ai_consent_at, ai_consent_version")
      .maybeSingle();
    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
    return NextResponse.json({
      ai_consent_at: ins?.ai_consent_at ?? new Date().toISOString(),
      ai_consent_version: ins?.ai_consent_version ?? CONSENT_VERSION,
    });
  }

  return NextResponse.json({
    ai_consent_at: data.ai_consent_at,
    ai_consent_version: data.ai_consent_version,
  });
}

/**
 * DELETE /api/ai/consent
 *
 * Revokes Glev AI consent: nulls both `profiles.ai_consent_at` and
 * `profiles.ai_consent_version`. Called from the Settings "Glev AI"
 * toggle when the user turns the feature off. The next floating-AI-
 * button tap will then re-show the consent modal (the `useGlevAI`
 * hook reads `ai_consent_at` and treats `null` as "needs modal").
 *
 * The chat history itself is NOT stored server-side (Phase 2 only
 * persists in sessionStorage — see DECISIONS.md D-013), so the
 * client is responsible for clearing the sessionStorage bucket.
 *
 * Returns the post-update `ai_consent_at` (always `null`) so the
 * client can confirm the wipe landed.
 */
export async function DELETE(req: NextRequest) {
  const auth = await authedClient(req);
  if (!auth.user || !auth.sb) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const { sb, user } = auth;

  const { error } = await sb
    .from("profiles")
    .update({
      ai_consent_at: null,
      ai_consent_version: null,
    })
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ai_consent_at: null, ai_consent_version: null });
}
