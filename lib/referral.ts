/**
 * Referral-code utilities — server-safe (no window/document).
 *
 * Alphabet: uppercase letters + digits, minus ambiguous chars (0 O I 1 l).
 * Result: 32^7 = ~34 billion unique codes — collision-safe for our scale.
 */

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Generate a random 7-char referral code. Call server-side only. */
export function generateReferralCode(): string {
  const bytes = new Uint8Array(7);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CHARS[b % CHARS.length]).join("");
}

/**
 * Returns the user's existing referral_code, or generates + persists one.
 * Uses the Supabase Admin client — call from API routes only.
 */
export async function getOrCreateReferralCode(userId: string): Promise<string> {
  const sb = getSupabaseAdmin();

  const { data } = await sb
    .from("profiles")
    .select("referral_code")
    .eq("user_id", userId)
    .single();

  if (data?.referral_code) return data.referral_code as string;

  const code = generateReferralCode();
  const { error } = await sb
    .from("profiles")
    .update({ referral_code: code })
    .eq("user_id", userId);

  if (error) throw new Error(`Failed to persist referral code: ${error.message}`);
  return code;
}
