import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (authHeader !== expected) {
    console.warn("[vercel-cron/elevated-check] unauthorized");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = `${process.env.SUPABASE_URL}/functions/v1/elevated-check`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "vercel-cron", ts: Date.now() }),
    });

    const text = await res.text();
    console.log(`[vercel-cron/elevated-check] edge response ${res.status}: ${text.slice(0, 200)}`);

    return NextResponse.json({ ok: res.ok, status: res.status });
  } catch (err) {
    console.error("[vercel-cron/elevated-check] fetch failed:", err);
    return NextResponse.json({ error: "fetch_failed", message: String(err) }, { status: 500 });
  }
}
