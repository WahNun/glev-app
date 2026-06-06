import {
  verifyAdminCredentials,
  verifyMarketerCredentials,
  setAdminCookie,
  setMarketerCookie,
  setTeamCookie,
} from "@/lib/adminAuth";
import { verifyTeamMember } from "@/lib/admin/teamUsers";

export type LoginResult =
  | { role: "admin"; dest: string }
  | { role: "marketer"; dest: string }
  | null;

/**
 * Shared three-path login logic used by every /glev-ops loginAction.
 * Returns null on failure (caller should redirect to ?err=bad).
 * On success, sets the session cookie and returns the destination path.
 */
export async function sharedLogin(
  email: string,
  password: string,
  totp: string,
  successDest?: string,
): Promise<LoginResult> {
  // 1. Master admin (env vars)
  const isAdmin = await verifyAdminCredentials(email, password, totp);
  if (isAdmin) {
    await setAdminCookie();
    return { role: "admin", dest: successDest ?? "/glev-ops/users" };
  }

  // 2. Marketer (env vars)
  const isMarketer = await verifyMarketerCredentials(email, password);
  if (isMarketer) {
    await setMarketerCookie();
    return { role: "marketer", dest: successDest ?? "/glev-ops/crm" };
  }

  // 3. Team member (Supabase glev_ops_users)
  let teamMember = null;
  try {
    teamMember = await verifyTeamMember(email, password);
  } catch (err) {
    console.error("[sharedLogin] verifyTeamMember error:", err);
  }
  if (teamMember) {
    await setTeamCookie(teamMember.id, teamMember.role);
    if (teamMember.must_change_pw) {
      return { role: teamMember.role, dest: "/glev-ops/team/change-password" };
    }
    return {
      role: teamMember.role,
      dest: teamMember.role === "admin" ? "/glev-ops/users" : "/glev-ops/crm",
    };
  }

  return null;
}
