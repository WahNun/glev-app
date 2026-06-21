/**
 * POST /api/crm/signup-notification
 *
 * Internal CRM notification — fires when someone completes the free-trial
 * signup (Step 2, after profile data is saved).
 *
 * Sends a structured email to glev@beauty-flow.de + crm@glev.app from crm@glev.app via Resend.
 * Fire-and-forget from the client — failures are logged but never surface
 * to the user.
 *
 * Payload: CrmSignupPayload (see lib/emails/crm-signup-notification.ts)
 */
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import {
  crmSignupHtml,
  crmSignupSubject,
  type CrmSignupPayload,
} from "@/lib/emails/crm-signup-notification";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as CrmSignupPayload | null;

    if (!body?.email || !body?.user_id) {
      return NextResponse.json({ error: "email and user_id required" }, { status: 400 });
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.warn("[crm/signup-notification] RESEND_API_KEY not set — skipping send");
      return NextResponse.json({ ok: true, skipped: true });
    }

    const resend = new Resend(apiKey);

    const html = crmSignupHtml(body);
    const subject = crmSignupSubject(body.email, body.name);

    const { error } = await resend.emails.send({
      from: "Glev CRM <crm@glev.app>",
      to: ["glev@beauty-flow.de", "crm@glev.app"],
      subject,
      html,
    });

    if (error) {
      console.error("[crm/signup-notification] Resend error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log("[crm/signup-notification] sent for", body.email);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[crm/signup-notification] unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const runtime = "nodejs";
