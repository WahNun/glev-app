import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { BETA_CAPACITY } from "@/lib/stripeServer";

// Cache the response for 60s so the landing page can poll without hammering Supabase.
export const revalidate = 60;
export const dynamic = "force-dynamic"; // we still want it server-rendered, not statically baked at build time

export async function GET() {
  try {
    const sb = getSupabaseAdmin();
    const { count, error } = await sb
      .from("beta_reservations")
      .select("*", { count: "exact", head: true })
      .eq("status", "paid");

    if (error) {
      // Most common cause in dev: migration not yet applied. Soft-fall back so the
      // page still renders a counter at 0/500.
      // eslint-disable-next-line no-console
      console.warn("[beta/count] supabase error:", error.code, error.message);
      return NextResponse.json(
        { count: 0, capacity: BETA_CAPACITY, remaining: BETA_CAPACITY, degraded: true },
        { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
      );
    }

    const used = count ?? 0;
    return NextResponse.json(
      {
        count: used,
        capacity: BETA_CAPACITY,
        remaining: Math.max(0, BETA_CAPACITY - used),
      },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[beta/count] unexpected:", e);
    return NextResponse.json(
      { count: 0, capacity: BETA_CAPACITY, remaining: BETA_CAPACITY, degraded: true },
      { status: 200 },
    );
  }
}
