import { notFound, redirect } from "next/navigation";
import { isAdminAuthed } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { updateTrialUserAction } from "../actions";
import Link from "next/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function EditTrialUserPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const authed = await isAdminAuthed();
  if (!authed) redirect("/glev-ops/buyers");

  const { userId } = await params;
  const sp = await searchParams;
  const saved = (Array.isArray(sp.saved) ? sp.saved[0] : sp.saved) === "1";
  const errParam = Array.isArray(sp.err) ? sp.err[0] : sp.err;

  const sb = getSupabaseAdmin();
  const { data: authData } = await sb.auth.admin.getUserById(userId);
  const authUser = authData?.user;
  if (!authUser) notFound();

  const { data: profile } = await sb
    .from("profiles")
    .select("display_name, phone")
    .eq("user_id", userId)
    .maybeSingle();

  const fullName = (authUser.user_metadata?.full_name as string | null)
    ?? (profile?.display_name as string | null)
    ?? "";
  const spaceIdx = fullName.indexOf(" ");
  const firstName = spaceIdx > -1 ? fullName.slice(0, spaceIdx) : fullName;
  const lastName  = spaceIdx > -1 ? fullName.slice(spaceIdx + 1) : "";
  const phone = (authUser.user_metadata?.phone as string | null) ?? "";

  return (
    <main style={pageStyle}>
      <Link href="/glev-ops/buyers" style={backStyle}>← Zurück zum CRM</Link>
      <h1 style={{ fontSize: 18, fontWeight: 700, margin: "16px 0 4px" }}>
        Lead bearbeiten
      </h1>
      <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 24px" }}>{authUser.email}</p>

      {saved && (
        <div style={successBanner}>✓ Gespeichert</div>
      )}
      {errParam && (
        <div style={errorBanner}>Fehler: {errParam}</div>
      )}

      <form action={updateTrialUserAction} style={formStyle}>
        <input type="hidden" name="userId" value={userId} />

        <div style={fieldGroup}>
          <label style={labelStyle}>Vorname</label>
          <input
            name="first_name"
            type="text"
            defaultValue={firstName}
            placeholder="Lena"
            style={inputStyle}
          />
        </div>

        <div style={fieldGroup}>
          <label style={labelStyle}>Nachname</label>
          <input
            name="last_name"
            type="text"
            defaultValue={lastName}
            placeholder="Müller"
            style={inputStyle}
          />
        </div>

        <div style={fieldGroup}>
          <label style={labelStyle}>Telefon</label>
          <input
            name="phone"
            type="tel"
            defaultValue={phone}
            placeholder="+4917612345678"
            style={inputStyle}
          />
          <span style={{ fontSize: 11, color: "#9ca3af" }}>
            Format: +49… — wird für SMS genutzt
          </span>
        </div>

        <div style={fieldGroup}>
          <label style={labelStyle}>E-Mail</label>
          <input
            type="email"
            value={authUser.email ?? ""}
            disabled
            style={{ ...inputStyle, background: "#f9fafb", color: "#9ca3af", cursor: "not-allowed" }}
          />
          <span style={{ fontSize: 11, color: "#9ca3af" }}>Nicht änderbar</span>
        </div>

        <button type="submit" style={btnStyle}>Speichern</button>
      </form>
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  fontFamily: "system-ui, -apple-system, sans-serif",
  padding: "24px",
  maxWidth: 500,
  margin: "0 auto",
  color: "#111",
};
const backStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#6b7280",
  textDecoration: "none",
};
const formStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
};
const fieldGroup: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
};
const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#374151",
};
const inputStyle: React.CSSProperties = {
  padding: "9px 12px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 14,
  fontFamily: "inherit",
};
const btnStyle: React.CSSProperties = {
  padding: "10px 20px",
  background: "#111",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  alignSelf: "flex-start",
  marginTop: 4,
};
const successBanner: React.CSSProperties = {
  background: "#dcfce7",
  color: "#166534",
  borderRadius: 6,
  padding: "10px 14px",
  fontSize: 13,
  marginBottom: 20,
};
const errorBanner: React.CSSProperties = {
  background: "#fee2e2",
  color: "#991b1b",
  borderRadius: 6,
  padding: "10px 14px",
  fontSize: 13,
  marginBottom: 20,
};
