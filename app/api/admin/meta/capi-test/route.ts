import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/meta/capi-test
 *
 * Feuert ein einzelnes Test-Signup-Event via Tarn-Worker (mealpatterns.app).
 * Kein Meta Lead Form nötig, kein Algo-Impact.
 *
 * Auth: Bearer META_BACKFILL_AUTH
 * Body (optional): { "email": "test@example.com" }
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${process.env.META_BACKFILL_AUTH}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tarnUrl = process.env.META_TARN_CAPI_URL;
  const tarnSecret = process.env.META_TARN_CAPI_SECRET;
  if (!tarnUrl || !tarnSecret) {
    return NextResponse.json({ error: "META_TARN_CAPI_URL or _SECRET not set" }, { status: 500 });
  }

  let body: { email?: string } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  const testEmail = body.email ?? `capi-test-${Date.now()}@glev-internal.test`;
  const eventId = `capi-test-${Date.now()}`;

  const res = await fetch(tarnUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tarnSecret}`,
    },
    body: JSON.stringify({
      event_name: "Signup",
      event_id: eventId,
      user_data: { email: testEmail },
      custom_data: { plan: "free", source: "capi_test_manual" },
    }),
  });

  const text = await res.text();
  return NextResponse.json({
    ok: res.ok,
    status: res.status,
    tarn_response: text,
    event_id: eventId,
    email_used: testEmail,
  });
}
