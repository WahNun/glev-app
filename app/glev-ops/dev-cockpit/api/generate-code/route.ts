// POST /glev-ops/dev-cockpit/api/generate-code  { taskId }
//
// Route handler for Dev Cockpit "Generate Code" (Phase 6 — sandboxed code
// drafts; no writes/commits/PRs/deploys). Off the Server-Action queue so the
// long model call doesn't block other actions and multiple tasks can generate
// in parallel. Under /glev-ops so the admin cookie is sent. Admin-guarded
// inside performGenerateCode.

import { NextResponse } from "next/server";
import { performGenerateCode } from "@/lib/devCockpit/performGenerateCode";

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

  const result = await performGenerateCode(taskId);
  const status = result.ok ? 200 : result.error === "auth" ? 401 : 400;
  return NextResponse.json(result, { status });
}
