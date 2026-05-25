/**
 * POST /api/email/trial-reminder
 *
 * Stub — loggt nur, sendet noch keine echte E-Mail.
 * Payload: { user_id: string, trial_end_at: string }
 *
 * Hier später den Resend/Drip-Call einklinken:
 *   await resend.emails.send({ to: ..., subject: "Dein Glev-Test läuft ab", ... })
 */
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    user_id?: string;
    trial_end_at?: string;
  };

  console.log("[trial-reminder] STUB — würde E-Mail senden:", {
    user_id: body.user_id ?? "(missing)",
    trial_end_at: body.trial_end_at ?? "(missing)",
  });

  return NextResponse.json({ ok: true, stub: true });
}
