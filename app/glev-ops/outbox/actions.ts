"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { verifyAdminCredentials, setAdminCookie, clearAdminCookie, isAdminAuthed } from "@/lib/adminAuth";


export async function loginAction(formData: FormData): Promise<void> {
  const email    = String(formData.get("email")    ?? "");
  const password = String(formData.get("password") ?? "");
  const totp     = String(formData.get("totp")     ?? "");
  const ok = await verifyAdminCredentials(email, password, totp);
  if (!ok) redirect("/glev-ops/outbox?err=bad");
  await setAdminCookie();
  redirect("/glev-ops/outbox");
}

export async function logoutAction(): Promise<void> {
  await clearAdminCookie();
  redirect("/glev-ops/outbox");
}

async function requireAdmin(): Promise<void> {
  const ok = await isAdminAuthed();
  if (!ok) redirect("/glev-ops/outbox");
}

/**
 * Reset a dead outbox row back to pending with attempts=0 and
 * next_attempt_at=now so the cron worker picks it up on the next run.
 *
 * Only works on rows with status='dead' — the .eq("status","dead") guard
 * prevents accidental resets of rows that are already being processed.
 */
export async function retryDeadAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("email_outbox")
    .update({
      status: "pending",
      attempts: 0,
      next_attempt_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", id)
    .eq("status", "dead");

  if (error) {
    // eslint-disable-next-line no-console
    console.error("[admin/outbox] retryDead failed:", { id, err: error.message });
  } else {
    // eslint-disable-next-line no-console
    console.log("[admin/outbox] retryDead ok:", { id });
  }
  revalidatePath("/glev-ops/outbox");
}
