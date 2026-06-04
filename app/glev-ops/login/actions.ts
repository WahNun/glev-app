"use server";

import { redirect } from "next/navigation";
import {
  verifyAdminCredentials,
  verifyMarketerCredentials,
  setAdminCookie,
  setMarketerCookie,
} from "@/lib/adminAuth";

/**
 * Shared login action for /glev-ops/login.
 * Tries marketer credentials first, then admin credentials.
 * Marketer → /glev-ops/crm, Admin → /glev-ops.
 */
export async function loginAction(formData: FormData): Promise<void> {
  const email    = String(formData.get("email")    ?? "");
  const password = String(formData.get("password") ?? "");
  const totp     = String(formData.get("totp")     ?? "");

  const marketerOk = await verifyMarketerCredentials(email, password);
  if (marketerOk) {
    await setMarketerCookie();
    redirect("/glev-ops/crm");
  }

  const adminOk = await verifyAdminCredentials(email, password, totp);
  if (adminOk) {
    await setAdminCookie();
    redirect("/glev-ops");
  }

  redirect("/glev-ops/login?err=bad");
}
