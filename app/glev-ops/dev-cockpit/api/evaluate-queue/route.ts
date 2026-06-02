// POST /glev-ops/dev-cockpit/api/evaluate-queue  { noteId }
//
// Route handler for Dev Cockpit "Evaluate Queue". Off the Server-Action queue
// so a long Mistral evaluation does NOT block other actions — the cockpit stays
// responsive and per-note evaluations run independently. Under /glev-ops so the
// admin cookie is sent. Admin-guarded inside performQueueEval.

import { NextResponse } from "next/server";
import { performQueueEval } from "@/lib/devCockpit/performQueueEval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  let noteId = "";
  try {
    const body = await req.json();
    noteId = String(body?.noteId ?? "");
  } catch {
    return NextResponse.json({ ok: false, error: "bad-request" }, { status: 400 });
  }

  const result = await performQueueEval(noteId);
  const status = result.ok ? 200 : result.error === "auth" ? 401 : 400;
  return NextResponse.json(result, { status });
}
