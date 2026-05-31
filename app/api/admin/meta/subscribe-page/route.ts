// POST /api/admin/meta/subscribe-page
// Verknüpft die Glev_app mit der Facebook-Seite auf Page-Ebene.
// Erforderlich damit Meta Lead-Ads-Webhooks an die App sendet.
// Geschützt via ADMIN_API_SECRET Header.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const ADMIN_SECRET = process.env.ADMIN_API_SECRET ?? "";
    const authHeader = req.headers.get("authorization") ?? "";
    const secret = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    const PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN ?? "";
    const PAGE_ID = (process.env.META_PAGE_ID ?? "").split(",")[0].trim();
    const GRAPH_VERSION = process.env.GRAPH_API_VERSION ?? "v23.0";

    if (!PAGE_ACCESS_TOKEN || !PAGE_ID) {
      return Response.json({ error: "META_PAGE_ACCESS_TOKEN or META_PAGE_ID not configured" }, { status: 400 });
    }

    // POST /{page-id}/subscribed_apps mit leadgen-Feld
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PAGE_ID}/subscribed_apps`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        subscribed_fields: "leadgen",
        access_token: PAGE_ACCESS_TOKEN,
      }),
    });

    const json = await res.json();
    return Response.json({
      ok: res.ok,
      status: res.status,
      meta_response: json,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "internal_error", message }, { status: 500 });
  }
}
