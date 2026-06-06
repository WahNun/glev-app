"use server";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { hashPassword, verifyPassword } from "@/lib/adminAuth";

export interface GlevOpsUser {
  id:             string;
  email:          string;
  role:           "admin" | "marketer";
  name:           string | null;
  must_change_pw: boolean;
  created_at:     string;
  last_login_at:  string | null;
}

/** Verify email + password against glev_ops_users. Returns user row or null. */
export async function verifyTeamMember(
  email: string,
  password: string,
): Promise<GlevOpsUser | null> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("glev_ops_users")
    .select("id, email, role, name, must_change_pw, created_at, last_login_at, password_hash")
    .eq("email", email.toLowerCase().trim())
    .single();

  if (!data) return null;

  const ok = await verifyPassword(password, data.password_hash as string);
  if (!ok) return null;

  // Update last_login_at
  await supabase
    .from("glev_ops_users")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", data.id);

  const { password_hash: _ph, ...user } = data;
  return user as GlevOpsUser;
}

/** List all team members (no password_hash). */
export async function listTeamMembers(): Promise<GlevOpsUser[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("glev_ops_users")
    .select("id, email, role, name, must_change_pw, created_at, last_login_at")
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as GlevOpsUser[];
}

/** Create a team member with a plain-text password (will be hashed). */
export async function createTeamMember(
  email: string,
  plainPassword: string,
  role: "admin" | "marketer",
  name?: string,
  mustChangePw = false,
): Promise<GlevOpsUser> {
  const supabase     = getSupabaseAdmin();
  const passwordHash = await hashPassword(plainPassword);

  const { data, error } = await supabase
    .from("glev_ops_users")
    .insert({
      email:         email.toLowerCase().trim(),
      password_hash: passwordHash,
      role,
      name:          name ?? null,
      must_change_pw: mustChangePw,
    })
    .select("id, email, role, name, must_change_pw, created_at, last_login_at")
    .single();

  if (error) throw new Error(error.message);
  return data as GlevOpsUser;
}

/** Reset a team member's password. Sets must_change_pw = true. */
export async function resetTeamMemberPassword(
  userId: string,
  newPlainPassword: string,
): Promise<void> {
  const supabase     = getSupabaseAdmin();
  const passwordHash = await hashPassword(newPlainPassword);

  const { error } = await supabase
    .from("glev_ops_users")
    .update({ password_hash: passwordHash, must_change_pw: true })
    .eq("id", userId);

  if (error) throw new Error(error.message);
}

/** Change own password (clears must_change_pw). */
export async function changeOwnPassword(
  userId: string,
  newPlainPassword: string,
): Promise<void> {
  const supabase     = getSupabaseAdmin();
  const passwordHash = await hashPassword(newPlainPassword);

  const { error } = await supabase
    .from("glev_ops_users")
    .update({ password_hash: passwordHash, must_change_pw: false })
    .eq("id", userId);

  if (error) throw new Error(error.message);
}

/** Delete a team member. */
export async function deleteTeamMember(userId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("glev_ops_users")
    .delete()
    .eq("id", userId);

  if (error) throw new Error(error.message);
}
