import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

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
  await sb.from("admin_audit_log").insert({
    action: args.action,
    target_user_id: args.targetUserId ?? null,
    target_email: args.targetEmail ?? null,
    before_state: (args.before ?? null) as never,
    after_state: (args.after ?? null) as never,
    note: args.note ?? null,
    admin_token_hash: tokenHash,
  });
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
  const { data } = await sb
    .from("admin_audit_log")
    .select("*")
    .eq("target_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as AuditEntry[];
}
