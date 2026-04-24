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

  const info: Record<string, unknown> = {
    supabaseUrl,
    hasAnonKey: !!anonKey,
    hasServiceKey: !!serviceKey,
    hasEncryptionKey: !!process.env.ENCRYPTION_KEY,
  };

  try {
    // Try cookie-based auth first (for @supabase/ssr setups)
    const cookieStore = await cookies();
    const allCookies = cookieStore.getAll();
    info.cookieNames = allCookies.map(c => c.name);

    const ssrClient = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        getAll: () => allCookies.map(c => ({ name: c.name, value: c.value })),
        setAll: () => {},
      },
    });

    const { data: userData, error: userError } = await ssrClient.auth.getUser();

    // Fallback to Bearer token if cookie auth fails
    if (!userData?.user) {
      const authHeader = req.headers.get('authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (token) {
        const authClient = createClient(supabaseUrl, anonKey);
        const { data: bearerData, error: bearerError } = await authClient.auth.getUser(token);
        if (bearerData?.user) {
          info.authMethod = 'bearer';
          info.userId = bearerData.user.id;
          info.email = bearerData.user.email;
        } else {
          return NextResponse.json({ ...info, error: 'Both cookie and bearer auth failed', cookieError: userError?.message, bearerError: bearerError?.message }, { status: 200 });
        }
      } else {
        return NextResponse.json({ ...info, error: 'No session found in cookies and no Bearer token', cookieError: userError?.message }, { status: 200 });
      }
    } else {
      info.authMethod = 'cookie';
      info.userId = userData.user.id;
      info.email = userData.user.email;
    }

    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: credRow, error: credError } = await adminClient
      .from('cgm_credentials')
      .select('user_id, llu_email, llu_region, updated_at')
      .eq('user_id', info.userId as string)
      .maybeSingle();

    info.hasCgmCredentials = !!credRow;
    info.credentialsEmail = credRow?.llu_email || null;
    info.credentialsUpdatedAt = credRow?.updated_at || null;
    info.credentialsError = credError?.message || null;

    const { count } = await adminClient
      .from('cgm_credentials')
      .select('*', { count: 'exact', head: true });
    info.totalCredentialRows = count;

    // Diagnostic: verify service role key characteristics
    const srKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    info.serviceKeyPrefix = srKey.slice(0, 10);
    info.serviceKeyLength = srKey.length;
    // For legacy JWT keys, decode the payload to check the role
    if (srKey.startsWith('eyJ')) {
      try {
        const parts = srKey.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
          info.serviceKeyRole = payload.role;
          info.serviceKeyRef = payload.ref;
        }
      } catch (e: unknown) {
        const err = e as { message?: string };
        info.serviceKeyDecodeError = err?.message;
      }
    }

    // Actually test if the admin client can bypass RLS by doing a count that RLS would block for anon
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const admin = createClient(supabaseUrl, srKey);
      const { count: rlsCount, error: countErr } = await admin
        .from('cgm_credentials')
        .select('*', { count: 'exact', head: true });
      info.adminRlsTest = { count: rlsCount, error: countErr?.message || null };
    } catch (e: unknown) {
      const err = e as { message?: string };
      info.adminRlsTest = { exception: err?.message };
    }

    return NextResponse.json(info, { status: 200 });
  } catch (e: unknown) {
    const err = e as { message?: string; stack?: string };
    return NextResponse.json({ ...info, error: 'exception', details: err?.message, stack: err?.stack?.slice(0, 500) }, { status: 200 });
  }
}
