import { NextRequest, NextResponse } from "next/server";
import { getStripe, BETA_CAPACITY, BETA_AMOUNT_CENTS } from "@/lib/stripeServer";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const GENERIC_ERROR = "Leider hat der Checkout nicht funktioniert — probier es gleich nochmal";

function getOrigin(req: NextRequest): string {
  // Trust the public origin first (works behind proxies / Vercel),
  // fall back to request URL.
  const env = process.env.NEXT_PUBLIC_SITE_ORIGIN;
  if (env) return env.replace(/\/$/, "");
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  return `${proto}://${host}`;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { email?: unknown };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email || !EMAIL_RE.test(email) || email.length > 200) {
      return NextResponse.json({ error: "Bitte gib eine gültige Email-Adresse ein." }, { status: 400 });
    }

    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_BETA_PRICE_ID) {
      // eslint-disable-next-line no-console
      console.error("[beta/checkout] Stripe env not configured");
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 503 });
    }

    const sb = getSupabaseAdmin();

    // 1. Look up any existing row for this email *before* writing anything,
    //    so a previously paid reservation can never be overwritten back to
    //    pending (which would otherwise let the same email be charged twice).
    const { data: existing, error: lookupErr } = await sb
      .from("beta_reservations")
      .select("id, status")
      .eq("email", email)
      .maybeSingle();

    if (lookupErr) {
      // eslint-disable-next-line no-console
      console.error("[beta/checkout] lookup error:", lookupErr.code, lookupErr.message);
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
    }

    // Already paid → short-circuit to the success page, do NOT create a new session.
    if (existing?.status === "paid") {
      const origin = getOrigin(req);
      return NextResponse.json({ url: `${origin}/beta/success` });
    }

    // 2. Capacity gate — count *paid* rows only. Pending rows might never convert.
    const { count: paidCount, error: countErr } = await sb
      .from("beta_reservations")
      .select("*", { count: "exact", head: true })
      .eq("status", "paid");

    if (countErr) {
      // eslint-disable-next-line no-console
      console.error("[beta/checkout] count error:", countErr.code, countErr.message);
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
    }

    if ((paidCount ?? 0) >= BETA_CAPACITY) {
      return NextResponse.json(
        { error: "Beta voll — bitte auf die Warteliste eintragen." },
        { status: 409 },
      );
    }

    // 3. Insert (no existing row) or refresh the pending row. We only ever
    //    write status='pending' here, never overwrite a non-pending row.
    let rowId: string;
    if (!existing) {
      const { data: inserted, error: insertErr } = await sb
        .from("beta_reservations")
        .insert({
          email,
          status: "pending",
          amount_cents: BETA_AMOUNT_CENTS,
          currency: "eur",
        })
        .select("id")
        .single();

      if (insertErr || !inserted) {
        // eslint-disable-next-line no-console
        console.error("[beta/checkout] insert error:", insertErr?.code, insertErr?.message);
        return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
      }
      rowId = inserted.id;
    } else {
      // Existing pending / cancelled / refunded row — keep id, refresh status to pending
      // so a previously cancelled checkout can retry. Guard with `.neq("status","paid")`
      // as defense-in-depth in case of a race between the lookup and update.
      const { error: updErr } = await sb
        .from("beta_reservations")
        .update({ status: "pending" })
        .eq("id", existing.id)
        .neq("status", "paid");

      if (updErr) {
        // eslint-disable-next-line no-console
        console.error("[beta/checkout] refresh error:", updErr.code, updErr.message);
        return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
      }
      rowId = existing.id;
    }

    const origin = getOrigin(req);
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: process.env.STRIPE_BETA_PRICE_ID!, quantity: 1 }],
      customer_email: email,
      metadata: {
        feature: "beta_reservation",
        reservation_id: rowId,
      },
      payment_intent_data: {
        metadata: {
          feature: "beta_reservation",
          reservation_id: rowId,
        },
      },
      success_url: `${origin}/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/beta/cancelled`,
      locale: "de",
    });

    if (!session.url) {
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
    }

    // Persist session id, but never on a row that has somehow already been
    // marked paid (defense-in-depth against races with the webhook).
    await sb
      .from("beta_reservations")
      .update({ stripe_session_id: session.id })
      .eq("id", rowId)
      .neq("status", "paid");

    return NextResponse.json({ url: session.url });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[beta/checkout] unexpected:", e);
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
  }
}
