"use server";

import { revalidatePath } from "next/cache";
import type Stripe from "stripe";

import { getStripe } from "@/lib/stripeServer";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { writeAuditLog } from "@/lib/admin/audit";
import { isAdminAuthed } from "@/lib/adminAuth";

/**
 * Server actions that *write* to Stripe. Every call:
 *   1. Re-authenticates via the shared glev_ops_token cookie (lib/adminAuth).
 *   2. Fires the Stripe SDK call (live mode in production!).
 *   3. Best-effort syncs the local Supabase row so the UI reflects the
 *      change immediately (the official source of truth is still the
 *      Stripe webhook, but it can take a few seconds to come back).
 *   4. Writes an audit log entry with before/after state.
 *
 * IMPORTANT: in production (Vercel) STRIPE_SECRET_KEY is the *live*
 * key — these calls move real money / cancel real subscriptions.
 * The two-stage UI confirmation (window.confirm + targeted button per
 * action) is the operator's safety net.
 *
 * NOTE: All actions return { ok, error } instead of throwing so that
 * React 19 + useTransition on the client can surface errors via alert()
 * rather than the Next.js "Server Components render" error dialog.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

async function requireAdminToken(): Promise<void> {
  if (!(await isAdminAuthed())) {
    throw new Error("nicht eingeloggt");
  }
}

function revalidateAdminPaths(): void {
  revalidatePath("/glev-ops/buyers");
  revalidatePath("/glev-ops/users");
}

// ---------------------------------------------------------------------------

/**
 * Kündigt eine Stripe-Subscription. `mode='now'` storniert sofort,
 * `mode='period_end'` setzt nur cancel_at_period_end (User behält Pro
 * bis das laufende Intervall vorbei ist).
 */
export async function cancelStripeSubAction(formData: FormData): Promise<ActionResult> {
  try {
    await requireAdminToken();
    const subId = String(formData.get("subscriptionId") ?? "").trim();
    const mode = String(formData.get("mode") ?? "now");
    const email = String(formData.get("email") ?? "").trim().toLowerCase() || null;
    if (!subId) return { ok: false, error: "subscriptionId fehlt" };
    if (!["now", "period_end"].includes(mode)) return { ok: false, error: "Ungültiger Modus" };

    const stripe = getStripe();
    const before = await stripe.subscriptions.retrieve(subId);

    let after: Stripe.Subscription;
    if (mode === "now") {
      after = await stripe.subscriptions.cancel(subId);
    } else {
      after = await stripe.subscriptions.update(subId, { cancel_at_period_end: true });
    }

    try {
      const sb = getSupabaseAdmin();
      await sb
        .from("pro_subscriptions")
        .update({
          status: mode === "now" ? "cancelled" : (after.status ?? "active"),
        })
        .eq("stripe_subscription_id", subId);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[admin/stripe] local sync after cancel failed:", e);
    }

    await writeAuditLog({
      action: mode === "now" ? "stripe_cancel_now" : "stripe_cancel_period_end",
      targetEmail: email,
      before: { id: before.id, status: before.status, cancel_at_period_end: before.cancel_at_period_end },
      after: { id: after.id, status: after.status, cancel_at_period_end: after.cancel_at_period_end },
      note: mode === "now" ? "sofort gekündigt" : "kündigt zum Periodenende",
      adminToken: process.env.ADMIN_API_SECRET ?? "",
    });

    revalidateAdminPaths();
    return { ok: true };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[admin/stripe] cancelStripeSubAction failed:", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Löscht einen Stripe-Customer. Stripe lehnt ab, wenn aktive
 * Subscriptions dranhängen — dann zuerst kündigen.
 *
 * Lokale `pro_subscriptions`/`beta_reservations` werden NICHT
 * gelöscht (historische Daten bleiben), nur als `customer_deleted`
 * markiert wenn die Spalte existiert. Sonst nur Audit-Log.
 */
export async function deleteStripeCustomerAction(formData: FormData): Promise<ActionResult> {
  try {
    await requireAdminToken();
    const customerId = String(formData.get("customerId") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim().toLowerCase() || null;
    if (!customerId) return { ok: false, error: "customerId fehlt" };

    const stripe = getStripe();
    const result = await stripe.customers.del(customerId);

    await writeAuditLog({
      action: "stripe_delete_customer",
      targetEmail: email,
      before: { id: customerId },
      after: { deleted: result.deleted },
      adminToken: process.env.ADMIN_API_SECRET ?? "",
    });

    revalidateAdminPaths();
    return { ok: true };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[admin/stripe] deleteStripeCustomerAction failed:", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Erstattet die letzte bezahlte Invoice einer Pro-Subscription
 * komplett zurück. Falls `amountCents` mitgegeben wird, nur diese
 * Teilsumme.
 */
export async function refundLatestInvoiceAction(formData: FormData): Promise<ActionResult> {
  try {
    await requireAdminToken();
    const subId = String(formData.get("subscriptionId") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim().toLowerCase() || null;
    const amountStr = String(formData.get("amountCents") ?? "").trim();
    const amountCents = amountStr ? Number(amountStr) : undefined;
    if (!subId) return { ok: false, error: "subscriptionId fehlt" };
    if (amountCents !== undefined && (!Number.isFinite(amountCents) || amountCents <= 0)) {
      return { ok: false, error: "Ungültiger Betrag" };
    }

    const stripe = getStripe();

    const list = await stripe.invoices.list({
      subscription: subId,
      status: "paid",
      limit: 20,
    });
    type InvoiceWithPI = Stripe.Invoice & {
      payment_intent?: string | Stripe.PaymentIntent | null;
    };
    const candidates = (list.data as InvoiceWithPI[]).filter(
      (inv) => (inv.amount_paid ?? 0) > 0,
    );
    if (candidates.length === 0) {
      return { ok: false, error: "Keine bezahlte Invoice für diese Subscription gefunden" };
    }
    const invoice = candidates[0];
    const amountPaid = invoice.amount_paid ?? 0;

    if (amountCents !== undefined && amountCents > amountPaid) {
      return {
        ok: false,
        error: `Teilrefund (${(amountCents / 100).toFixed(2)}€) übersteigt bezahlten Betrag (${(
          amountPaid / 100
        ).toFixed(2)}€)`,
      };
    }

    const piRaw = invoice.payment_intent;
    const paymentIntentId =
      typeof piRaw === "string" ? piRaw : piRaw && "id" in piRaw ? piRaw.id : null;
    if (!paymentIntentId) {
      return { ok: false, error: "Invoice hat kein Payment Intent (z.B. 0€-Trial)" };
    }

    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      ...(amountCents ? { amount: amountCents } : {}),
    });

    await writeAuditLog({
      action: "stripe_refund",
      targetEmail: email,
      before: {
        subscriptionId: subId,
        invoiceId: invoice.id,
        invoice_created: invoice.created,
        amount_paid: amountPaid,
        paymentIntentId,
        requested_amount: amountCents ?? "full",
      },
      after: {
        refundId: refund.id,
        amount: refund.amount,
        status: refund.status,
      },
      note: amountCents
        ? `Teilrefund ${(amountCents / 100).toFixed(2)}€ auf Invoice ${invoice.id}`
        : `Voll-Refund (${(amountPaid / 100).toFixed(2)}€) auf Invoice ${invoice.id}`,
      adminToken: process.env.ADMIN_API_SECRET ?? "",
    });

    revalidateAdminPaths();
    return { ok: true };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[admin/stripe] refundLatestInvoiceAction failed:", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Verlängert die Trial-Phase einer Pro-Subscription um N Tage.
 */
export async function extendStripeTrialAction(formData: FormData): Promise<ActionResult> {
  try {
    await requireAdminToken();
    const subId = String(formData.get("subscriptionId") ?? "").trim();
    const days = Number(String(formData.get("days") ?? "0"));
    const email = String(formData.get("email") ?? "").trim().toLowerCase() || null;
    if (!subId) return { ok: false, error: "subscriptionId fehlt" };
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      return { ok: false, error: "Tage müssen zwischen 1 und 365 liegen" };
    }

    const stripe = getStripe();
    const before = await stripe.subscriptions.retrieve(subId);
    const nowSec = Math.floor(Date.now() / 1000);
    const baseSec = Math.max(before.trial_end ?? 0, nowSec);
    const newTrialEnd = baseSec + days * 86_400;

    const after = await stripe.subscriptions.update(subId, {
      trial_end: newTrialEnd,
      proration_behavior: "none",
    });

    try {
      const sb = getSupabaseAdmin();
      await sb
        .from("pro_subscriptions")
        .update({ trial_ends_at: new Date(newTrialEnd * 1000).toISOString() })
        .eq("stripe_subscription_id", subId);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[admin/stripe] local sync after extendTrial failed:", e);
    }

    await writeAuditLog({
      action: "stripe_extend_trial",
      targetEmail: email,
      before: { trial_end: before.trial_end },
      after: { trial_end: after.trial_end },
      note: `+${days} Tage`,
      adminToken: process.env.ADMIN_API_SECRET ?? "",
    });

    revalidateAdminPaths();
    return { ok: true };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[admin/stripe] extendStripeTrialAction failed:", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
