import {
  betaWelcomeHtml,
  betaWelcomeSubject,
  type EmailLocale,
} from "@/lib/emails/beta-welcome";
import { proWelcomeHtml, proWelcomeSubject } from "@/lib/emails/pro-welcome";
import {
  day7InsightsEmail,
  day14FeedbackEmail,
  day30TrustpilotEmail,
} from "@/lib/emails/drip-templates";
import { isAdminAuthed, loginAction } from "./actions";
import EmailPreview, { type TemplateOption } from "./EmailPreview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Operator-Preview für alle Mail-Templates die Glev nach einem Kauf
 * verschickt — Welcome (Beta + Pro) und die drei Drip-Mails Tag 7/14/30.
 *
 * Zweck: Lucas (und alle mit `ADMIN_API_SECRET`) sollen sehen können
 * was Käufer:innen tatsächlich im Posteingang lesen — ohne sich selbst
 * eine Test-Mail schicken zu müssen oder die HTML-Templates im Code
 * zu lesen. Renderaufrufe gehen direkt gegen die echten Renderer aus
 * `lib/emails/*` — d. h. „was du hier siehst" ist garantiert „was
 * Resend rausschickt", solange die Render-Funktionen nicht umgeschrieben
 * werden.
 *
 * URL-Params zum Variieren:
 *   - `?t=<key>` — welches Template (siehe TEMPLATES unten)
 *   - `?name=<vorname>` — Anrede testen (Default: "Julia")
 *   - `?email=<adresse>` — Empfängerin im Drip-Footer + Unsub-Link
 *     (Default: julia@example.com)
 *
 * Dies ist KEIN Mail-Editor. Änderungen am Inhalt passieren weiterhin
 * im Code (`lib/emails/*.ts`); diese Seite ist nur die Sichtbarkeits-
 * Schicht. Falls künftig direkt aus der UI editiert werden soll: separates
 * Tooling (z. B. React Email mit JSX-Templates) — würde aber erfordern
 * dass die Templates aus dem hand-getunten HTML in JSX-Komponenten
 * konvertiert werden.
 */

const DEFAULT_NAME = "Julia";
const DEFAULT_EMAIL = "julia@example.com";
const DEFAULT_SESSION_ID = "cs_test_demo_session_for_preview_only";

function buildTemplates(
  name: string,
  email: string,
  locale: EmailLocale,
): TemplateOption[] {
  // App-URL aus dem env, sonst Production-Fallback. Steckt im Welcome-CTA
  // und im Unsubscribe-Link der Drips, also muss sie für die Preview real
  // genug aussehen.
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://glev.app";

  const day7 = day7InsightsEmail(name, email, locale);
  const day14 = day14FeedbackEmail(name, email, locale);
  const day30 = day30TrustpilotEmail(name, email, locale);

  const isEn = locale === "en";

  return [
    {
      key: "beta-welcome",
      label: "Beta — Welcome",
      whenSent: isEn
        ? "Immediately after Stripe Checkout success ($19 Beta setup fee)"
        : "Sofort nach erfolgreicher Stripe-Checkout (€19 Beta-Setup-Fee)",
      subject: betaWelcomeSubject(name, locale),
      html: betaWelcomeHtml(name, DEFAULT_SESSION_ID, appUrl, locale),
    },
    {
      key: "pro-welcome",
      label: "Pro — Welcome",
      whenSent: isEn
        ? "Immediately after Pro subscription is created via Stripe Checkout"
        : "Sofort nach Anlage des Pro-Abos via Stripe-Checkout",
      subject: proWelcomeSubject(name, locale),
      html: proWelcomeHtml(name, DEFAULT_SESSION_ID, appUrl, null, locale),
    },
    {
      key: "drip-day7",
      label: isEn ? "Drip — Day 7 (Insights)" : "Drip — Tag 7 (Insights)",
      whenSent: isEn
        ? "7 days after welcome — cron at 09:00 UTC"
        : "7 Tage nach Welcome — Cron um 09:00 UTC",
      subject: day7.subject,
      html: day7.html,
    },
    {
      key: "drip-day14",
      label: isEn ? "Drip — Day 14 (Feedback)" : "Drip — Tag 14 (Feedback)",
      whenSent: isEn
        ? "14 days after welcome — cron at 09:00 UTC"
        : "14 Tage nach Welcome — Cron um 09:00 UTC",
      subject: day14.subject,
      html: day14.html,
    },
    {
      key: "drip-day30",
      label: isEn ? "Drip — Day 30 (Trustpilot)" : "Drip — Tag 30 (Trustpilot)",
      whenSent: isEn
        ? "30 days after welcome — cron at 09:00 UTC"
        : "30 Tage nach Welcome — Cron um 09:00 UTC",
      subject: day30.subject,
      html: day30.html,
    },
  ];
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
    const err =
      errParam === "bad"
        ? "Falsches Token."
        : errParam === "server"
          ? "ADMIN_API_SECRET ist nicht konfiguriert."
          : null;
    return (
      <main style={pageStyle}>
        <h1 style={{ fontSize: 22, margin: "0 0 16px" }}>Glev — Mail-Preview</h1>
        <p style={{ marginBottom: 16, color: "#555" }}>
          Internal-only. Bitte das <code>ADMIN_API_SECRET</code> einfügen, um die
          Templates anzusehen.
        </p>
        <form
          action={loginAction}
          style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 420 }}
        >
          <input
            type="password"
            name="token"
            autoComplete="off"
            required
            placeholder="ADMIN_API_SECRET"
            style={inputStyle}
          />
          <button type="submit" style={btnStyle}>
            Einloggen
          </button>
          {err ? <span style={{ color: "#c00", fontSize: 14 }}>{err}</span> : null}
        </form>
      </main>
    );
  }

  // Aus den Query-Params Anrede + Empfänger-Adresse für die Variablen
  // ziehen. Werden bei jeder Tab-Auswahl mit weitergegeben (siehe
  // EmailPreview), damit ein Wechsel nicht den eingestellten Namen
  // wegwirft.
  const nameParam = Array.isArray(sp.name) ? sp.name[0] : sp.name;
  const emailParam = Array.isArray(sp.email) ? sp.email[0] : sp.email;
  const tParam = Array.isArray(sp.t) ? sp.t[0] : sp.t;
  const langParam = Array.isArray(sp.lang) ? sp.lang[0] : sp.lang;

  const name = (nameParam ?? "").trim() || DEFAULT_NAME;
  const email = (emailParam ?? "").trim() || DEFAULT_EMAIL;
  const locale: EmailLocale = langParam === "en" ? "en" : "de";

  const templates = buildTemplates(name, email, locale);
  const selectedKey = templates.some((t) => t.key === tParam)
    ? (tParam as string)
    : templates[0].key;

  return (
    <main style={pageStyle}>
      <h1 style={{ fontSize: 22, margin: "0 0 16px" }}>Glev — Mail-Preview</h1>

      <p style={{ margin: "0 0 16px", color: "#555", fontSize: 13 }}>
        Live-Render aus <code>lib/emails/*</code> — was du siehst ist exakt was
        Resend an die Käufer:innen schickt. Inhalt änderst du im Code, diese
        Seite zeigt dir das Ergebnis.
      </p>

      <EmailPreview
        templates={templates}
        selectedKey={selectedKey}
        name={name}
        email={email}
        locale={locale}
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

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 14,
  fontFamily: "inherit",
};

const btnStyle: React.CSSProperties = {
  padding: "10px 16px",
  background: "#111",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
