"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { isAdminAuthed, ADMIN_COOKIE, setTeamCookie } from "@/lib/adminAuth";
import {
  createTeamMember,
  deleteTeamMember,
  resetTeamMemberPassword,
  changeOwnPassword,
  verifyTeamMember,
} from "@/lib/admin/teamUsers";

async function requireAdmin(): Promise<void> {
  const ok = await isAdminAuthed();
  if (!ok) redirect("/glev-ops/users");
}

/** Get current team-user ID from cookie (if team: format). */
async function getCurrentTeamUserId(): Promise<string | null> {
  const store = await cookies();
  const tok   = store.get(ADMIN_COOKIE)?.value ?? "";
  if (!tok.startsWith("team:")) return null;
  const parts = tok.split(":");
  return parts[1] ?? null;
}

export async function addTeamMemberAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const email    = String(formData.get("email")    ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();
  const role     = String(formData.get("role")     ?? "marketer") as "admin" | "marketer";
  const name     = String(formData.get("name")     ?? "").trim() || undefined;

  if (!email || password.length < 8) {
    redirect("/glev-ops/team?err=invalid");
  }

  await createTeamMember(email, password, role, name);
  revalidatePath("/glev-ops/team");
  redirect("/glev-ops/team?ok=added");
}

export async function deleteTeamMemberAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  await deleteTeamMember(id);
  revalidatePath("/glev-ops/team");
  redirect("/glev-ops/team?ok=deleted");
}

export async function resetPasswordAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id          = String(formData.get("id")          ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  if (newPassword.length < 8) redirect("/glev-ops/team?err=short");
  await resetTeamMemberPassword(id, newPassword);
  revalidatePath("/glev-ops/team");
  redirect("/glev-ops/team?ok=reset");
}

/** Used by the member themselves to change their own password after first login. */
export async function changeOwnPasswordAction(formData: FormData): Promise<void> {
  const userId = await getCurrentTeamUserId();
  if (!userId) redirect("/glev-ops/users");

  const current = String(formData.get("current") ?? "");
  const newPw   = String(formData.get("newPw")   ?? "");
  const email   = String(formData.get("email")   ?? "");

  if (newPw.length < 8) redirect("/glev-ops/team/change-password?err=short");

  // Verify current password
  const ok = await verifyTeamMember(email, current);
  if (!ok || ok.id !== userId) redirect("/glev-ops/team/change-password?err=wrong");

  await changeOwnPassword(userId, newPw);

  // Refresh cookie (must_change_pw is now false → won't redirect back)
  await setTeamCookie(ok.id, ok.role);

  revalidatePath("/glev-ops/team");
  redirect(ok.role === "admin" ? "/glev-ops/users" : "/glev-ops/crm");
}
