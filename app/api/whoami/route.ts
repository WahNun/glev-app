import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  const info: Record<string, unknown> = {
    supabaseUrl,
    hasAnonKey: !!anonKey,
    hasServiceKey: !!serviceKey,
    hasEncryptionKey: !!process.env.ENCRYPTION_KEY,
    receivedAuthHeader: !!token,
  };

  if (!token) {
    return NextResponse.json({ ...info, error: 'No Bearer token in Authorization header' }, { status: 200 });
  }

  try {
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: userError } = await authClient.auth.getUser(token);

    if (userError || !userData?.user) {
      return NextResponse.json({ ...info, error: 'auth.getUser failed', details: userError?.message }, { status: 200 });
    }

    info.userId = userData.user.id;
    info.email = userData.user.email;

    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: credRow, error: credError } = await adminClient
      .from('cgm_credentials')
      .select('user_id, llu_email, llu_region, updated_at')
      .eq('user_id', userData.user.id)
      .maybeSingle();

    info.hasCgmCredentials = !!credRow;
    info.credentialsEmail = credRow?.llu_email || null;
    info.credentialsUpdatedAt = credRow?.updated_at || null;
    info.credentialsError = credError?.message || null;

    // Also count total rows in the table to see if we're hitting the right DB
    const { count } = await adminClient
      .from('cgm_credentials')
      .select('*', { count: 'exact', head: true });
    info.totalCredentialRows = count;

    return NextResponse.json(info, { status: 200 });
  } catch (e: unknown) {
    const err = e as { message?: string };
    return NextResponse.json({ ...info, error: 'exception', details: err?.message }, { status: 200 });
  }
}
