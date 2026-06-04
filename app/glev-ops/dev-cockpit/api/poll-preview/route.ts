// GET /glev-ops/dev-cockpit/api/poll-preview?previewId=xxx
//
// Phase 7 — Preview Pipeline. Polls the GitHub Deployments API for the Vercel
// preview URL and updates dev_cockpit_previews + dev_cockpit_tasks accordingly.
// Called by the client every ~3 s while deployment_status is queued/building.
// Admin-guarded inside pollPreviewStatus.

import { NextResponse } from "next/server";
import { pollPreviewStatus } from "@/lib/devCockpit/performCreatePreview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const previewId = searchParams.get("previewId") ?? "";
  if (!previewId) {
    return NextResponse.json({ ok: false, error: "missing-previewId" }, { status: 400 });
  }

  const result = await pollPreviewStatus(previewId);
  const status = result.ok ? 200 : result.error === "auth" ? 401 : 400;
  return NextResponse.json(result, { status });
}
