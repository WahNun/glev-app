/**
 * GET /api/email/trial-reminder — Admin preview only.
 *
 * The POST handler that used to fire trial welcome emails has been replaced
 * by the outbox system. Sending now happens via:
 *   - Day 0 welcome  → enqueueEmail("trial-welcome") in /api/auth/free-trial
 *   - Day 6 reminder → email_drip_schedule (renderDripEmail "trial_day6_reminder")
 *   - Day 7 expired  → email_drip_schedule (renderDripEmail "trial_expired")
 *
 * Preview URLs (admin only):
 *   /api/email/trial-reminder?template=welcome&name=Lucas&trial_end_at=2026-06-03
 *   /api/email/trial-reminder?template=day6&name=Lucas
 *   /api/email/trial-reminder?template=expired&name=Lucas
 *   Add &locale=en for English variants.
 */
import { NextRequest } from "next/server";
import { trialWelcomeHtml } from "@/lib/emails/trial-welcome";
import { trialDay6ReminderEmail, trialExpiredEmail } from "@/lib/emails/drip-templates";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const template  = searchParams.get("template") ?? "welcome";
  const name      = searchParams.get("name") ?? "Lucas";
  const localeRaw = searchParams.get("locale") ?? "de";
  const locale    = localeRaw === "en" ? "en" as const : "de" as const;
  const trialEndAt = searchParams.get("trial_end_at")
    ?? new Date(Date.now() + 7 * 86400000).toISOString();

  let html: string;

  if (template === "day6") {
    html = trialDay6ReminderEmail(name, "preview@glev.app", locale).html;
  } else if (template === "expired") {
    html = trialExpiredEmail(name, "preview@glev.app", locale).html;
  } else {
    html = trialWelcomeHtml(name, trialEndAt, null, locale);
  }

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
