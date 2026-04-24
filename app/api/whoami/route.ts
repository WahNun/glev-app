import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  const info: Record<string, unknown> = {};

  try {
    const cookieStore = await cookies();
    const allCookies = cookieStore.getAll();

    const ssrClient = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        getAll: () => allCookies.map(c => ({ name: c.name, value: c.value })),
        setAll: () => {},
      },
    });

    const { data: userData } = await ssrClient.auth.getUser();

    if (!userData?.user) {
      const authHeader = req.headers.get('authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (token) {
        const authClient = createClient(supabaseUrl, anonKey);
        const { data: bearerData } = await authClient.auth.getUser(token);
        if (bearerData?.user) {
          info.authMethod = 'bearer';
          info.userId = bearerData.user.id;
          info.email = bearerData.user.email;
        } else {
          return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
        }
      } else {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
      }
    } else {
      info.authMethod = 'cookie';
      info.userId = userData.user.id;
      info.email = userData.user.email;
    }

    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: credRow } = await adminClient
      .from('cgm_credentials')
      .select('llu_email, updated_at')
      .eq('user_id', info.userId as string)
      .maybeSingle();

    info.hasCgmCredentials = !!credRow;
    info.credentialsEmail = credRow?.llu_email || null;
    info.credentialsUpdatedAt = credRow?.updated_at || null;

    return NextResponse.json(info, { status: 200 });
  } catch (e: unknown) {
    const err = e as { message?: string };
    return NextResponse.json({ error: 'exception', details: err?.message }, { status: 500 });
  }
}
