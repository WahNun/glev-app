import {
  betaWelcomeHtml,
  betaWelcomeSubject,
  type EmailLocale,
} from "@/lib/emails/beta-welcome";
import {
  supabaseConfirmHtml,
  SUPABASE_CONFIRM_SUBJECT,
} from "@/lib/emails/supabase-confirm";
import { proWelcomeHtml, proWelcomeSubject } from "@/lib/emails/pro-welcome";
import { plusWelcomeHtml, plusWelcomeSubject } from "@/lib/emails/plus-welcome";
import {
  betaFreeYearWelcomeHtml,
  betaFreeYearWelcomeSubject,
} from "@/lib/emails/beta-free-year-welcome";
import {
  day7InsightsEmail,
  day14FeedbackEmail,
  day30TrustpilotEmail,
  trialDay6ReminderEmail,
  trialExpiredEmail,
  reEngagementEmail,
} from "@/lib/emails/drip-templates";
import {
  trialWelcomeHtml,
  trialWelcomeSubject,
} from "@/lib/emails/trial-welcome";
import {
  metaLeadInviteHtml,
  metaLeadInviteSubject,
} from "@/lib/emails/meta-lead-invite";
import {
  metaLeadReminderHtml,
  metaLeadReminderSubject,
} from "@/lib/emails/meta-lead-reminder";
import { getAllTemplates } from "@/lib/messageTemplates";
import { isAdminAuthed } from "@/lib/adminAuth";
import { loginAction } from "./actions";
import AdminLoginForm from "../_components/AdminLoginForm";
import EmailPreview, {
  type TemplateOption,
  type SmsTemplateOption,
  type DbTemplate,
} from "./EmailPreview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_NAME = "Julia";
const DEFAULT_EMAIL = "julia@example.com";
const DEFAULT_SESSION_ID = "cs_test_demo_session_for_preview_only";

/** SMS-Templates — Texte kommen aus der DB (message_templates), Vorschau zeigt DB-Stand. */
const SMS_TEMPLATES: SmsTemplateOption[] = [
  {
    key: "meta_lead_invite_sms",
    label: "Meta Lead — Einladung (SMS)",
    whenSent: "Sofort nach Webhook-Eingang (Twilio fire-and-forget)",
  },
  {
    key: "meta_lead_bulk_sms",
    label: "Meta Lead — Bulk-SMS",
    whenSent: "Manuell via 'Bulk-SMS senden' Button",
  },
  {
    key: "meta_lead_reminder_sms",
    label: "Meta Lead — Reminder (SMS)",
    whenSent: "24h nach Einladung, wenn Trial nicht aktiviert — 10:00 UTC Cron",
  },
];

function buildTemplates(
  name: string,
  email: string,
  locale: EmailLocale,
  dbTemplates: Record<string, DbTemplate>,
  appUrl: string,
): TemplateOption[] {
  const isEn = locale === "en";
  const day7 = day7InsightsEmail(name, email, locale);
  const day14 = day14FeedbackEmail(name, email, locale);
  const day30 = day30TrustpilotEmail(name, email, locale);

  const bfyExpiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const bfySignupUrl = `${appUrl}/welcome/beta#access_token=demo_preview_only&type=magiclink`;
  const previewLink = `${appUrl}/auth/confirm#access_token=preview_only&type=recovery`;

  const reminderDb = dbTemplates["meta_lead_reminder_email"] ?? {};

  return [
    // ── Meta Lead ──────────────────────────────────────────────────────
    {
      key: "meta-lead-invite",
      label: isEn ? "Meta Lead — Invite" : "Meta Lead — Einladung (Email)",
      campaign: "meta-lead",
      whenSent: isEn
        ? "On webhook receipt — branded invite via Resend"
        : "Beim Webhook-Eingang — gebrandete Einladung via Resend",
      subject: metaLeadInviteSubject(name, locale),
      html: metaLeadInviteHtml(name, previewLink, locale, appUrl),
    },
    {
      key: "meta-lead-reminder",
      label: isEn ? "Meta Lead — Reminder (Email, 24h)" : "Meta Lead — Reminder (Email, 24h)",
      campaign: "meta-lead",
      editableKey: "meta_lead_reminder_email",
      whenSent: isEn
        ? "24h after invite, if trial not activated — daily cron 10:00 UTC"
        : "24h nach Einladung, wenn Trial nicht aktiviert — Cron 10:00 UTC",
      subject: reminderDb.email_subject ?? metaLeadReminderSubject(name),
      html: metaLeadReminderHtml(name, previewLink, appUrl, {
        intro: reminderDb.email_intro,
      }),
    },
    // ── Trial ──────────────────────────────────────────────────────────
    {
      key: "trial-welcome",
      label: isEn ? "Free Trial — Welcome (Day 0)" : "Free Trial — Welcome (Tag 0)",
      campaign: "trial",
      whenSent: isEn
        ? "Day 0 via outbox queue — on POST /api/auth/free-trial"
        : "Tag 0 über Outbox-Queue — bei POST /api/auth/free-trial",
      subject: trialWelcomeSubject(name, locale),
      html: trialWelcomeHtml(
        name,
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        appUrl,
        locale,
      ),
    },
    (() => {
      const r = trialDay6ReminderEmail(name, email, locale);
      return {
        key: "trial-day6",
        label: isEn ? "Free Trial — Day 6 (Reminder)" : "Free Trial — Tag 6 (Erinnerung)",
        campaign: "trial",
        whenSent: isEn ? "Day 6 after trial start — cron 09:00 UTC" : "Tag 6 nach Trial-Start — Cron 09:00 UTC",
        subject: r.subject,
        html: r.html,
      };
    })(),
    (() => {
      const r = trialExpiredEmail(name, email, locale);
      return {
        key: "trial-expired",
        label: isEn ? "Free Trial — Day 7 (Expired)" : "Free Trial — Tag 7 (Abgelaufen)",
        campaign: "trial",
        whenSent: isEn ? "Day 7 after trial start — cron 09:00 UTC" : "Tag 7 nach Trial-Start — Cron 09:00 UTC",
        subject: r.subject,
        html: r.html,
      };
    })(),
    (() => {
      const r = reEngagementEmail(name, email, locale);
      return {
        key: "re-engagement",
        label: isEn ? "Free Trial — Re-Engagement (48h inactive)" : "Free Trial — Re-Engagement (48h inaktiv)",
        campaign: "trial",
        whenSent: isEn
          ? "When a trial user hasn't been seen for 48h — sent once per user"
          : "Wenn ein Trial-User 48h nicht aktiv war — einmal pro User",
        subject: r.subject,
        html: r.html,
      };
    })(),
    // ── Drip ───────────────────────────────────────────────────────────
    {
      key: "drip-day7",
      label: isEn ? "Drip — Day 7 (Insights)" : "Drip — Tag 7 (Insights)",
      campaign: "drip",
      whenSent: isEn ? "7 days after welcome — cron 09:00 UTC" : "7 Tage nach Welcome — Cron 09:00 UTC",
      subject: day7.subject,
      html: day7.html,
    },
    {
      key: "drip-day14",
      label: isEn ? "Drip — Day 14 (Feedback)" : "Drip — Tag 14 (Feedback)",
      campaign: "drip",
      whenSent: isEn ? "14 days after welcome — cron 09:00 UTC" : "14 Tage nach Welcome — Cron 09:00 UTC",
      subject: day14.subject,
      html: day14.html,
    },
    {
      key: "drip-day30",
      label: isEn ? "Drip — Day 30 (Trustpilot)" : "Drip — Tag 30 (Trustpilot)",
      campaign: "drip",
      whenSent: isEn ? "30 days after welcome — cron 09:00 UTC" : "30 Tage nach Welcome — Cron 09:00 UTC",
      subject: day30.subject,
      html: day30.html,
    },
    // ── Welcome ────────────────────────────────────────────────────────
    {
      key: "beta-welcome",
      label: isEn ? "Glev Smart — Welcome" : "Glev Smart — Welcome",
      campaign: "welcome",
      whenSent: isEn
        ? "Immediately after Stripe Checkout (€19 setup fee)"
        : "Sofort nach Stripe-Checkout (€19 Setup-Fee)",
      subject: betaWelcomeSubject(name, locale),
      html: betaWelcomeHtml(name, DEFAULT_SESSION_ID, appUrl, locale),
    },
    {
      key: "pro-welcome",
      label: "Pro — Welcome",
      campaign: "welcome",
      whenSent: isEn
        ? "Immediately after Pro subscription via Stripe Checkout"
        : "Sofort nach Pro-Abo via Stripe-Checkout",
      subject: proWelcomeSubject(name, locale),
      html: proWelcomeHtml(name, DEFAULT_SESSION_ID, appUrl, null, locale),
    },
    {
      key: "plus-welcome",
      label: "Plus — Welcome",
      campaign: "welcome",
      whenSent: isEn
        ? "Immediately after Glev+ subscription (€29/mo lifetime-lock)"
        : "Sofort nach Glev+-Abo (€29/Monat Lifetime-Lock)",
      subject: plusWelcomeSubject(name, locale),
      html: plusWelcomeHtml(name, DEFAULT_SESSION_ID, appUrl, null, locale),
    },
    {
      key: "beta-free-year-welcome-existing",
      label: isEn ? "Smart — 1 Year Free (existing user)" : "Smart — 1 Jahr gratis (bestehender User)",
      campaign: "welcome",
      whenSent: isEn
        ? "Admin grants 1 free Smart year — recipient already has an account"
        : "Admin schaltet 1 Jahr Smart frei — Empfänger:in hat Account",
      subject: betaFreeYearWelcomeSubject(name, locale, "beta"),
      html: betaFreeYearWelcomeHtml(name, appUrl, bfyExpiresAt, locale, null, "beta"),
    },
    {
      key: "beta-free-year-welcome-invite",
      label: isEn ? "Smart — 1 Year Free (new user invite)" : "Smart — 1 Jahr gratis (neuer User, Invite)",
      campaign: "welcome",
      whenSent: isEn
        ? "Admin grants 1 free Smart year — new user, gets login link"
        : "Admin schaltet 1 Jahr Smart frei — neuer User, kriegt Login-Link",
      subject: betaFreeYearWelcomeSubject(name, locale, "beta"),
      html: betaFreeYearWelcomeHtml(name, appUrl, bfyExpiresAt, locale, bfySignupUrl, "beta"),
    },
    {
      key: "pro-free-year-welcome-existing",
      label: isEn ? "Pro-Free-Year — Welcome (existing)" : "Pro-Free-Year — Welcome (bestehender User)",
      campaign: "welcome",
      whenSent: isEn
        ? "Admin grants 1 free Pro year — recipient already has an account"
        : "Admin schaltet 1 Jahr Pro frei — Empfänger:in hat Account",
      subject: betaFreeYearWelcomeSubject(name, locale, "pro"),
      html: betaFreeYearWelcomeHtml(name, appUrl, bfyExpiresAt, locale, null, "pro"),
    },
    {
      key: "pro-free-year-welcome-invite",
      label: isEn ? "Pro-Free-Year — Welcome (new invite)" : "Pro-Free-Year — Welcome (neuer User, Invite)",
      campaign: "welcome",
      whenSent: isEn
        ? "Admin grants 1 free Pro year — new user, gets login link"
        : "Admin schaltet 1 Jahr Pro frei — neuer User, kriegt Login-Link",
      subject: betaFreeYearWelcomeSubject(name, locale, "pro"),
      html: betaFreeYearWelcomeHtml(name, appUrl, bfyExpiresAt, locale, bfySignupUrl, "pro"),
    },
    // ── System ─────────────────────────────────────────────────────────
    {
      key: "supabase-confirm",
      label: isEn ? "Supabase — Email Confirmation" : "Supabase — E-Mail-Bestätigung",
      campaign: "system",
      whenSent: isEn
        ? "Sent by Supabase after signup (paste into Auth → Email Templates → Confirm signup)"
        : "Von Supabase nach Signup (HTML in Dashboard → Auth → Email Templates → Confirm signup)",
      subject: SUPABASE_CONFIRM_SUBJECT,
      html: supabaseConfirmHtml("https://glev.app/auth/callback?code=EXAMPLE"),
    },
  ] satisfies TemplateOption[];
}

export default async function AdminEmailsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const authed = await isAdminAuthed();

  if (!authed) {
    const errParam = Array.isArray(sp.err) ? sp.err[0] : sp.err;
    const err = errParam === "bad" ? "Login fehlgeschlagen." : null;
    return <AdminLoginForm action={loginAction} title="Mail & SMS Preview" error={err} />;
  }

  const nameParam = Array.isArray(sp.name) ? sp.name[0] : sp.name;
  const emailParam = Array.isArray(sp.email) ? sp.email[0] : sp.email;
  const tParam = Array.isArray(sp.t) ? sp.t[0] : sp.t;
  const langParam = Array.isArray(sp.lang) ? sp.lang[0] : sp.lang;
  const campaignParam = Array.isArray(sp.campaign) ? sp.campaign[0] : sp.campaign;

  const name = (nameParam ?? "").trim() || DEFAULT_NAME;
  const email = (emailParam ?? "").trim() || DEFAULT_EMAIL;
  const locale: EmailLocale = langParam === "en" ? "en" : "de";
  const campaign = campaignParam ?? "alle";

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://glev.app";

  // Fetch editable templates from DB (falls back to hardcoded defaults in getAllTemplates)
  const dbTemplatesRaw = await getAllTemplates();
  const dbTemplates: Record<string, DbTemplate> = {};
  for (const [k, v] of Object.entries(dbTemplatesRaw)) {
    dbTemplates[k] = {
      sms_text: v.sms_text,
      email_subject: v.email_subject,
      email_intro: v.email_intro,
    };
  }

  const templates = buildTemplates(name, email, locale, dbTemplates, appUrl);
  const selectedKey = templates.some((t) => t.key === tParam)
    ? (tParam as string)
    : templates[0].key;

  return (
    <main style={pageStyle}>
      <h1 style={{ fontSize: 22, margin: "0 0 4px", fontWeight: 800 }}>Glev — Nachrichten</h1>
      <p style={{ margin: "0 0 20px", color: "#6b7280", fontSize: 14 }}>
        Email-Preview aus <code>lib/emails/*</code> · SMS aus DB (<code>message_templates</code>) ·
        Templates mit ✏ sind direkt bearbeitbar — Änderungen gelten für alle danach verschickten Nachrichten.
      </p>

      <EmailPreview
        templates={templates}
        smsTemplates={SMS_TEMPLATES}
        dbTemplates={dbTemplates}
        selectedKey={selectedKey}
        name={name}
        email={email}
        locale={locale}
        campaign={campaign}
      />
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  fontFamily: "system-ui, -apple-system, sans-serif",
  padding: 24,
  maxWidth: 1400,
  margin: "0 auto",
  color: "#111",
  background: "#fff",
  minHeight: "100vh",
};
