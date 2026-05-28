"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { timingSafeEqual } from "crypto";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const COOKIE = "glev_admin_token";

function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export async function loginAction(formData: FormData): Promise<void> {
  const expected = process.env.ADMIN_API_SECRET ?? "";
  if (!expected || expected.length < 16) {
    redirect("/admin/outbox?err=server");
  }
  const submitted = String(formData.get("token") ?? "");
  if (!submitted || !constantTimeEqual(submitted, expected)) {
    redirect("/admin/outbox?err=bad");
  }
  const store = await cookies();
  store.set(COOKIE, submitted, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge: 60 * 60 * 8,
  });
  redirect("/admin/outbox");
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
  redirect("/admin/outbox");
}

export async function isAdminAuthed(): Promise<boolean> {
  const expected = process.env.ADMIN_API_SECRET ?? "";
  if (!expected || expected.length < 16) return false;
  const store = await cookies();
  const tok = store.get(COOKIE)?.value ?? "";
  if (!tok) return false;
  return constantTimeEqual(tok, expected);
}

async function requireAdmin(): Promise<void> {
  const ok = await isAdminAuthed();
  if (!ok) redirect("/admin/outbox");
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
  revalidatePath("/admin/outbox");
}
