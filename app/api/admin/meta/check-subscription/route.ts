// GET /api/admin/meta/check-subscription
// Prüft welche Apps aktuell für die Glev-Seite subscribed sind (leadgen-Webhooks).
// Geschützt via ADMIN_API_SECRET Header.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
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

    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PAGE_ID}/subscribed_apps?access_token=${PAGE_ACCESS_TOKEN}`;
    const res = await fetch(url);
    const json = await res.json();

    return Response.json({
      ok: res.ok,
      status: res.status,
      page_id: PAGE_ID,
      graph_version: GRAPH_VERSION,
      meta_response: json,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "internal_error", message }, { status: 500 });
  }
}
