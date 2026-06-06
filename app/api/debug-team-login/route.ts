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

  // 1. Check env vars
  results.supabase_url_set = !!process.env.SUPABASE_URL || !!process.env.NEXT_PUBLIC_SUPABASE_URL;
  results.service_role_key_set = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  results.service_role_key_preview = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").slice(0, 10) || "MISSING";

  // 2. Try Supabase query
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("glev_ops_users")
      .select("id, email, role, length(password_hash) as hash_len, substring(password_hash, 1, 40) as hash_preview")
      .eq("email", "kocak@aksme.de")
      .single();

    results.db_error = error?.message ?? null;
    results.db_found = !!data;
    results.db_hash_len = (data as Record<string, unknown>)?.hash_len ?? null;
    results.db_hash_preview = (data as Record<string, unknown>)?.hash_preview ?? null;

    // 3. Test scrypt locally in this runtime
    if (data) {
      const hash = (data as Record<string, unknown>).password_hash as string | undefined;
      if (hash) {
        try {
          const [salt, key] = hash.split(":");
          const derived = (await scryptAsync("GlevTest2026!", salt, 64)) as Buffer;
          results.scrypt_verify = timingSafeEqual(derived, Buffer.from(key, "hex"));
        } catch (e) {
          results.scrypt_error = String(e);
        }
      } else {
        // hash not in select — fetch it separately
        const { data: d2 } = await sb
          .from("glev_ops_users")
          .select("password_hash")
          .eq("email", "kocak@aksme.de")
          .single();
        const h = (d2 as Record<string, unknown>)?.password_hash as string;
        results.hash_fetched = !!h;
        if (h) {
          try {
            const [salt, key] = h.split(":");
            const derived = (await scryptAsync("GlevTest2026!", salt, 64)) as Buffer;
            results.scrypt_verify = timingSafeEqual(derived, Buffer.from(key, "hex"));
          } catch (e) {
            results.scrypt_error = String(e);
          }
        }
      }
    }
  } catch (e) {
    results.supabase_throw = String(e);
  }

  return NextResponse.json(results);
}
