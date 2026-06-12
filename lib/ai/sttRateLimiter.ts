import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Per-user STT rate limiter — shared by the SSE and REST transcription routes.
 *
 * Uses the same `ai_rate_limit_hits` table as the chat rate limiter so all
 * Mistral API calls (chat + STT) are counted together in a single rolling window.
 *
 * Limit: 20 STT calls per 60 seconds per user.
 * A lower cap than chat (30/min) reflects that STT requests are larger payloads
 * and rapid firing is more often accidental (quick hin-und-her mic taps) than
 * intentional high-volume use.
 *
 * Both functions fail-open on DB errors — a missing table or network blip never
 * blocks the user from recording.
 */

const STT_RATE_LIMIT_MAX = 20;
const STT_RATE_LIMIT_WINDOW_MS = 60_000;

/** Returns `true` when the user has already fired STT_RATE_LIMIT_MAX STT
 *  requests in the last STT_RATE_LIMIT_WINDOW_MS. Fails open on DB errors. */
export async function isSTTRateLimited(userId: string): Promise<boolean> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return false;
  }

  const cutoffIso = new Date(Date.now() - STT_RATE_LIMIT_WINDOW_MS).toISOString();

  const { count, error } = await admin
    .from("ai_rate_limit_hits")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("hit_at", cutoffIso);

  if (error) return false;
  return (count ?? 0) >= STT_RATE_LIMIT_MAX;
}

/** Records one STT hit for the user and opportunistically prunes old rows.
 *  Fails open on DB errors. */
export async function addSTTRateLimitHit(userId: string): Promise<void> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return;
  }

  const now = Date.now();
  const cutoffIso = new Date(now - STT_RATE_LIMIT_WINDOW_MS).toISOString();

  await admin
    .from("ai_rate_limit_hits")
    .insert({ user_id: userId, hit_at: new Date(now).toISOString() });

  void admin
    .from("ai_rate_limit_hits")
    .delete()
    .eq("user_id", userId)
    .lt("hit_at", cutoffIso);
}

/**
 * Minimum audio blob size in bytes.
 * Blobs smaller than this are almost certainly empty recordings (mic tapped
 * and immediately released, or OS noise gate ate the signal). Sending them to
 * Mistral wastes an API call and often returns an unhelpful error.
 */
export const STT_MIN_BLOB_BYTES = 1_500;
