import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function authenticate(req: NextRequest) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  // Try cookie-based auth first
  try {
    const cookieStore = await cookies();
    const allCookies = cookieStore.getAll();
    const ssrClient = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        getAll: () => allCookies.map(c => ({ name: c.name, value: c.value })),
        setAll: () => {},
      },
    });
    const { data } = await ssrClient.auth.getUser();
    if (data?.user) return { user: data.user, error: null as string | null };
  } catch {}

  // Fallback to Bearer token
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (token) {
    const client = createClient(supabaseUrl, anonKey);
    const { data, error } = await client.auth.getUser(token);
    if (data?.user) return { user: data.user, error: null as string | null };
    return { user: null, error: error?.message || 'invalid bearer token' };
  }

  return { user: null, error: 'no session cookie and no bearer token' };
}

export function errResponse(e: unknown): NextResponse {
  const err = e as {
    status?: number;
    message?: string;
    code?: string;
    upstream?: boolean;
    response?: { status?: number };
  };
  if (err?.status) {
    return NextResponse.json({ error: err.message || 'error' }, { status: err.status });
  }
  if (err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT') {
    return NextResponse.json({ error: 'upstream timeout' }, { status: 504 });
  }
  if (err?.response?.status) {
    const s = err.response.status;
    if (s === 401) return NextResponse.json({ error: 'LLU rejected credentials' }, { status: 502 });
    return NextResponse.json({ error: `LLU upstream ${s}` }, { status: 502 });
  }
  if (err?.upstream) {
    return NextResponse.json({ error: err.message || 'upstream error' }, { status: 502 });
  }
  // eslint-disable-next-line no-console
  console.error('[cgm] internal:', err?.message || err);
  return NextResponse.json({ error: 'internal' }, { status: 500 });
}
