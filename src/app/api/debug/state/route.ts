import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase not configured", meals: [], count: 0, last: null });

  try {
    const { count, error: countErr } = await supabase.from("meals").select("id", { count: "exact", head: true });
    const { data: meals, error: dataErr } = await supabase.from("meals").select("*").order("created_at", { ascending: false }).limit(20);
    const last = meals?.[0] ?? null;
    const error = countErr?.message || dataErr?.message || null;

    return NextResponse.json({ ok: !error, meals: meals ?? [], count: count ?? 0, last, error });
  } catch (e) {
    return NextResponse.json({ ok: false, meals: [], count: 0, last: null, error: e instanceof Error ? e.message : "Unknown error" });
  }
}
