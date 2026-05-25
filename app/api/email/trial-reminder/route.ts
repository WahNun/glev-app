/**
 * POST /api/email/trial-reminder
 *
 * Sends the "trial started" confirmation email via Resend.
 * Called fire-and-forget from POST /api/auth/free-trial.
 *
 * Payload: { user_id: string, email: string, name?: string, trial_end_at: string }
 *
 * TODO: uncomment the Resend block below once RESEND_API_KEY is set in Vercel.
 * Until then the route renders the HTML (for smoke-testing) and returns { ok: true, stub: true }.
 */
import { NextRequest, NextResponse } from "next/server";
import { trialStartedHtml, trialStartedSubject } from "@/lib/emails/trial-started";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    user_id?: string;
    email?: string;
    name?: string;
    trial_end_at?: string;
  };

  const { user_id, email, name, trial_end_at } = body;

  if (!email || !trial_end_at) {
    console.warn("[trial-reminder] missing required fields", { user_id, email, trial_end_at });
    return NextResponse.json({ ok: false, error: "missing fields" }, { status: 400 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://glev.app";
  const subject = trialStartedSubject(name ?? email);
  const html = trialStartedHtml(name ?? email, trial_end_at, appUrl, "de");

  console.log("[trial-reminder] rendered email", {
    to: email,
    subject,
    trial_end_at,
    html_length: html.length,
  });

  // ── Resend send (activate once RESEND_API_KEY is in Vercel env) ────────────
  // const resendKey = process.env.RESEND_API_KEY;
  // if (resendKey) {
  //   const { Resend } = await import("resend");
  //   const resend = new Resend(resendKey);
  //   const { error } = await resend.emails.send({
  //     from: "Lucas von Glev <hello@glev.app>",
  //     to: email,
  //     subject,
  //     html,
  //   });
  //   if (error) {
  //     console.error("[trial-reminder] resend error", error);
  //     return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
  //   }
  //   return NextResponse.json({ ok: true });
  // }
  // ──────────────────────────────────────────────────────────────────────────

  return NextResponse.json({ ok: true, stub: true });
}
