"use server";

import { redirect } from "next/navigation";
import { verifyAdminCredentials, setAdminCookie, clearAdminCookie } from "@/lib/adminAuth";


const SELF = "/glev-ops/drip-stats";

export async function loginAction(formData: FormData): Promise<void> {
  const email    = String(formData.get("email")    ?? "");
  const password = String(formData.get("password") ?? "");
  const totp     = String(formData.get("totp")     ?? "");
  const ok = await verifyAdminCredentials(email, password, totp);
  if (!ok) redirect(`${SELF}?err=bad`);
  await setAdminCookie();
  redirect(SELF);
}

export async function logoutAction(): Promise<void> {
  await clearAdminCookie();
  redirect(SELF);
}
