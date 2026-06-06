"use server";

import { redirect } from "next/navigation";
import { sharedLogin } from "@/lib/admin/sharedLogin";

export async function loginAction(formData: FormData): Promise<void> {
  const email    = String(formData.get("email")    ?? "");
  const password = String(formData.get("password") ?? "");
  const totp     = String(formData.get("totp")     ?? "");

  const result = await sharedLogin(email, password, totp);
  if (!result) redirect("/glev-ops/login?err=bad");
  redirect(result.dest);
}
