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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email ?? "").trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ ok: true });
    }

    const sb = getSupabaseAdmin();
    const rawAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
    const appUrl = (rawAppUrl || "https://glev.app").replace(/\/$/, "");

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

    await enqueueEmail({
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
