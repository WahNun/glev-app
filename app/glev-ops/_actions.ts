"use server";

import { redirect } from "next/navigation";
import { clearAdminCookie } from "@/lib/adminAuth";
import { sharedLogin } from "@/lib/admin/sharedLogin";

export async function loginAction(formData: FormData): Promise<void> {
  const email    = String(formData.get("email")    ?? "");
  const password = String(formData.get("password") ?? "");
  const totp     = String(formData.get("totp")     ?? "");

  const result = await sharedLogin(email, password, totp);
  if (!result) redirect("/glev-ops?err=bad");
  redirect(result.dest);
}

export async function logoutAction(): Promise<void> {
  await clearAdminCookie();
  redirect("/glev-ops");
}
