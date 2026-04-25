import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";

export type AuthOk = { user: User; sb: SupabaseClient };
export type AuthErr = { user: null; sb: null; error: string };

export async function authedClient(req: NextRequest): Promise<AuthOk | AuthErr> {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  try {
    const cookieStore = await cookies();
    const all = cookieStore.getAll();
    if (all.length > 0) {
      const sb = createServerClient(url, anon, {
        cookies: {
          getAll: () => all.map((c) => ({ name: c.name, value: c.value })),
          setAll: () => {},
        },
      });
      const { data } = await sb.auth.getUser();
      if (data?.user) return { user: data.user, sb };
    }
  } catch {
    /* fall through */
  }

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (token) {
    const sb = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await sb.auth.getUser(token);
    if (data?.user) return { user: data.user, sb };
  }

  return { user: null, sb: null, error: "no session cookie and no bearer token" };
}

export function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "42P01" || err.code === "PGRST205") return true;
  return typeof err.message === "string" &&
    (/does not exist/i.test(err.message) || /could not find the table/i.test(err.message));
}

export function badJson(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
