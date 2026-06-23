import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

async function getUser(req: NextRequest) {
  const url  = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  try {
    const cookieStore = await cookies();
    const all = cookieStore.getAll();
    if (all.length > 0) {
      const sb = createServerClient(url, anon, {
        cookies: {
          getAll: () => all.map(c => ({ name: c.name, value: c.value })),
          setAll: () => {},
        },
      });
      const { data } = await sb.auth.getUser();
      if (data?.user) return data.user;
    }
  } catch { /* fall through */ }

  const auth  = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (token) {
    const sb = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth:   { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await sb.auth.getUser(token);
    if (data?.user) return data.user;
  }

  return null;
}

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const tarnUrl = process.env.META_TARN_CAPI_URL;
  const tarnSecret = process.env.META_TARN_CAPI_SECRET;
  if (!tarnUrl || !tarnSecret) {
    console.warn('[signup-conversion] Missing META_TARN_CAPI_URL or _SECRET — skipping');
    return NextResponse.json({ skipped: true }, { status: 200 });
  }

  let body: { email?: string; eventId?: string } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  const email = body.email || user.email;
  if (!email) {
    return NextResponse.json({ error: 'no email' }, { status: 400 });
  }

  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined;
  const clientUA = req.headers.get('user-agent') || undefined;

  const payload = {
    event_name: 'Signup',
    event_id: body.eventId || `signup-${user.id}-${Date.now()}`,
    user_data: {
      email,
      external_id: user.id,
      client_ip_address: clientIp,
      client_user_agent: clientUA,
    },
    custom_data: {
      plan: 'free',
    },
  };

  try {
    const res = await fetch(tarnUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tarnSecret}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error('[signup-conversion] Tarn-Worker error:', res.status, await res.text());
      return NextResponse.json({ error: 'tarn-failed' }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[signup-conversion] fetch failed:', err);
    return NextResponse.json({ error: 'fetch-failed' }, { status: 502 });
  }
}
