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
 * Body (optional): `{ scope: "glucose" | "iob" | "history",
 * granted: boolean }` — toggles a granular sub-scope on
 * `profiles.ai_consent_{glucose,iob,history}_at` instead of touching
 * the master `ai_consent_at`. See DECISIONS.md D-016.
 *
 * Returns the persisted `ai_consent_at` timestamp so the client can
 * optimistically flip its local consent state without a separate read.
 */
const CONSENT_VERSION = "v1.0";

type Scope = "glucose" | "iob" | "history";
const SCOPE_COLUMN: Record<Scope, "ai_consent_glucose_at" | "ai_consent_iob_at" | "ai_consent_history_at"> = {
  glucose: "ai_consent_glucose_at",
  iob:     "ai_consent_iob_at",
  history: "ai_consent_history_at",
};

export async function POST(req: NextRequest) {
  const auth = await authedClient(req);
  if (!auth.user || !auth.sb) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const { sb, user } = auth;

  // Gate: user must have ai_voice flag enabled by an admin.
  const { data: settingsRow } = await sb
    .from("user_settings")
    .select("feature_flags")
    .eq("user_id", user.id)
    .maybeSingle();
  const flags = (settingsRow?.feature_flags ?? {}) as Record<string, unknown>;
  if (flags.ai_voice !== true) {
    return NextResponse.json({ error: "not available" }, { status: 403 });
  }

  // Optional sub-scope toggle. Body parse is best-effort: a missing or
  // malformed body falls back to the legacy "grant master consent"
  // path so existing callers (the consent modal) keep working.
  let scope: Scope | null = null;
  let granted = true;
  try {
    const body = await req.json();
    if (body && typeof body === "object") {
      const s = (body as { scope?: unknown }).scope;
      if (s === "glucose" || s === "iob" || s === "history") {
        scope = s;
      }
      const g = (body as { granted?: unknown }).granted;
      if (typeof g === "boolean") granted = g;
    }
  } catch { /* no body → master-consent path */ }

  if (scope) {
    // Granular sub-scope toggle. We refuse to write a sub-scope if the
    // master consent isn't already granted — the sub-toggles live
    // logically underneath the master switch and would otherwise leak
    // a half-consented state.
    const { data: prof, error: profErr } = await sb
      .from("profiles")
      .select("ai_consent_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (profErr) {
      return NextResponse.json({ error: profErr.message }, { status: 500 });
    }
    if (!prof?.ai_consent_at) {
      return NextResponse.json({ error: "master ai consent required" }, { status: 409 });
    }
    const column = SCOPE_COLUMN[scope];
    const value = granted ? new Date().toISOString() : null;
    const { data, error } = await sb
      .from("profiles")
      .update({ [column]: value })
      .eq("user_id", user.id)
      .select(column)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    // Supabase's generated row type narrows `select(column)` to a union
    // per column key, so the indexer can't be typed statically against
    // the union. Cast the row to a generic record for the read-back —
    // the column value is always `string | null` (TIMESTAMPTZ).
    const persisted = (data as Record<string, string | null> | null)?.[column] ?? value;
    return NextResponse.json({ scope, [column]: persisted });
  }

  // Master-consent grant (legacy path).
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
 * Revokes Glev AI consent: nulls `profiles.ai_consent_at`,
 * `profiles.ai_consent_version`, AND all granular sub-scopes
 * (glucose / IOB / history) so the next re-onboarding starts from a
 * clean slate. Called from the Settings "Glev AI" master toggle when
 * the user turns the feature off, and from the destructive "Revoke
 * all" button under the new Glev Intelligence section. The next
 * floating-AI-button tap will then re-show the consent modal (the
 * `useGlevAI` hook reads `ai_consent_at` and treats `null` as "needs
 * modal").
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
      ai_consent_glucose_at: null,
      ai_consent_iob_at: null,
      ai_consent_history_at: null,
    })
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ai_consent_at: null,
    ai_consent_version: null,
    ai_consent_glucose_at: null,
    ai_consent_iob_at: null,
    ai_consent_history_at: null,
  });
}
