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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    const auth = await authedClient(req);
    if (!auth.user) return NextResponse.json({ error: auth.error }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as {
      selected_option_id?: unknown;
      free_text?: unknown;
    };

    if (typeof body.selected_option_id !== "string" || !body.selected_option_id) {
      return NextResponse.json({ error: "selected_option_id required" }, { status: 400 });
    }

    const freeText =
      typeof body.free_text === "string" ? body.free_text.slice(0, 200) || null : null;

    // Verify session exists and is active
    const { data: session } = await auth.sb
      .from("community_vote_sessions")
      .select("id, status")
      .eq("id", sessionId)
      .maybeSingle();

    if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
    if (session.status !== "active") {
      return NextResponse.json({ error: "session is not active" }, { status: 409 });
    }

    // Check user has voting enabled
    const { data: profile } = await auth.sb
      .from("profiles")
      .select("community_voting_enabled")
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (profile?.community_voting_enabled !== true) {
      return NextResponse.json({ error: "voting not enabled" }, { status: 403 });
    }

    // Insert vote
    const { error: insertError } = await auth.sb.from("community_votes").insert({
      session_id: sessionId,
      user_id: auth.user.id,
      selected_option_id: body.selected_option_id,
      free_text: freeText,
      weight: 1.0,
    });

    if (insertError) {
      // 23505 = UNIQUE constraint violation → already voted
      if (insertError.code === "23505") {
        return NextResponse.json({ error: "already voted" }, { status: 409 });
      }
      console.error("[community/votes/submit] db error:", insertError.code, insertError.message);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
