import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret");
  if (secret !== process.env.ADMIN_API_SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const results: Record<string, unknown> = {};

  // Env vars
  results.marketer_email = process.env.MARKETER_EMAIL ?? "MISSING";
  results.marketer_pw_len = (process.env.MARKETER_PASSWORD ?? "").length;
  results.marketer_pw_set = !!process.env.MARKETER_PASSWORD;
  results.service_role_key_set = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Supabase query
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("glev_ops_users")
      .select("id, email, role, password_hash")
      .eq("email", "kocak@aksme.de")
      .single();

    results.db_error = error?.message ?? null;
    results.db_found = !!data;

    if (data) {
      const row = data as { id: string; email: string; role: string; password_hash: string };
      results.db_hash_len = row.password_hash?.length ?? null;

      // Test Glev2026!
      try {
        const [salt, key] = row.password_hash.split(":");
        const derived = (await scryptAsync("Glev2026!", salt, 64)) as Buffer;
        results.glev2026_matches = timingSafeEqual(derived, Buffer.from(key, "hex"));
      } catch (e) {
        results.scrypt_error = String(e);
      }
    }
  } catch (e) {
    results.supabase_throw = String(e);
  }

  return NextResponse.json(results);
}
