/**
 * POST /api/auth/activate-trial
 *
 * Wird nach dem ersten erfolgreichen verifyOtp/exchangeCodeForSession
 * auf der Confirm-Seite aufgerufen. Setzt trial_start_at = NOW() und
 * trial_end_at = NOW() + 7 Tage für qualifizierte Meta-Lead-User.
 *
 * Eligibility-Gate: Nur User mit `profiles.signup_source = 'meta_lead'`
 * erhalten hier einen Trial. Alle anderen User (Direktanmeldungen, Stripe-
 * Käufer, Referral-Signups etc.) werden mit `{ ok: true, not_eligible: true }`
 * zurückgewiesen — kein DB-Write, kein Error.
 *
 * Idempotenz (drei Fälle):
 *   1. trial_start_at bereits gesetzt → kein Write, return already_active
 *   2. trial_end_at gesetzt, trial_start_at null (Legacy-User vor Migration)
 *      → nur trial_start_at backfill = trial_end_at − 7 Tage, trial_end_at bleibt
 *   3. Beide null (neu aktivierender Meta-Lead) → beide setzen + scheduleTrialEmails
 *
 * Auth: Bearer token aus dem frisch etablierten Session-Token oder Cookie.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { scheduleTrialEmails } from "@/lib/emails/drip-scheduler";
import type { EmailLocale } from "@/lib/emails/beta-welcome";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

async function resolveUser(req: NextRequest) {
  const url  = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  // 1. Bearer token (client-side POST nach verifyOtp)
  const auth = req.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ")) {
    const token = auth.slice(7);
    const sb = createClient(url, anon);
    const { data: { user }, error } = await sb.auth.getUser(token);
    if (!error && user) return user;
  }

  // 2. Cookie session (SSR / web)
  const cookieStore = await cookies();
  const all = cookieStore.getAll();
  if (all.length > 0) {
    const sb = createServerClient(url, anon, {
      cookies: {
        getAll: () => all.map((c) => ({ name: c.name, value: c.value })),
        setAll: () => {},
      },
    });
    const { data: { user } } = await sb.auth.getUser();
    if (user) return user;
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const user = await resolveUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getSupabaseAdmin();

    // Profil laden — prüfen ob der User ein Meta-Lead ist und ob der Trial
    // bereits (teilweise) gesetzt wurde.
    const { data: profile } = await admin
      .from("profiles")
      .select("signup_source, trial_start_at, trial_end_at")
      .eq("user_id", user.id)
      .maybeSingle();

    // Eligibility-Gate: nur Meta-Lead-User qualifizieren sich.
    // Alle anderen Signup-Quellen (direkt, Stripe, Referral, Admin ohne Quelle)
    // haben eigene Trial/Subscription-Flows und dürfen hier keinen Trial erhalten.
    if (profile?.signup_source !== "meta_lead") {
      return NextResponse.json({ ok: true, not_eligible: true });
    }

    // Idempotenz-Fall 1: trial_start_at bereits gesetzt → nichts tun.
    if (profile?.trial_start_at) {
      return NextResponse.json({ ok: true, already_active: true });
    }

    // Idempotenz-Fall 2: Legacy-User (trial_end_at gesetzt, trial_start_at null).
    // Diese User wurden vor der Migration (20260601_add_trial_start_at.sql) über
    // den Webhook provisioniert. trial_end_at ist bereits korrekt — wir backfill
    // nur trial_start_at = trial_end_at − 7 Tage und leiten scheduleTrialEmails NICHT
    // erneut aus (Drip-Mails wurden damals beim Webhook-Eingang scheduliert).
    if (profile?.trial_end_at) {
      const legacyStart = new Date(
        new Date(profile.trial_end_at).getTime() - SEVEN_DAYS_MS,
      ).toISOString();
      await admin
        .from("profiles")
        .update({ trial_start_at: legacyStart })
        .eq("user_id", user.id);
      // eslint-disable-next-line no-console
      console.log("[activate-trial] legacy backfill:", { userId: user.id, trial_start_at: legacyStart });
      return NextResponse.json({ ok: true, backfilled: true, trial_start_at: legacyStart });
    }

    // Normaler Fall: beide null → frischer Meta-Lead aktiviert sich zum ersten Mal.
    const trialStartAt = new Date();
    const trialEndAt = new Date(trialStartAt.getTime() + SEVEN_DAYS_MS).toISOString();

    const { error: upsertErr } = await admin
      .from("profiles")
      .update({
        trial_start_at: trialStartAt.toISOString(),
        trial_end_at: trialEndAt,
      })
      .eq("user_id", user.id);

    if (upsertErr) {
      // eslint-disable-next-line no-console
      console.error("[activate-trial] update error:", upsertErr);
      return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }

    const email = user.email;
    const name  = (user.user_metadata?.full_name as string | undefined) ?? null;

    const acceptLang = req.headers.get("accept-language") ?? "";
    const locale: EmailLocale = acceptLang.toLowerCase().startsWith("en") ? "en" : "de";

    if (email) {
      scheduleTrialEmails(email, name, trialStartAt, locale).catch((e) => {
        // eslint-disable-next-line no-console
        console.error("[activate-trial] scheduleTrialEmails failed:", e);
      });
    }

    // eslint-disable-next-line no-console
    console.log("[activate-trial] trial activated:", {
      userId: user.id,
      trialStartAt: trialStartAt.toISOString(),
      trialEndAt,
    });

    return NextResponse.json({
      ok: true,
      trial_start_at: trialStartAt.toISOString(),
      trial_end_at: trialEndAt,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[activate-trial] unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
