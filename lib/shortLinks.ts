import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const CHARS = "abcdefghijkmnpqrstuvwxyz23456789"; // no 0/o/1/l confusion
const CODE_LEN = 6;

function randomCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LEN; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
}

/**
 * Creates a short link entry and returns the full short URL.
 * source: 'sms' | 'email' | 'sms_reminder' | 'email_reminder' — für Click-Tracking.
 * Falls back to the original URL if Supabase is unavailable.
 */
export async function shortenUrl(url: string, source?: string): Promise<string> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://glev.app";
  try {
    const sb = getSupabaseAdmin();
    let code = randomCode();
    // One retry on collision
    for (let attempt = 0; attempt < 2; attempt++) {
      const { error } = await sb
        .from("short_links")
        .insert({ code, url, ...(source ? { source } : {}) });
      if (!error) return `${base}/s/${code}`;
      code = randomCode();
    }
  } catch {
    // silent fallback
  }
  return url;
}
