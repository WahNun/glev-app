import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";

/**
 * /api/onboarding
 *
 * POST { action: "complete" } → set profiles.onboarding_completed_at = NOW()
 * POST { action: "reset" }    → set profiles.onboarding_completed_at = NULL
 *
 * Both actions require an authenticated user; both are idempotent. The
 * "reset" action is wired to the Settings → "Onboarding wiederholen"
 * row so users who skipped can replay the flow on demand.
 *
 * Auth pattern mirrors `/api/preferences` (cookie-first, bearer-second
 * for native clients). RLS sees the right `auth.uid()` because the same
 * Supabase client is used for both `auth.getUser()` and the UPDATE.
 */

type AuthOk  = { user: User; sb: SupabaseClient };
type AuthErr = { user: null; sb: null; error: string };

async function authedClient(req: NextRequest): Promise<AuthOk | AuthErr> {
  const url  = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
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
      auth:   { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await sb.auth.getUser(token);
    if (data?.user) return { user: data.user, sb };
  }

  return { user: null, sb: null, error: "no session cookie and no bearer token" };
}

export async function POST(req: NextRequest) {
  try {
    const auth = await authedClient(req);
    if (!auth.user) return NextResponse.json({ error: auth.error }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as { action?: unknown };
    const action = typeof body.action === "string" ? body.action : "";

    let timestamp: string | null;
    if (action === "complete")    timestamp = new Date().toISOString();
    else if (action === "reset")  timestamp = null;
    else return NextResponse.json({ error: "invalid action — expected 'complete' or 'reset'" }, { status: 400 });

    // profiles is keyed on user_id (FK to auth.users.id), not id —
    // see supabase/migrations/20260427_add_junction_user_id.sql.
    const { error: dbErr } = await auth.sb
      .from("profiles")
      .update({ onboarding_completed_at: timestamp })
      .eq("user_id", auth.user.id);

    if (dbErr) {
      // 42703 = undefined_column — surfaces if the migration hasn't run
      // in this environment yet. Surface as 503 so the client knows it's
      // a deploy ordering issue rather than a permission denial.
      const missingColumn = dbErr.code === "42703" || /column .* does not exist/i.test(dbErr.message ?? "");
      // eslint-disable-next-line no-console
      console.error("[onboarding POST] db error:", dbErr.code, dbErr.message);
      return NextResponse.json(
        { error: dbErr.message },
        { status: missingColumn ? 503 : 500 },
      );
    }

    return NextResponse.json({ ok: true, action });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
