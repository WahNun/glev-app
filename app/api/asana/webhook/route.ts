import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function getReplitQueueSectionIds(): Set<string> {
  const raw = process.env.ASANA_REPLIT_QUEUE_SECTION_IDS ?? '';
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

function verifySignature(body: string, signature: string): boolean {
  const secret = process.env.ASANA_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  } catch {
    return expected === signature;
  }
}

export async function POST(req: NextRequest) {
  const body = await req.text();

  // Handshake: Asana sends X-Hook-Secret on first webhook registration.
  // We must echo it back in the response header to confirm the endpoint.
  const hookSecret = req.headers.get('x-hook-secret');
  if (hookSecret) {
    console.log('[Asana Webhook] Handshake received — echoing X-Hook-Secret');
    return new NextResponse(null, {
      status: 200,
      headers: { 'X-Hook-Secret': hookSecret },
    });
  }

  // Signature verification for all subsequent event deliveries.
  const signature = req.headers.get('x-hook-signature') ?? '';
  if (!verifySignature(body, signature)) {
    console.warn('[Asana Webhook] Signature verification failed');
    // Return 200 so Asana doesn't retry — we just discard the payload.
    return NextResponse.json({ error: 'invalid signature' }, { status: 200 });
  }

  let payload: AsanaWebhookPayload;
  try {
    payload = JSON.parse(body) as AsanaWebhookPayload;
  } catch {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const queueSectionIds = getReplitQueueSectionIds();
  const events = payload.events ?? [];

  for (const event of events) {
    if (
      event.resource?.resource_type !== 'task' ||
      event.action !== 'added' ||
      event.parent?.resource_type !== 'section'
    ) continue;

    const sectionGid = event.parent.gid;
    if (!queueSectionIds.has(sectionGid)) continue;

    const taskGid = event.resource.gid;
    let taskName = '';
    let projectGid = '';

    try {
      const taskData = await fetchAsanaTask(taskGid);
      taskName = taskData?.name ?? '';
      projectGid = taskData?.projects?.[0]?.gid ?? '';
    } catch (err) {
      console.error(`[Asana Webhook] Failed to fetch task ${taskGid}:`, err);
    }

    const { error } = await supabase.from('replit_queue').upsert(
      {
        asana_task_id: taskGid,
        task_name:     taskName,
        section_id:    sectionGid,
        project_id:    projectGid,
        received_at:   new Date().toISOString(),
        status:        'pending',
      },
      { onConflict: 'asana_task_id' }
    );

    if (error) {
      console.error(`[Asana Webhook] Supabase insert failed for task ${taskGid}:`, error.message);
    } else {
      console.log(`[Asana Webhook] Queued task ${taskGid} ("${taskName}")`);
    }
  }

  return NextResponse.json({ received: true }, { status: 200 });
}

async function fetchAsanaTask(taskGid: string): Promise<AsanaTask | null> {
  const res = await fetch(
    `https://app.asana.com/api/1.0/tasks/${taskGid}?opt_fields=name,projects.gid`,
    {
      headers: {
        Authorization: `Bearer ${process.env.ASANA_PAT}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8_000),
    }
  );
  if (!res.ok) throw new Error(`Asana API returned ${res.status}`);
  const json = (await res.json()) as { data?: AsanaTask };
  return json.data ?? null;
}

interface AsanaWebhookPayload {
  events: AsanaEvent[];
}
interface AsanaEvent {
  action: string;
  resource: { gid: string; resource_type: string };
  parent: { gid: string; resource_type: string } | null;
}
interface AsanaTask {
  gid: string;
  name: string;
  projects: { gid: string }[];
}
