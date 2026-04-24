import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { errResponse } from "@/app/api/cgm/_helpers";
import type { User } from "@supabase/supabase-js";

/**
 * /api/preferences
 *
 * GET  → returns the signed-in user's saved card-order preferences. Always
 *        responds 200 with { dashboard_card_order, insights_card_order } —
 *        empty arrays when no row exists yet *or* the table hasn't been
 *        created yet, so the client can fall back to its built-in defaults.
 *        Any other DB error is surfaced as 500 so it's observable.
 *
 * POST → upserts the card-order arrays. Body shape:
 *          { dashboard_card_order?: string[], insights_card_order?: string[] }
 *        Only the keys present on the body are updated.
 *
 * Auth + DB call use the SAME Supabase client so RLS sees the right
 * `auth.uid()`. Cookie session is tried first (web), bearer token second
 * (native clients).
 */

type AuthOk  = { user: User; sb: SupabaseClient };
type AuthErr = { user: null; sb: null; error: string };

async function authedClient(req: NextRequest): Promise<AuthOk | AuthErr> {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  // 1. Try cookie session (web). Only adopt this client if it actually
  //    authenticates a user — the existence of cookies alone isn't enough.
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

  // 2. Bearer-token fallback (native clients).
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

/** "Table does not exist" detection across both Postgres and PostgREST. */
function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  // 42P01 = Postgres "undefined_table"; PGRST205 = PostgREST "table not
  // found in schema cache" (this is what Supabase actually returns when
  // the table genuinely isn't created yet).
  if (err.code === "42P01" || err.code === "PGRST205") return true;
  return typeof err.message === "string" &&
    (/does not exist/i.test(err.message) || /could not find the table/i.test(err.message));
}

export async function GET(req: NextRequest) {
  try {
    const auth = await authedClient(req);
    if (!auth.user) return NextResponse.json({ error: auth.error }, { status: 401 });

    const { data, error: dbErr } = await auth.sb
      .from("user_preferences")
      .select("dashboard_card_order, insights_card_order")
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (dbErr) {
      // Soft-fall back to defaults when the table simply isn't created yet.
      if (isMissingTable(dbErr)) {
        return NextResponse.json({ dashboard_card_order: [], insights_card_order: [] });
      }
      // eslint-disable-next-line no-console
      console.error("[preferences GET] db error:", dbErr.code, dbErr.message);
      return NextResponse.json({ error: dbErr.message }, { status: 500 });
    }

    return NextResponse.json({
      dashboard_card_order: Array.isArray(data?.dashboard_card_order) ? data!.dashboard_card_order : [],
      insights_card_order: Array.isArray(data?.insights_card_order) ? data!.insights_card_order : [],
    });
  } catch (e) {
    return errResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await authedClient(req);
    if (!auth.user) return NextResponse.json({ error: auth.error }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as {
      dashboard_card_order?: unknown;
      insights_card_order?: unknown;
    };

    const sanitize = (v: unknown): string[] | undefined => {
      if (v === undefined) return undefined;
      if (!Array.isArray(v)) return undefined;
      return v.filter((x): x is string => typeof x === "string").slice(0, 50);
    };

    const dashboard = sanitize(body.dashboard_card_order);
    const insights = sanitize(body.insights_card_order);

    if (dashboard === undefined && insights === undefined) {
      return NextResponse.json({ error: "no recognised preferences provided" }, { status: 400 });
    }

    const update: Record<string, unknown> = {
      user_id: auth.user.id,
      updated_at: new Date().toISOString(),
    };
    if (dashboard !== undefined) update.dashboard_card_order = dashboard;
    if (insights !== undefined) update.insights_card_order = insights;

    const { error: upsertErr } = await auth.sb
      .from("user_preferences")
      .upsert(update, { onConflict: "user_id" });

    if (upsertErr) {
      // eslint-disable-next-line no-console
      console.error("[preferences POST] upsert error:", upsertErr.code, upsertErr.message);
      const status = isMissingTable(upsertErr) ? 503 : 500;
      return NextResponse.json({ error: upsertErr.message }, { status });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errResponse(e);
  }
}
