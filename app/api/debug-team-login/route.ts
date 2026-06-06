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

  results.supabase_url_set = !!process.env.SUPABASE_URL || !!process.env.NEXT_PUBLIC_SUPABASE_URL;
  results.service_role_key_set = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  results.service_role_key_preview = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").slice(0, 10) || "MISSING";

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
      results.db_hash_has_colon = row.password_hash?.includes(":") ?? false;

      try {
        const [salt, key] = row.password_hash.split(":");
        const derived = (await scryptAsync("GlevTest2026!", salt, 64)) as Buffer;
        results.scrypt_verify = timingSafeEqual(derived, Buffer.from(key, "hex"));
      } catch (e) {
        results.scrypt_error = String(e);
      }
    }
  } catch (e) {
    results.supabase_throw = String(e);
  }

  return NextResponse.json(results);
}
