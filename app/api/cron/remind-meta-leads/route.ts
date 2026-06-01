/**
 * POST /api/cron/remind-meta-leads
 *
 * Schickt nach 24h einen Reminder (SMS + Email) an Meta-Leads die:
 *   - vor mindestens 24h angelegt wurden
 *   - trial_start_at IS NULL (Trial noch nicht aktiviert)
 *   - reminder_sent_at IS NULL (noch kein Reminder bekommen)
 *
 * Auth: Bearer CRON_SECRET (GitHub Actions) oder Admin-Cookie.
 * Idempotent — kann mehrfach laufen, jeder Lead bekommt nur einen Reminder.
 *
 * SMS + Email-Texte kommen aus message_templates (DB), Fallback: Hardcoded-Defaults.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthed } from "@/lib/adminAuth";
import { shortenUrl } from "@/lib/shortLinks";
import { getTemplate, renderSms } from "@/lib/messageTemplates";
import { Resend } from "resend";
import {
  metaLeadReminderHtml,
  metaLeadReminderSubject,
} from "@/lib/emails/meta-lead-reminder";

export const runtime = "nodejs";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://glev.app").replace(/\/$/, "");
const FROM = "Glev <info@glev.app>";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth === `Bearer ${secret}`) return true;
  }
  return false;
}

async function sendSms(phone: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) return { ok: false, error: "Twilio nicht konfiguriert" };
  const fd = new URLSearchParams({ From: from, To: phone, Body: body });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: fd.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `Twilio ${res.status}: ${text.slice(0, 200)}` };
  }
  return { ok: true };
}

export type ReminderResult = {
  email: string;
  sms: "sent" | "no_phone" | "skipped" | "error";
  emailSent: boolean;
  error?: string;
};

export async function POST(req: NextRequest) {
  const cronAuthed = isAuthorized(req);
  const adminAuthed = cronAuthed ? true : await isAdminAuthed();
  if (!adminAuthed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sb = getSupabaseAdmin();

  // Fetch message templates from DB (with hardcoded fallbacks)
  const [smsTpl, emailTpl] = await Promise.all([
    getTemplate("meta_lead_reminder_sms"),
    getTemplate("meta_lead_reminder_email"),
  ]);

  // Meta-Leads die vor 24h+ angelegt wurden, noch nicht aktiviert und noch nicht erinnert
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: leads, error: leadsErr } = await sb
    .from("meta_leads")
    .select("email, phone, full_name, received_at")
    .is("reminder_sent_at", null)
    .not("email", "is", null)
    .lte("received_at", cutoff);

  if (leadsErr) return NextResponse.json({ error: leadsErr.message }, { status: 500 });
  if (!leads || leads.length === 0) return NextResponse.json({ results: [] });

  // Profile prüfen: nur leads ohne aktiven Trial erinnern
  const emails = leads.map((l) => l.email as string);
  const { data: authData } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const authByEmail = new Map(
    (authData?.users ?? []).map((u) => [u.email?.toLowerCase() ?? "", u]),
  );

  const userIds = emails
    .map((e) => authByEmail.get(e.toLowerCase())?.id)
    .filter(Boolean) as string[];

  const { data: profiles } = await sb
    .from("profiles")
    .select("user_id, trial_start_at")
    .in("user_id", userIds.length > 0 ? userIds : ["00000000-0000-0000-0000-000000000000"]);

  const activatedIds = new Set(
    (profiles ?? [])
      .filter((p) => p.trial_start_at !== null)
      .map((p) => p.user_id),
  );

  const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
  const results: ReminderResult[] = [];

  for (const lead of leads) {
    const email = lead.email as string;
    const phone = (lead.phone as string | null) ?? null;
    const fullName = (lead.full_name as string | null) ?? null;
    const firstName = fullName?.trim().split(/\s+/)[0] ?? null;

    const authUser = authByEmail.get(email.toLowerCase());

    // Bereits aktiviert → überspringen, aber trotzdem reminder_sent_at setzen
    if (authUser && activatedIds.has(authUser.id)) {
      await sb.from("meta_leads").update({ reminder_sent_at: new Date().toISOString() }).eq("email", email);
      continue;
    }

    // Frischen Recovery-Link generieren
    const { data: linkData, error: linkErr } = await sb.auth.admin.generateLink({
      type: authUser ? "recovery" : "invite",
      email,
      options: { redirectTo: `${APP_URL}/auth/confirm` },
    });
    const inviteUrl = linkData?.properties?.action_link ?? null;
    if (linkErr || !inviteUrl) {
      results.push({ email, sms: "error", emailSent: false, error: linkErr?.message ?? "Kein Link" });
      continue;
    }

    let smsSent: ReminderResult["sms"] = "no_phone";
    let emailSent = false;

    // SMS — Text aus DB-Template
    if (phone) {
      const smsShort = await shortenUrl(inviteUrl, "sms_reminder", email);
      const smsBody = renderSms(smsTpl.sms_text ?? "", { name: firstName, link: smsShort });
      const smsRes = await sendSms(phone, smsBody);
      smsSent = smsRes.ok ? "sent" : "error";
    }

    // Email — Subject + Intro aus DB-Template
    if (resend) {
      const emailShort = await shortenUrl(inviteUrl, "email_reminder", email);
      resend.emails
        .send({
          from: FROM,
          to: email,
          subject: metaLeadReminderSubject(firstName, emailTpl.email_subject),
          html: metaLeadReminderHtml(firstName, emailShort, APP_URL, {
            intro: emailTpl.email_intro,
          }),
        })
        .then(() => { emailSent = true; })
        .catch(() => {});
      emailSent = true;
    }

    // reminder_sent_at markieren
    await sb.from("meta_leads")
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq("email", email);

    results.push({ email, sms: smsSent, emailSent });
  }

  return NextResponse.json({ results, processed: results.length });
}
