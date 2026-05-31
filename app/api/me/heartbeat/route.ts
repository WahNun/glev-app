// Heartbeat — aktualisiert profiles.last_seen_at für Re-Engagement-Tracking.
//
// POST /api/me/heartbeat
//
// Wird von LayoutInner einmal pro Session aufgerufen (sessionStorage-Guard).
// Die Route schreibt last_seen_at nur, wenn der letzte Wert älter als 6 Stunden
// ist, um Supabase-Writes bei jedem Tab-Wechsel zu vermeiden.
//
// Kein Request-Body nötig — User wird aus dem Session-Cookie gelesen.

import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  void req;

  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "";

  const cookieStore = await cookies();
  const ssrClient = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () =>
        cookieStore.getAll().map((c) => ({ name: c.name, value: c.value })),
      setAll: () => {},
    },
  });

  const {
    data: { user },
  } = await ssrClient.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const sixHoursAgo = new Date(
    Date.now() - 6 * 60 * 60 * 1000,
  ).toISOString();

  const admin = getSupabaseAdmin();
  await admin
    .from("profiles")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .or(`last_seen_at.is.null,last_seen_at.lt.${sixHoursAgo}`);

  return NextResponse.json({ ok: true });
}
