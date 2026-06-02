// POST /glev-ops/dev-cockpit/api/analyze  { taskId }
//
// Route handler for Dev Cockpit "Analyze Task". Lives off the Next.js
// Server-Action queue so a long Mistral analysis does NOT block other actions
// (cancel / archive / create / reads) — the cockpit UI stays responsive and
// multiple analyses can run in parallel. Placed UNDER /glev-ops so the admin
// session cookie is always sent with the request. Admin-guarded inside
// performAnalyze; the Mistral key never leaves the server.

import { NextResponse } from "next/server";
import { performAnalyze } from "@/lib/devCockpit/performAnalyze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  let taskId = "";
  try {
    const body = await req.json();
    taskId = String(body?.taskId ?? "");
  } catch {
    return NextResponse.json({ ok: false, error: "bad-request" }, { status: 400 });
  }

  const result = await performAnalyze(taskId);
  const status = result.ok ? 200 : result.error === "auth" ? 401 : 400;
  return NextResponse.json(result, { status });
}
