import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthed, loginAction } from "../buyers/actions";
import PraxisClient, { type Practice } from "./PraxisClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminPraxisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp     = await searchParams;
  const authed = await isAdminAuthed();

  if (!authed) {
    const errParam = Array.isArray(sp.err) ? sp.err[0] : sp.err;
    const err =
      errParam === "bad"    ? "Falsches Token." :
      errParam === "server" ? "ADMIN_API_SECRET ist nicht konfiguriert." :
      null;
    return (
      <main style={pageStyle}>
        <h1 style={{ fontSize: 22, margin: "0 0 16px" }}>Glev Admin — Praxis-Links</h1>
        <form action={loginAction} style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 420 }}>
          <input type="password" name="token" autoComplete="off" required placeholder="ADMIN_API_SECRET" style={inputStyle} />
          <button type="submit" style={btnStyle}>Einloggen</button>
          {err ? <span style={{ color: "#c00", fontSize: 14 }}>{err}</span> : null}
        </form>
      </main>
    );
  }

  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("practice_referrals")
    .select("id, slug, name, greeting_text, active, created_at")
    .order("created_at", { ascending: false });

  const practices: Practice[] = (data ?? []) as Practice[];
  const err = Array.isArray(sp.err) ? sp.err[0] : (sp.err as string | undefined) ?? null;
  const ok  = Array.isArray(sp.ok)  ? sp.ok[0]  : (sp.ok  as string | undefined) ?? null;

  return (
    <main style={pageStyle}>
      <h1 style={{ fontSize: 22, margin: "0 0 6px" }}>Praxis-Empfehlungslinks</h1>
      <p style={{ color: "#555", fontSize: 14, margin: "0 0 24px" }}>
        Jede Praxis bekommt eine Landing Page unter{" "}
        <code style={{ background: "#f3f4f6", padding: "1px 5px", borderRadius: 3 }}>
          glev.app/praxis/:slug
        </code>{" "}
        mit QR-Code zum Ausdrucken oder Teilen.
      </p>
      <PraxisClient practices={practices} err={err} ok={ok} />
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  fontFamily: "system-ui, -apple-system, sans-serif",
  padding: 24,
  maxWidth: 960,
  margin: "0 auto",
  color: "#111",
  background: "#fff",
  minHeight: "100vh",
};
const inputStyle: React.CSSProperties = {
  padding: "10px 12px", border: "1px solid #ccc", borderRadius: 6,
  fontSize: 14, fontFamily: "inherit",
};
const btnStyle: React.CSSProperties = {
  padding: "10px 16px", background: "#111", color: "#fff",
  border: "none", borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: "pointer",
};
