import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${process.env.META_BACKFILL_AUTH}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: leads, error } = await supabase
    .from("meta_leads")
    .select("id, email, leadgen_id, created_at")
    .gte("received_at", "2026-06-22T00:00:00Z");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: { email: string; ok: boolean; status: number | null }[] = [];

  for (const lead of leads ?? []) {
    const eventId = `backfill-${lead.leadgen_id || lead.id}-${Date.now()}`;
    try {
      const res = await fetch(process.env.META_TARN_CAPI_URL!, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.META_TARN_CAPI_SECRET}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          event_name: "Signup",
          event_id: eventId,
          user_data: { email: lead.email },
          custom_data: { plan: "free", source: "capi_backfill_20260625" },
        }),
      });
      results.push({ email: lead.email, ok: res.ok, status: res.status });
    } catch (err) {
      console.error(`[capi-backfill] failed for ${lead.email}:`, err);
      results.push({ email: lead.email, ok: false, status: null });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
