import { redirect } from "next/navigation";
import { isAdminAuthed } from "@/lib/adminAuth";
import { listTeamMembers, type GlevOpsUser } from "@/lib/admin/teamUsers";
import {
  addTeamMemberAction,
  deleteTeamMemberAction,
  resetPasswordAction,
} from "./actions";
import PasswordInput from "./PasswordInput";

const page:   React.CSSProperties = { fontFamily: "system-ui, -apple-system, sans-serif", padding: 24, maxWidth: 700, margin: "0 auto", color: "#111" };
const h1:     React.CSSProperties = { fontSize: 22, margin: "0 0 4px" };
const sub:    React.CSSProperties = { color: "#666", fontSize: 13, marginBottom: 28 };
const card:   React.CSSProperties = { border: "1px solid #e5e5e5", borderRadius: 8, padding: 16, marginBottom: 12 };
const row:    React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" };
const label:  React.CSSProperties = { fontSize: 12, color: "#888", marginBottom: 2, display: "block" };
const input:  React.CSSProperties = { padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13, width: "100%", boxSizing: "border-box" };
const select: React.CSSProperties = { padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13 };
const btn:    React.CSSProperties = { padding: "8px 14px", background: "#111", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" };
const btnBlue:React.CSSProperties = { ...btn, background: "#1565c0" };
const btnGhost:React.CSSProperties= { ...btn, background: "#fff", color: "#c00" };
const divider:React.CSSProperties = { border: "none", borderTop: "1px solid #eee", margin: "20px 0" };
const okBox:  React.CSSProperties = { padding: "10px 14px", borderRadius: 6, fontSize: 13, marginBottom: 16, background: "#e8f5e9", color: "#2e7d32" };
const errBox: React.CSSProperties = { padding: "10px 14px", borderRadius: 6, fontSize: 13, marginBottom: 16, background: "#ffebee", color: "#c00" };

function roleBadge(role: string): React.CSSProperties {
  return {
    fontSize: 11, padding: "2px 7px", borderRadius: 99, fontWeight: 600,
    background: role === "admin" ? "#111" : "#e8f5e9",
    color:      role === "admin" ? "#fff"  : "#2e7d32",
  };
}

function MemberCard({ m }: { m: GlevOpsUser }) {
  return (
    <div style={card}>
      <div style={{ ...row, marginBottom: 10 }}>
        <span style={{ fontWeight: 600 }}>{m.email}</span>
        <span style={roleBadge(m.role)}>{m.role}</span>
        {m.must_change_pw && (
          <span style={{ fontSize: 11, color: "#e65100", background: "#fff3e0", padding: "2px 7px", borderRadius: 99 }}>
            muss PW ändern
          </span>
        )}
        {m.name && <span style={{ fontSize: 13, color: "#555" }}>{m.name}</span>}
      </div>
      <div style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>
        Erstellt: {new Date(m.created_at).toLocaleDateString("de")}
        {m.last_login_at && (
          <> · Letzter Login: {new Date(m.last_login_at).toLocaleDateString("de")}</>
        )}
      </div>

      <details style={{ fontSize: 13 }}>
        <summary style={{ cursor: "pointer", color: "#555" }}>Passwort zurücksetzen</summary>
        <form action={resetPasswordAction} style={{ marginTop: 8, display: "flex", gap: 8 }}>
          <input type="hidden" name="id" value={m.id} />
          <input
            type="password"
            name="newPassword"
            placeholder="Neues Passwort (mind. 8 Zeichen)"
            minLength={8}
            required
            style={{ ...input, width: 260 }}
          />
          <button type="submit" style={btnBlue}>Setzen</button>
        </form>
      </details>

      <form action={deleteTeamMemberAction} style={{ marginTop: 8 }}>
        <input type="hidden" name="id" value={m.id} />
        <button type="submit" style={btnGhost}>Entfernen</button>
      </form>
    </div>
  );
}

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const ok = await isAdminAuthed();
  if (!ok) redirect("/glev-ops/users");

  const members = await listTeamMembers();
  const sp      = await searchParams;

  const noticeText: Record<string, string> = {
    added:   "Teammitglied wurde hinzugefügt.",
    deleted: "Teammitglied wurde entfernt.",
    reset:   "Passwort wurde zurückgesetzt.",
    invalid: "Ungültige Eingabe — E-Mail prüfen, Passwort mind. 8 Zeichen.",
    short:   "Passwort muss mind. 8 Zeichen haben.",
    wrong:   "Aktuelles Passwort falsch.",
  };

  return (
    <main style={page}>
      <h1 style={h1}>Team-Zugänge</h1>
      <p style={sub}>
        Supabase-basierte Logins für /glev-ops/*.{" "}
        <strong>Dein Master-Admin-Login via Env-Vars läuft immer separat davon.</strong>
      </p>

      {sp.ok  && noticeText[sp.ok]  && <div style={okBox}>{noticeText[sp.ok]}</div>}
      {sp.err && noticeText[sp.err] && <div style={errBox}>{noticeText[sp.err]}</div>}

      {members.length === 0 ? (
        <p style={{ color: "#888", fontSize: 13 }}>Noch keine Team-Mitglieder angelegt.</p>
      ) : (
        members.map((m) => <MemberCard key={m.id} m={m} />)
      )}

      <hr style={divider} />
      <h2 style={{ fontSize: 16, marginBottom: 14 }}>Neues Teammitglied hinzufügen</h2>

      <form action={addTeamMemberAction} style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 400 }}>
        <div>
          <label style={label}>Name (optional)</label>
          <input type="text" name="name" placeholder="z. B. Alen" style={input} />
        </div>
        <div>
          <label style={label}>E-Mail *</label>
          <input type="email" name="email" required placeholder="name@example.com" style={input} />
        </div>
        <div>
          <label style={label}>Passwort * (mind. 8 Zeichen)</label>
          <PasswordInput />
        </div>
        <div>
          <label style={label}>Rolle</label>
          <select name="role" defaultValue="marketer" style={select}>
            <option value="marketer">marketer — CRM-Zugang</option>
            <option value="admin">admin — Voller Zugang</option>
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" name="mustChange" id="mustChange" />
          <label htmlFor="mustChange" style={{ fontSize: 13, cursor: "pointer" }}>
            Passwort-Änderung beim ersten Login erzwingen
          </label>
        </div>
        <button type="submit" style={{ ...btn, marginTop: 4 }}>Hinzufügen</button>
      </form>

      <p style={{ fontSize: 12, color: "#aaa", marginTop: 24 }}>
        Login immer unter /glev-ops/users. Wenn „Passwort-Änderung erzwingen" aktiviert,
        landet die Person beim ersten Login auf einer Änderungs-Seite — sonst direkt im CRM.
      </p>
    </main>
  );
}
