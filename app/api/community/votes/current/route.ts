import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";
import type { VoteSession, VoteOption } from "@/lib/community/types";

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

export async function GET(req: NextRequest) {
  try {
    const auth = await authedClient(req);
    if (!auth.user) return NextResponse.json({ error: auth.error }, { status: 401 });

    const { data: profile } = await auth.sb
      .from("profiles")
      .select("community_voting_enabled")
      .eq("user_id", auth.user.id)
      .maybeSingle();

    const voting_enabled = profile?.community_voting_enabled === true;

    const { data: session } = await auth.sb
      .from("community_vote_sessions")
      .select("id, question, status, created_at, closed_at")
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    if (!session) {
      return NextResponse.json({ session: null, has_voted: false, voting_enabled });
    }

    const { data: options } = await auth.sb
      .from("community_vote_options")
      .select("id, cluster_id, label")
      .eq("session_id", session.id)
      .order("created_at");

    const { data: existingVote } = await auth.sb
      .from("community_votes")
      .select("id")
      .eq("session_id", session.id)
      .eq("user_id", auth.user.id)
      .maybeSingle();

    const voteSession: VoteSession = {
      ...session,
      options: (options ?? []) as VoteOption[],
    };

    return NextResponse.json({
      session: voteSession,
      has_voted: existingVote !== null,
      voting_enabled,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
