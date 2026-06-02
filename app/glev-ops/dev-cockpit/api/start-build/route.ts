// POST /glev-ops/dev-cockpit/api/start-build  { taskId }
//
// Route handler for Dev Cockpit "Start Build" (Phase 5 — build plan only, no
// code execution). Off the Server-Action queue so a long Mistral call doesn't
// block other actions and multiple tasks can plan builds in parallel. Under
// /glev-ops so the admin cookie is sent. Admin-guarded inside performStartBuild.

import { NextResponse } from "next/server";
import { performStartBuild } from "@/lib/devCockpit/performStartBuild";

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

  const result = await performStartBuild(taskId);
  const status = result.ok ? 200 : result.error === "auth" ? 401 : 400;
  return NextResponse.json(result, { status });
}
