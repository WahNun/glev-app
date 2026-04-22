import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  if (!supabase) return NextResponse.json({ isAuthenticated: false, userId: null, email: null, error: "Supabase not configured" });

  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) {
      return NextResponse.json({ isAuthenticated: false, userId: null, email: null, error: error?.message || "No active session" });
    }
    return NextResponse.json({
      isAuthenticated: true,
      userId: session.user.id,
      email: session.user.email ?? null,
      sessionExpiresAt: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
      error: null,
    });
  } catch (e) {
    return NextResponse.json({ isAuthenticated: false, userId: null, email: null, error: e instanceof Error ? e.message : "Unknown error" });
  }
}
