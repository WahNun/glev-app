// POST /api/fb-capi
// Backward-compat relay for lib/fb-capi-client.ts (used by signup/page.tsx).
// Translates the old camelCase CapiEvent/CapiUser format → Gateway wire format,
// enriches with real client IP/UA, and forwards to the Layer-One CAPI Gateway.
// New server-side code should call the Gateway directly via lib/capi-events.ts.
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GATEWAY_URL =
  process.env.CAPI_GATEWAY_URL ?? process.env.NEXT_PUBLIC_CAPI_ENDPOINT ?? "";
const GATEWAY_SECRET =
  process.env.CAPI_SHARED_SECRET ?? process.env.NEXT_PUBLIC_CAPI_CLIENT_KEY ?? "";

type OldUser = {
  email?: string; phone?: string; firstName?: string; lastName?: string;
  city?: string; zip?: string; country?: string; externalId?: string;
  fbp?: string; fbc?: string; clientIp?: string; clientUserAgent?: string;
};
type OldEvent = {
  eventName: string; eventId: string; eventSourceUrl?: string;
  actionSource?: string; value?: number; currency?: string;
  contentName?: string; contentIds?: string[]; contentType?: string;
  orderId?: string; customData?: Record<string, unknown>;
};

export async function POST(req: NextRequest) {
  try {
    if (!GATEWAY_URL) {
      return NextResponse.json({ ok: false, error: "gateway_not_configured" }, { status: 503 });
    }

    const body = (await req.json()) as { event: OldEvent; user: OldUser };
    const { event, user } = body;

    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      undefined;
    const clientUserAgent = req.headers.get("user-agent") ?? undefined;

    const sourceUrl =
      event.eventSourceUrl ?? req.headers.get("referer") ?? undefined;

    const payload = {
      event_name: event.eventName,
      event_id: event.eventId,
      event_source_url: sourceUrl,
      action_source: event.actionSource ?? "website",
      user: {
        email: user.email,
        phone: user.phone,
        first_name: user.firstName,
        last_name: user.lastName,
        city: user.city,
        zip: user.zip,
        country: user.country,
        external_id: user.externalId,
        fbp: user.fbp,
        fbc: user.fbc,
        client_ip_address: user.clientIp ?? clientIp,
        client_user_agent: user.clientUserAgent ?? clientUserAgent,
      },
      custom_data: {
        ...(event.value !== undefined ? { value: event.value } : {}),
        ...(event.currency ? { currency: event.currency } : {}),
        ...(event.contentName ? { content_name: event.contentName } : {}),
        ...(event.contentIds ? { content_ids: event.contentIds } : {}),
        ...(event.contentType ? { content_type: event.contentType } : {}),
        ...(event.orderId ? { order_id: event.orderId } : {}),
        ...(event.customData ?? {}),
      },
    };

    const r = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CAPI-Secret": GATEWAY_SECRET,
      },
      body: JSON.stringify(payload),
    });

    const data = await r.json().catch(() => null);
    return NextResponse.json({ ok: r.ok, ...(data ?? {}) }, { status: r.status });
  } catch (e) {
    console.error("[/api/fb-capi] unexpected error", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
