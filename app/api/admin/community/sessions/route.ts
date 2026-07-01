import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthed } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OptionWithCount = {
  id: string;
  label: string;
  cluster_id: string | null;
  vote_count: number;
};

type SessionWithCounts = {
  id: string;
  question: string;
  status: string;
  created_at: string;
  closed_at: string | null;
  options: OptionWithCount[];
  total_votes: number;
};

export async function GET() {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();

  const { data: sessions, error: sessErr } = await admin
    .from("community_vote_sessions")
    .select("id, question, status, created_at, closed_at")
    .order("created_at", { ascending: false });

  if (sessErr) {
    return NextResponse.json({ error: sessErr.message }, { status: 500 });
  }

  if (!sessions || sessions.length === 0) {
    return NextResponse.json({ sessions: [] });
  }

  const sessionIds = sessions.map((s: { id: string }) => s.id);

  const { data: allOptions } = await admin
    .from("community_vote_options")
    .select("id, session_id, cluster_id, label")
    .in("session_id", sessionIds)
    .order("created_at");

  const { data: allVotes } = await admin
    .from("community_votes")
    .select("selected_option_id")
    .in("session_id", sessionIds);

  // Aggregate vote counts per option
  const voteCounts: Record<string, number> = {};
  for (const v of allVotes ?? []) {
    const id = v.selected_option_id as string;
    voteCounts[id] = (voteCounts[id] ?? 0) + 1;
  }

  // Group options by session
  const optionsBySession: Record<string, OptionWithCount[]> = {};
  for (const opt of allOptions ?? []) {
    const o = opt as { id: string; session_id: string; cluster_id: string | null; label: string };
    if (!optionsBySession[o.session_id]) optionsBySession[o.session_id] = [];
    optionsBySession[o.session_id].push({
      id: o.id,
      label: o.label,
      cluster_id: o.cluster_id,
      vote_count: voteCounts[o.id] ?? 0,
    });
  }

  const result: SessionWithCounts[] = sessions.map((s: { id: string; question: string; status: string; created_at: string; closed_at: string | null }) => {
    const options = optionsBySession[s.id] ?? [];
    return {
      ...s,
      options,
      total_votes: options.reduce((sum, o) => sum + o.vote_count, 0),
    };
  });

  return NextResponse.json({ sessions: result });
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    question?: unknown;
    options?: unknown;
    status?: unknown;
  };

  if (typeof body.question !== "string" || !body.question.trim()) {
    return NextResponse.json({ error: "question required" }, { status: 400 });
  }
  if (!Array.isArray(body.options) || body.options.length < 2 || body.options.length > 4) {
    return NextResponse.json({ error: "options must be 2–4 strings" }, { status: 400 });
  }
  const optionLabels = body.options as unknown[];
  if (!optionLabels.every((o) => typeof o === "string" && (o as string).trim())) {
    return NextResponse.json({ error: "each option must be a non-empty string" }, { status: 400 });
  }

  const status = body.status === "active" ? "active" : "draft";
  const admin  = getSupabaseAdmin();

  const { data: session, error: sessErr } = await admin
    .from("community_vote_sessions")
    .insert({ question: body.question.trim(), status })
    .select("id")
    .single();

  if (sessErr || !session) {
    return NextResponse.json({ error: sessErr?.message ?? "insert failed" }, { status: 500 });
  }

  const { error: optErr } = await admin.from("community_vote_options").insert(
    (optionLabels as string[]).map((label) => ({
      session_id: session.id,
      label: label.trim(),
      cluster_id: null,
    })),
  );

  if (optErr) {
    // Clean up orphaned session
    await admin.from("community_vote_sessions").delete().eq("id", session.id);
    return NextResponse.json({ error: optErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, session_id: session.id });
}
