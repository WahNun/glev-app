"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

export interface BetaCheckoutState {
  error?: string;
  /** Set when capacity was hit between page load and submit so the form
   *  can degrade gracefully to a mailto link instead of a hard error. */
  full?: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_ERROR =
  "Leider hat der Checkout nicht funktioniert — probier es gleich nochmal.";

async function resolveOrigin(): Promise<string> {
  const env = process.env.NEXT_PUBLIC_SITE_ORIGIN;
  if (env) return env.replace(/\/$/, "");
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  return host ? `${proto}://${host}` : "";
}

/**
 * Server Action used by the /beta hero form. Same shape and rationale as
 * startProCheckout — exposes the existing /api/beta/checkout logic to a
 * native `<form action={…}>` so the submit works even before React
 * hydrates (the symptom the user reported was a default GET reload back
 * to /beta with email in the query string).
 *
 * Capacity exhaustion (Stripe checkout returns 409) is signalled via
 * `{ full: true }` so the client can swap the CTA to a mailto link
 * without a confusing red error message.
 */
export async function startBetaCheckout(
  _prev: BetaCheckoutState | null,
  formData: FormData,
): Promise<BetaCheckoutState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { error: "Bitte gib eine gültige Email-Adresse ein." };
  }

  const origin = await resolveOrigin();
  if (!origin) {
    return { error: GENERIC_ERROR };
  }

  let status = 0;
  let data: { url?: string; error?: string } = {};
  try {
    const res = await fetch(`${origin}/api/beta/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
      cache: "no-store",
    });
    status = res.status;
    data = (await res.json().catch(() => ({}))) as {
      url?: string;
      error?: string;
    };
  } catch {
    return { error: GENERIC_ERROR };
  }

  if (status === 409) {
    // Capacity hit between count poll and submit — surface as `full` so the
    // form degrades to a mailto fallback (same as the legacy onSubmit did).
    return { full: true };
  }
  if (status < 200 || status >= 300 || !data.url) {
    return { error: data.error ?? GENERIC_ERROR };
  }

  redirect(data.url);
}
