"use server";

import { redirect } from "next/navigation";
import { verifyAdminCredentials, setAdminCookie, clearAdminCookie } from "@/lib/adminAuth";

export async function loginAction(formData: FormData): Promise<void> {
  const email    = String(formData.get("email")    ?? "");
  const password = String(formData.get("password") ?? "");
  const totp     = String(formData.get("totp")     ?? "");
  const ok = await verifyAdminCredentials(email, password, totp);
  if (!ok) redirect("/glev-ops?err=bad");
  await setAdminCookie();
  redirect("/glev-ops");
}

export async function logoutAction(): Promise<void> {
  await clearAdminCookie();
  redirect("/glev-ops");
}
