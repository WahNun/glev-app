import Link from "next/link";
import { isAdminAuthed } from "@/lib/adminAuth";
import { createUserAction } from "../actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /admin/users/new — Stage 3 (manuell anlegen).
 *
 * Server-side Auth-Check oben, sonst Hinweis mit Link zur Liste (wo
 * die Login-Form steht). Submission läuft über die `createUserAction`
 * Server Action; nach Erfolg landet der Operator direkt auf der
 * Detail-Seite des frisch angelegten Users.
 */
export default async function NewUserPage() {
  const authed = await isAdminAuthed();
  if (!authed) {
    return (
      <main style={pageStyle}>
        <p>
          Nicht eingeloggt — bitte über{" "}
          <Link href="/glev-ops/users" style={{ color: "#3b4cdc" }}>
            /admin/users
          </Link>{" "}
          einloggen.
        </p>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <p style={{ margin: "0 0 8px" }}>
        <Link href="/glev-ops/users" style={{ color: "#3b4cdc" }}>
          ← Zurück zur Liste
        </Link>
      </p>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Nutzer manuell anlegen</h1>
      <p style={{ color: "#666", fontSize: 14, margin: "0 0 24px" }}>
        Friends-&amp;-Family / Tester:innen / Support-Cases. Für reguläre
        zahlende Käufer:innen läuft der Flow über Stripe Checkout — nicht
        hier.
      </p>

      <form action={createUserAction} style={form}>
        <Field label="E-Mail*">
          <input
            name="email"
            type="email"
            required
            placeholder="user@example.com"
            style={input}
          />
        </Field>

        <Field label="Name (optional)">
          <input name="fullName" type="text" placeholder="Vor- und Nachname" style={input} />
        </Field>

        <Field label="Sprache">
          <select name="language" defaultValue="de" style={input}>
            <option value="de">Deutsch</option>
            <option value="en">English</option>
          </select>
        </Field>

        <Field label="Plan-Direktstart">
          <select name="plan" defaultValue="free" style={input}>
            <option value="free">Free</option>
            <option value="beta">Beta (manuell)</option>
            <option value="pro">Pro (manuell, ohne Stripe)</option>
          </select>
          <p style={hint}>
            „Beta" und „Pro" setzen ein <code>manual_plan_override</code>. Der
            User kriegt die Features sofort, ohne Stripe-Abrechnung. Den
            Override kannst du jederzeit auf der Detail-Seite wieder
            entfernen.
          </p>
        </Field>

        <Field label="Notiz zum Plan (optional)">
          <input
            name="planNote"
            type="text"
            placeholder='z.B. „Schwester, Lifetime Free"'
            style={input}
          />
        </Field>

        <Field label="Rolle">
          <select name="role" defaultValue="user" style={input}>
            <option value="user">user</option>
            <option value="admin">admin (kann später Admin-Tools nutzen)</option>
          </select>
        </Field>

        <Field label="Login-Methode*">
          <select name="authMode" defaultValue="invite" style={input}>
            <option value="invite">Invite-Mail (User wählt selbst Passwort)</option>
            <option value="magiclink">Magic-Link senden</option>
            <option value="password">Passwort jetzt setzen (kein Mailversand)</option>
          </select>
        </Field>

        <Field label={'Passwort (nur bei „Passwort jetzt setzen")'}>
          <input
            name="password"
            type="text"
            minLength={8}
            placeholder="mind. 8 Zeichen"
            style={input}
            autoComplete="off"
          />
          <p style={hint}>
            {'Wird nur verwendet, wenn oben „Passwort jetzt setzen" ausgewählt ist. Sonst ignoriert.'}
          </p>
        </Field>

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button type="submit" style={btnPrimary}>
            Nutzer anlegen
          </button>
          <Link href="/glev-ops/users" style={{ ...btnSecondary, textDecoration: "none" }}>
            Abbrechen
          </Link>
        </div>
      </form>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <span style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
        {label}
      </span>
      {children}
    </label>
  );
}

const pageStyle: React.CSSProperties = {
  fontFamily: "system-ui, -apple-system, sans-serif",
  padding: 24,
  maxWidth: 640,
  margin: "0 auto",
  color: "#111",
  background: "#fff",
  minHeight: "100vh",
};
const form: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #eee",
  padding: 20,
  borderRadius: 10,
};
const input: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 14,
  fontFamily: "inherit",
};
const hint: React.CSSProperties = {
  fontSize: 12,
  color: "#666",
  margin: "4px 0 0",
};
const btnPrimary: React.CSSProperties = {
  padding: "10px 16px",
  background: "#111",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
const btnSecondary: React.CSSProperties = {
  padding: "10px 16px",
  background: "#fff",
  color: "#111",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
