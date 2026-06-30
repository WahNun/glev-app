import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminAuthed } from "@/lib/adminAuth";
import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ErrorLog = {
  id: string;
  user_id: string;
  error_code: string;
  error_message: string | null;
  cgm_source: string | null;
  app_version: string | null;
  platform: string | null;
  device_info: Record<string, unknown> | null;
  context: Record<string, unknown> | null;
  created_at: string;
};

export default async function CgmErrorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const authed = await isAdminAuthed();
  if (!authed) redirect("/glev-ops/login");

  const sp = await searchParams;
  const filterCode = Array.isArray(sp.code) ? sp.code[0] : (sp.code ?? "");

  const sb = getSupabaseAdmin();

  let query = sb
    .from("cgm_error_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (filterCode) query = query.eq("error_code", filterCode);

  const { data: logs, error: logsErr } = await query;
  if (logsErr) {
    return <div style={{ padding: 32, color: "red" }}>DB-Fehler: {logsErr.message}</div>;
  }

  const rows = (logs ?? []) as ErrorLog[];

  // Fetch emails for the unique user IDs found in this page
  const uniqueIds = [...new Set(rows.map((r) => r.user_id))];
  const emailMap: Record<string, string> = {};
  if (uniqueIds.length > 0) {
    const { data: authData } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of authData?.users ?? []) {
      emailMap[u.id] = u.email ?? u.id.slice(0, 8);
    }
  }

  // Distinct error codes for filter dropdown
  const { data: codes } = await sb
    .from("cgm_error_logs")
    .select("error_code")
    .order("error_code");
  const uniqueCodes = [...new Set((codes ?? []).map((c) => c.error_code))];

  return (
    <div style={{ padding: "32px 24px", fontFamily: "system-ui, sans-serif", maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ marginBottom: 24, display: "flex", alignItems: "center", gap: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>CGM Fehler-Logs</h1>
        <span style={{ fontSize: 13, color: "#666" }}>{rows.length} Einträge</span>
        <form style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: 13, color: "#666" }}>Filter:</label>
          <select
            name="code"
            defaultValue={filterCode}
            style={{ fontSize: 13, padding: "4px 8px", border: "1px solid #ddd", borderRadius: 4 }}
          >
            <option value="">Alle Codes</option>
            {uniqueCodes.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button type="submit" style={{ fontSize: 13, padding: "4px 12px", border: "1px solid #ddd", borderRadius: 4, cursor: "pointer", background: "#f5f5f5" }}>
            Anwenden
          </button>
          {filterCode && (
            <a href="/glev-ops/cgm-errors" style={{ fontSize: 13, color: "#666" }}>✕ Reset</a>
          )}
        </form>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f9f9f9", borderBottom: "2px solid #e5e5e5" }}>
              {["User", "Error-Code", "Nachricht", "CGM-Quelle", "Platform", "Version", "Zeitpunkt"].map((h) => (
                <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap", color: "#333" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: "24px 12px", color: "#999", textAlign: "center" }}>
                  Keine Fehler-Logs gefunden.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                  <a
                    href={`/glev-ops/users/${r.user_id}`}
                    style={{ color: "#3b82f6", textDecoration: "none", fontSize: 12, fontFamily: "monospace" }}
                  >
                    {emailMap[r.user_id] ?? r.user_id.slice(0, 8) + "…"}
                  </a>
                </td>
                <td style={{ padding: "8px 12px" }}>
                  <span style={{
                    display: "inline-block",
                    padding: "2px 8px",
                    borderRadius: 99,
                    fontSize: 11,
                    fontWeight: 600,
                    background: errorCodeColor(r.error_code).bg,
                    color: errorCodeColor(r.error_code).fg,
                  }}>
                    {r.error_code}
                  </span>
                </td>
                <td style={{ padding: "8px 12px", color: "#555", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.error_message ?? "—"}
                </td>
                <td style={{ padding: "8px 12px", color: "#555" }}>{r.cgm_source ?? "—"}</td>
                <td style={{ padding: "8px 12px", color: "#555" }}>{r.platform ?? "—"}</td>
                <td style={{ padding: "8px 12px", color: "#555" }}>{r.app_version ?? "—"}</td>
                <td style={{ padding: "8px 12px", color: "#999", whiteSpace: "nowrap" }}>
                  {new Date(r.created_at).toLocaleString("de-DE", {
                    day: "2-digit", month: "2-digit", year: "2-digit",
                    hour: "2-digit", minute: "2-digit",
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function errorCodeColor(code: string): { bg: string; fg: string } {
  switch (code) {
    case "no_credentials": return { bg: "#fef3c7", fg: "#92400e" };
    case "login_failed":   return { bg: "#fee2e2", fg: "#991b1b" };
    case "token_expired":  return { bg: "#ffedd5", fg: "#9a3412" };
    case "timeout":        return { bg: "#ede9fe", fg: "#5b21b6" };
    case "network_error":  return { bg: "#e0f2fe", fg: "#075985" };
    default:               return { bg: "#f3f4f6", fg: "#374151" };
  }
}
