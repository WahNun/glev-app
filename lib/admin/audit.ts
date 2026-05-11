import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Heuristic: does this Supabase/PostgREST error look like "the column or
 * table doesn't exist (yet)"? We use this to gracefully degrade when
 * 20260510_add_admin_user_management.sql has not been applied to the
 * target Supabase project — instead of bubbling a 500 to the operator,
 * the calling action redirects with ?err=migration so the page can show
 * a friendly banner with the exact apply command.
 *
 * Both Postgres and PostgREST surface schema-missing errors via the
 * message text. Codes vary (PGRST204 for schema-cache misses, 42703 for
 * undefined_column, 42P01 for undefined_table), so message-matching is
 * the most reliable detector.
 */
export function isSchemaMissingError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { message?: unknown; code?: unknown };
  const msg = String(err.message ?? "").toLowerCase();
  const code = String(err.code ?? "");
  if (code === "PGRST204" || code === "42703" || code === "42P01") return true;
  return (
    msg.includes("does not exist") ||
    msg.includes("could not find") ||
    msg.includes("schema cache")
  );
}

/**
 * Append one row to admin_audit_log. Every admin server action calls
 * this at the end (or on error, with note='ERROR ...') so we have a
 * permanent paper trail of who did what to which user.
 *
 * adminToken is the raw cookie value (= ADMIN_API_SECRET); we hash it
 * before persisting so the secret never lands in the DB in plaintext.
 * Truncated to 16 hex chars — enough to differentiate operators if you
 * ever rotate the secret, short enough not to look like a credential.
 */
export async function writeAuditLog(args: {
  action: string;
  targetUserId?: string | null;
  targetEmail?: string | null;
  before?: unknown;
  after?: unknown;
  note?: string;
  adminToken: string;
}): Promise<void> {
  const sb = getSupabaseAdmin();
  const tokenHash = createHash("sha256")
    .update(args.adminToken)
    .digest("hex")
    .slice(0, 16);
  const { error } = await sb.from("admin_audit_log").insert({
    action: args.action,
    target_user_id: args.targetUserId ?? null,
    target_email: args.targetEmail ?? null,
    before_state: (args.before ?? null) as never,
    after_state: (args.after ?? null) as never,
    note: args.note ?? null,
    admin_token_hash: tokenHash,
  });
  // Audit ist best-effort: Wenn die Tabelle (noch) nicht existiert, weil
  // die Migration nicht angewendet ist, soll der eigentliche Admin-Vorgang
  // nicht daran scheitern. Andere Fehler nur loggen, nicht werfen.
  if (error && !isSchemaMissingError(error)) {
    // eslint-disable-next-line no-console
    console.warn("[admin/audit] insert failed:", error.message);
  }
}

export type AuditEntry = {
  id: string;
  created_at: string;
  action: string;
  target_user_id: string | null;
  target_email: string | null;
  before_state: unknown;
  after_state: unknown;
  note: string | null;
  admin_token_hash: string;
};

export async function loadAuditLogForUser(
  userId: string,
  limit = 30,
): Promise<AuditEntry[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("admin_audit_log")
    .select("*")
    .eq("target_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  // Wenn die Tabelle fehlt (Migration nicht angewendet) → leere Liste
  // statt Server-Crash. Die UI rendert dann „noch keine Aktionen".
  if (error && isSchemaMissingError(error)) return [];
  return (data ?? []) as AuditEntry[];
}
