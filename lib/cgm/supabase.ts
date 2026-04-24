import { createClient, SupabaseClient } from "@supabase/supabase-js";

function envUrl(): string {
  const v = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!v) throw new Error("SUPABASE_URL not set");
  return v;
}

function envAnon(): string {
  const v = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!v) throw new Error("SUPABASE_ANON_KEY not set");
  return v;
}

function envService(): string {
  const v = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!v) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  return v;
}

let _admin: SupabaseClient | null = null;

export function adminClient(): SupabaseClient {
  if (_admin) return _admin;
  _admin = createClient(envUrl(), envService(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}

/**
 * Verify the Authorization header (`Bearer <jwt>`). Returns { userId } on
 * success, or throws an Error with .status = 401 on failure.
 */
export async function verifyJwt(authHeader: string | null | undefined): Promise<{ userId: string; email: string | null }> {
  const m = /^Bearer\s+(.+)$/i.exec(authHeader || "");
  if (!m) {
    const e: Error & { status?: number } = new Error("missing bearer token");
    e.status = 401;
    throw e;
  }
  const token = m[1];
  const userClient = createClient(envUrl(), envAnon(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data?.user) {
    const e: Error & { status?: number } = new Error("invalid token");
    e.status = 401;
    throw e;
  }
  return { userId: data.user.id, email: data.user.email ?? null };
}
