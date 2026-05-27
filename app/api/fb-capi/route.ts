/**
 * POST /api/fb-capi
 *
 * Thin proxy: nimmt Browser-seitige trackEvent()-Calls entgegen,
 * ergänzt IP + User-Agent vom echten Request und reicht an Meta CAPI weiter.
 * Dedupliziert mit Browser-Pixel über identische event_id.
 */
import { NextRequest, NextResponse } from "next/server";
import { sendCapiEvent } from "@/lib/fb-capi-server";
import type { CapiEvent, CapiUser } from "@/lib/fb-capi-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      event: CapiEvent;
      user: CapiUser;
    };

    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      undefined;
    const clientUserAgent = req.headers.get("user-agent") || undefined;

    // Referer als Fallback für eventSourceUrl
    if (!body.event.eventSourceUrl) {
      const referer = req.headers.get("referer") || undefined;
      if (referer) body.event.eventSourceUrl = referer;
    }

    const result = await sendCapiEvent(
      {
        ...body.user,
        clientIp:        body.user.clientIp        ?? clientIp,
        clientUserAgent: body.user.clientUserAgent ?? clientUserAgent,
      },
      body.event,
    );

    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (e: unknown) {
    console.error("[/api/fb-capi] unexpected error", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
