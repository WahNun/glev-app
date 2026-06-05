// POST /glev-ops/dev-cockpit/api/create-preview  { taskId }
//
// Phase 7 — Preview Pipeline. Creates a GitHub branch from main, applies the
// latest code draft in a single batch commit, and kicks off a Vercel Preview
// Deployment (auto-triggered by GitHub push). Returns immediately with
// preview_building status; the client polls /api/poll-preview for the URL.
// Admin-guarded inside performCreatePreview. NEVER deploys to production.

import { NextResponse } from "next/server";
import { performCreatePreview } from "@/lib/devCockpit/performCreatePreview";

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

  const result = await performCreatePreview(taskId);
  const status = result.ok ? 200 : result.error === "auth" ? 401 : 400;
  return NextResponse.json(result, { status });
}
