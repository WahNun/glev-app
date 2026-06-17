/**
 * POST /api/auth/free-trial
 *
 * Called immediately after a free-trial signup (no Stripe).
 * Sets profiles.trial_end_at = NOW() + 7 days for the authenticated user,
 * then:
 *   - Enqueues the bilingual trial-welcome email via the outbox (reliable,
 *     retry-capable, deduplicated).
 *   - Schedules trial_day6_reminder + trial_expired in email_drip_schedule
 *     via scheduleTrialEmails() so the daily drip cron picks them up.
 *
 * Auth: Bearer token from supabase.auth.getSession() on the client,
 * or session cookie (web).
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { enqueueEmail } from "@/lib/emails/outbox";
import { scheduleTrialEmails } from "@/lib/emails/drip-scheduler";
import { trackEvent } from "@/lib/capi-events";

async function resolveUser(req: NextRequest) {
  const url  = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  // 1. Bearer token (native / client-side POST)
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

    // Set trial_start_at = now, trial_end_at = 7 days from now
    const trialStartAt = new Date();
    const trialEndAt = new Date(trialStartAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { error } = await admin
      .from("profiles")
      .upsert(
        {
          user_id: user.id,
          trial_start_at: trialStartAt.toISOString(),
          trial_end_at: trialEndAt,
        },
        { onConflict: "user_id" }
      );

    if (error) {
      console.error("[free-trial] upsert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const email = user.email;
    const name  = (user.user_metadata?.full_name as string | undefined) ?? null;

    // CAPI StartTrial via Layer-One Gateway.
    // event_id=trial-{userId} dedupliziert Doppelaufrufe (auth/callback + Client).
    if (email) {
      trackEvent("StartTrial", {
        user: { email, external_id: user.id },
        customData: {
          content_name: "Glev Free Trial",
          content_ids:  ["glev-free-trial"],
          content_type: "product",
        },
        eventId:   `trial-${user.id}`,
        sourceUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/signup`,
      }).catch((e) => console.warn("[free-trial] CAPI StartTrial failed (non-fatal):", e));
    }

    // Detect locale from Accept-Language header (best-effort)
    const acceptLang = req.headers.get("accept-language") ?? "";
    const locale = acceptLang.toLowerCase().startsWith("en") ? "en" as const : "de" as const;

    // Enqueue Day-0 welcome via outbox (immediate, retryable, deduped)
    if (email) {
      await enqueueEmail({
        recipient: email,
        template: "trial-welcome",
        payload: { name, trialEndsAt: trialEndAt, locale },
        dedupeKey: `trial-welcome:${user.id}`,
      }).catch((e) =>
        console.warn("[free-trial] enqueueEmail trial-welcome failed:", e)
      );
    }

    // Schedule Day-6 reminder + Day-7 expired via drip cron (fire-and-forget)
    if (email) {
      scheduleTrialEmails(email, name, trialStartAt, locale).catch((e) =>
        console.warn("[free-trial] scheduleTrialEmails failed:", e)
      );
    }

    return NextResponse.json({ ok: true, trial_end_at: trialEndAt });
  } catch (err) {
    console.error("[free-trial] unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
