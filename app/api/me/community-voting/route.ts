import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";

type AuthOk  = { user: User; sb: SupabaseClient };
type AuthErr = { user: null; sb: null; error: string };

async function authedClient(req: NextRequest): Promise<AuthOk | AuthErr> {
  const url  = process.env.SUPABASE_URL  || process.env.NEXT_PUBLIC_SUPABASE_URL  || "";
  const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  try {
    const cookieStore = await cookies();
    const all = cookieStore.getAll();
    if (all.length > 0) {
      const sb = createServerClient(url, anon, {
        cookies: {
          getAll: () => all.map(c => ({ name: c.name, value: c.value })),
          setAll: () => {},
        },
      });
      const { data } = await sb.auth.getUser();
      if (data?.user) return { user: data.user, sb };
    }
  } catch { /* fall through */ }

  const auth  = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (token) {
    const sb = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await sb.auth.getUser(token);
    if (data?.user) return { user: data.user, sb };
  }

  return { user: null, sb: null, error: "no session" };
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await authedClient(req);
    if (!auth.user) return NextResponse.json({ error: auth.error }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled (boolean) required" }, { status: 400 });
    }

    const { error } = await auth.sb
      .from("profiles")
      .update({ community_voting_enabled: body.enabled })
      .eq("user_id", auth.user.id);

    if (error) {
      console.error("[me/community-voting] update error:", error.code, error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
