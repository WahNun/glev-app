// Cron worker — drains the email_outbox table.
//
// Schedule expectation: hit this endpoint every 1-2 minutes from
// whatever cron facility you use (Vercel cron, Replit Scheduled
// Deployment, GitHub Actions, an external uptime ping, etc). The
// handler is idempotent — calling it more often is safe (the atomic
// `pending → sending` claim in flushOutbox prevents double-sends).
//
// Auth: Bearer token. Header `Authorization: Bearer <CRON_SECRET>`.
// Same pattern as /api/admin/invite. We accept GET so cron facilities
// that only support GET (most uptime pingers, GitHub Actions HTTP
// step, Vercel cron) work out of the box; POST is also accepted for
// manual curl testing.

import { NextRequest, NextResponse } from "next/server";
import { flushOutbox } from "@/lib/emails/outbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length < 16) {
    // eslint-disable-next-line no-console
    console.error(
      "[cron/flush-outbox] CRON_SECRET not configured or too short (min 16 chars)",
    );
    return NextResponse.json(
      { error: "Server misconfiguration" },
      { status: 500 },
    );
  }

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token !== expected) {
    return unauthorized();
  }

  try {
    const counters = await flushOutbox();
    // Always log the counters so the cron history doubles as an
    // operator dashboard (`grep flush-outbox` shows what got sent).
    // eslint-disable-next-line no-console
    console.log("[cron/flush-outbox] done:", counters);
    return NextResponse.json({ ok: true, ...counters });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error("[cron/flush-outbox] threw:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
