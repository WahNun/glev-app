/**
 * POST /api/auth/password-reset
 *
 * Self-service "Passwort vergessen" endpoint called from the login page.
 * Uses Supabase Admin to generate a recovery link, then enqueues the
 * branded bilingual Glev reset email via the outbox (identical to the
 * admin-panel flow in app/glev-ops/users/actions.ts).
 *
 * Security:
 *  - Always returns { ok: true } — never reveals whether the address
 *    exists (prevents user enumeration).
 *  - No auth required (user is not logged in).
 *  - Rate-limiting delegated to Supabase (generateLink already applies
 *    per-user cooldowns on the auth side).
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { enqueueEmail } from "@/lib/emails/outbox";
import type { EmailLocale } from "@/lib/emails/beta-welcome";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Deps interface — lets unit tests inject fakes without standing up the
// Next runtime, Supabase, or Resend.
// ---------------------------------------------------------------------------

export type PasswordResetDeps = {
  /** Supabase admin client (service-role key). */
  sb: SupabaseClient;
  /** Enqueues the branded reset email — same signature as enqueueEmail. */
  enqueue: typeof enqueueEmail;
};

// ---------------------------------------------------------------------------
// Core handler — extracted so tests can drive it with mock deps.
// ---------------------------------------------------------------------------

/**
 * Core POST handler. Accepts the email address (already validated as a
 * non-empty RFC-like string) and the app base URL, plus injectable deps.
 *
 * Always returns `{ ok: true }` regardless of outcome — never leaks whether
 * the address exists (prevents user enumeration).
 *
 * Also imported directly by unit tests that mock the Supabase client and
 * enqueueEmail — same pattern as handleConfirmPost / handleInsulinPost.
 */
export async function handlePasswordResetPost(
  email: string,
  appUrl: string,
  { sb, enqueue }: PasswordResetDeps,
): Promise<NextResponse> {
  try {
    // ⚠️ DO NOT route through /auth/callback here — see DECISIONS.md § D-001.
    // This project uses Supabase Implicit Flow (no PKCE toggle). Supabase appends
    // the session as a hash fragment: /auth/confirm#access_token=…&type=recovery.
    // Hash fragments are browser-only; a server-side route like /auth/callback
    // never receives them and would drop the token. /auth/confirm is a client
    // component whose onAuthStateChange(PASSWORD_RECOVERY) listener handles this.
    const { data: linkData, error: linkErr } = await sb.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: `${appUrl}/auth/confirm` },
    });

    if (linkErr || !linkData?.properties?.action_link) {
      return NextResponse.json({ ok: true });
    }

    const resetUrl = linkData.properties.action_link;
    const userId = linkData.user?.id;

    let locale: EmailLocale = "de";
    let displayName: string | null = null;

    if (userId) {
      const { data: profileRow } = await sb
        .from("profiles")
        .select("language, display_name")
        .eq("user_id", userId)
        .maybeSingle();
      if (profileRow) {
        locale = profileRow.language === "en" ? "en" : "de";
        displayName = profileRow.display_name ?? null;
      }
    }

    await enqueue({
      recipient: email,
      template: "password-reset",
      payload: {
        name: displayName,
        resetUrl,
        appUrl,
        locale,
      },
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}

// ---------------------------------------------------------------------------
// Next.js route handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body?.email ?? "").trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ok: true });
  }

  const sb = getSupabaseAdmin();
  const rawAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const appUrl = (rawAppUrl || "https://glev.app").replace(/\/$/, "");

  return handlePasswordResetPost(email, appUrl, { sb, enqueue: enqueueEmail });
}
