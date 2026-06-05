import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthed } from "@/lib/adminAuth";
import SetupRequestsTable from "./SetupRequestsTable";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface SetupRequestRow {
  id: string;
  user_id: string;
  sensor_brand: string;
  sensor_model: string | null;
  device_os: string;
  nightscout_status: string;
  note: string | null;
  status: string;
  created_at: string;
  user_email: string | null;
}

export default async function SetupRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const authed = await isAdminAuthed();
  if (!authed) {
    return (
      <main style={pageStyle}>
        <p>Nicht eingeloggt — bitte über <Link href="/glev-ops/users">/glev-ops</Link>.</p>
      </main>
    );
  }

  const sp = await searchParams;
  const brandFilter = Array.isArray(sp.brand) ? sp.brand[0] : (sp.brand ?? "");

  const sb = getSupabaseAdmin();

  let query = sb
    .from("cgm_setup_requests")
    .select("id, user_id, sensor_brand, sensor_model, device_os, nightscout_status, note, status, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  if (brandFilter) {
    query = query.eq("sensor_brand", brandFilter);
  }

  const { data: rows, error } = await query;

  if (error) {
    return (
      <main style={pageStyle}>
        <h1 style={{ fontSize: 20, margin: "0 0 12px" }}>CGM Setup-Anfragen</h1>
        <div style={{ color: "#991b1b", background: "#fef2f2", border: "1px solid #fca5a5", padding: "12px 16px", borderRadius: 8 }}>
          Fehler beim Laden: {error.message}
        </div>
      </main>
    );
  }

  // Fetch user emails for all user_ids in one batch via auth.admin
  const userIds = [...new Set((rows ?? []).map((r) => r.user_id))];
  const emailMap: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: usersData } = await sb.auth.admin.listUsers({ perPage: 1000 });
    for (const u of usersData?.users ?? []) {
      if (userIds.includes(u.id)) {
        emailMap[u.id] = u.email ?? u.id;
      }
    }
  }

  const enriched: SetupRequestRow[] = (rows ?? []).map((r) => ({
    ...r,
    user_email: emailMap[r.user_id] ?? null,
  }));

  // Count by brand for filter chips
  const allBrands = [...new Set((rows ?? []).map((r) => r.sensor_brand))].sort();
  const openCount = (rows ?? []).filter((r) => r.status === "open").length;

  return (
    <main style={pageStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>CGM Setup-Anfragen</h1>
        <span style={{
          background: openCount > 0 ? "#ede9fe" : "#f1f5f9",
          color: openCount > 0 ? "#5b21b6" : "#64748b",
          border: `1px solid ${openCount > 0 ? "#c4b5fd" : "#e2e8f0"}`,
          borderRadius: 999,
          padding: "2px 10px",
          fontSize: 12,
          fontWeight: 700,
        }}>
          {openCount} offen
        </span>
        <span style={{ color: "#94a3b8", fontSize: 13 }}>
          {enriched.length} gesamt
        </span>
      </div>

      {/* Brand filter chips */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 20 }}>
        <Link
          href="/glev-ops/setup-requests"
          style={filterChipStyle(!brandFilter)}
        >
          Alle
        </Link>
        {allBrands.map((b) => (
          <Link
            key={b}
            href={`/glev-ops/setup-requests?brand=${encodeURIComponent(b)}`}
            style={filterChipStyle(brandFilter === b)}
          >
            {b}
          </Link>
        ))}
      </div>

      <SetupRequestsTable rows={enriched} />
    </main>
  );
}

function filterChipStyle(active: boolean): React.CSSProperties {
  return {
    display: "inline-block",
    padding: "4px 12px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: active ? 700 : 500,
    textDecoration: "none",
    background: active ? "#4F6EF7" : "#f1f5f9",
    color: active ? "#fff" : "#374151",
    border: active ? "1px solid #4F6EF7" : "1px solid #e2e8f0",
  };
}

const pageStyle: React.CSSProperties = {
  fontFamily: "system-ui, -apple-system, sans-serif",
  padding: 24,
  maxWidth: 1200,
  margin: "0 auto",
  color: "#111",
  background: "#fafafa",
  minHeight: "100vh",
};
