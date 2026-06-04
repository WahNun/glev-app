import AdminLoginForm from "../_components/AdminLoginForm";
import { loginAction } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dedicated login page for /glev-ops.
 *
 * Accepts both admin (ADMIN_EMAIL + ADMIN_API_SECRET) and marketer
 * (MARKETER_EMAIL + MARKETER_PASSWORD) credentials via the same form.
 * - Admin → redirected to /glev-ops (full panel)
 * - Marketer → redirected to /glev-ops/crm (CRM only)
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const errParam = Array.isArray(sp.err) ? sp.err[0] : sp.err;
  const err = errParam === "bad" ? "Login fehlgeschlagen." : null;

  return (
    <AdminLoginForm
      action={loginAction}
      title="Glev — Admin"
      description="Für Marketer-Zugang mit den CRM-Zugangsdaten einloggen."
      error={err}
    />
  );
}
