import Link from "next/link";
import { isAdminAuthed } from "./buyers/actions";
import { loginAction } from "./_actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /admin index page (Task #171).
 *
 * Used to be a 404. Now serves as a landing where operators can see
 * which internal dashboards exist instead of having to remember each
 * URL. The shared AdminNav (rendered by app/admin/layout.tsx) covers
 * navigation once they are inside any admin page; this index gives
 * them a discoverable entry point at /admin itself.
 *
 * Auth: same `glev_admin_token` cookie scoped to "/admin" as every
 * other admin page. The login form here uses the shared loginAction
 * from app/admin/_actions.ts, which redirects back to /admin on
 * success; from there the operator picks a section.
 */

const SECTIONS: ReadonlyArray<{
  href: string;
  title: string;
  description: string;
}> = [
  {
    href: "/admin/buyers",
    title: "Käuferübersicht",
    description:
      "Beta- und Pro-Käufer:innen suchen, Onboarding- und Refund-Fragen klären.",
  },
  {
    href: "/admin/drip",
    title: "Drip-Pipeline",
    description:
      "Anstehende Drip-Mails, Failed-Bucket, manuelles Senden und Reschedule.",
  },
  {
    href: "/admin/drip-stats",
    title: "Drip-Statistik",
    description:
      "Versand- und Abmelde-Quoten pro Drip-Mail (Tag 7 / 14 / 30).",
  },
  {
    href: "/admin/emails",
    title: "Mail-Preview",
    description:
      "Live-Render der Welcome- und Drip-Templates, ohne Test-Mail an sich selbst.",
  },
];

export default async function AdminIndexPage({
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
        <h1 style={{ fontSize: 22, margin: "0 0 16px" }}>Glev — Admin</h1>
        <p style={{ marginBottom: 16, color: "#555" }}>
          Internal-only. Bitte das <code>ADMIN_API_SECRET</code> einfügen, um
          die internen Dashboards zu öffnen.
        </p>
        <form
          action={loginAction}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            maxWidth: 420,
          }}
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
          {err ? (
            <span style={{ color: "#c00", fontSize: 14 }}>{err}</span>
          ) : null}
        </form>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>Glev — Admin</h1>
      <p style={{ margin: "0 0 24px", color: "#555", fontSize: 14 }}>
        Wähle ein internes Dashboard. Der Login gilt für alle Bereiche.
      </p>

      <ul style={gridStyle}>
        {SECTIONS.map((s) => (
          <li key={s.href} style={{ listStyle: "none" }}>
            <Link href={s.href} style={cardStyle}>
              <span style={cardTitleStyle}>{s.title}</span>
              <span style={cardDescStyle}>{s.description}</span>
              <span style={cardHrefStyle}>{s.href}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  fontFamily: "system-ui, -apple-system, sans-serif",
  padding: 24,
  maxWidth: 1200,
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

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
  gap: 16,
  margin: 0,
  padding: 0,
};

const cardStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 16,
  border: "1px solid #e5e5e5",
  borderRadius: 8,
  background: "#fafafa",
  color: "#111",
  textDecoration: "none",
  height: "100%",
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
};

const cardDescStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#555",
  lineHeight: 1.4,
};

const cardHrefStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#888",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  marginTop: "auto",
};
