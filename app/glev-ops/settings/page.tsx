import { isAdminAuthed } from "@/lib/adminAuth";
import {
  loginAction,
  backfillCurrencyCountryAction,
} from "../users/actions";
import AdminLoginForm from "../_components/AdminLoginForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /admin/settings — versteckte Admin-Ops, die selten gebraucht werden
 * und auf der Hauptliste nur Platz wegnehmen würden. Aktuell:
 *   - Currency+Land-Backfill (idempotent, zieht aus Stripe nach)
 *
 * Künftige Ergänzungen sollten hier ihre eigene Section bekommen
 * (Mail-Resend, Cache-Invalidierung, Migrationen-Status, etc.).
 */
export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const authed = await isAdminAuthed();

  if (!authed) {
    const errParam = Array.isArray(sp.err) ? sp.err[0] : sp.err;
    const err = errParam === "bad" ? "Login fehlgeschlagen." : null;
    return <AdminLoginForm action={loginAction} title="Einstellungen" error={err} />;
  }

  // Banner für den Backfill-Rücksprung — nur wenn der Action-Redirect
  // tatsächlich von hier aus aufgerufen wurde, sonst still.
  const bf = Array.isArray(sp.backfill) ? sp.backfill[0] : sp.backfill;
  const pro = Array.isArray(sp.pro) ? sp.pro[0] : sp.pro;
  const beta = Array.isArray(sp.beta) ? sp.beta[0] : sp.beta;
  const skipped = Array.isArray(sp.skipped) ? sp.skipped[0] : sp.skipped;
  const errors = Array.isArray(sp.errors) ? sp.errors[0] : sp.errors;

  return (
    <main style={pageStyle}>
      <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>Glev Admin — Einstellungen</h1>
      <p style={{ color: "#555", fontSize: 14, margin: "0 0 24px" }}>
        Wartungs- und Migrations-Aktionen. Sind selten nötig, aber wenn doch,
        liegen sie hier zentral statt auf den Hauptlisten.
      </p>

      {/* Backfill-Action — vorher auf /admin/users */}
      <section style={{ ...boxStyle, background: "#f5f3ff", borderColor: "#c4b5fd" }}>
        <h2 style={{ fontSize: 15, margin: "0 0 6px", color: "#5b21b6", fontWeight: 700 }}>
          Currency + Land aus Stripe nachziehen (Backfill)
        </h2>
        <p style={{ fontSize: 13, color: "#5b21b6", margin: "0 0 14px", lineHeight: 1.5 }}>
          Lädt für alle bestehenden Käufer:innen ohne <code>currency</code>/
          <code>country</code> die Stripe Checkout Session und füllt die
          fehlenden Felder (EUR/USD + Billing-Land). Pro- und Beta-Tabelle.
          Idempotent — überschreibt nichts, was schon gesetzt ist. Kann
          gefahrlos mehrfach geklickt werden.
        </p>

        {bf === "ok" ? (
          <p style={successStyle}>
            ✓ Letzter Lauf: Pro <strong>{pro ?? 0}</strong> aktualisiert ·
            Beta <strong>{beta ?? 0}</strong> aktualisiert ·{" "}
            {skipped ?? 0} übersprungen · {errors ?? 0} Fehler.
          </p>
        ) : null}

        <form action={backfillCurrencyCountryAction}>
          <button
            type="submit"
            style={{
              ...btnStyle,
              background: "#7c3aed",
              borderColor: "#7c3aed",
              color: "#fff",
            }}
          >
            Backfill jetzt starten
          </button>
        </form>
      </section>

      <p style={{ fontSize: 12, color: "#999", marginTop: 24 }}>
        Mehr Wartungs-Tools werden hier ergänzt, wenn der Bedarf da ist.
      </p>
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  fontFamily: "system-ui, -apple-system, sans-serif",
  padding: 24,
  maxWidth: 900,
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
const boxStyle: React.CSSProperties = {
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: 18,
  marginBottom: 16,
};
const successStyle: React.CSSProperties = {
  color: "#047857",
  fontSize: 13,
  margin: "0 0 14px",
  background: "#ecfdf5",
  padding: "8px 12px",
  borderRadius: 6,
  border: "1px solid #a7f3d0",
};
