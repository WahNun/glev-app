// GET /api/admin/meta/refresh-token
// Tauscht den aktuellen META_PAGE_ACCESS_TOKEN gegen einen dauerhaften Long-Lived Page Token.
// Flow: Short-lived User Token → Long-Lived User Token (60 Tage) → Page Token (kein Ablauf)
// Gibt den neuen Token zurück → in Vercel META_PAGE_ACCESS_TOKEN eintragen.
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

    const APP_ID = process.env.META_APP_ID ?? "";
    const APP_SECRET = process.env.META_APP_SECRET ?? "";
    const PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN ?? "";
    const PAGE_ID = (process.env.META_PAGE_ID ?? "").split(",")[0].trim();
    const GRAPH_VERSION = process.env.GRAPH_API_VERSION ?? "v23.0";

    if (!APP_ID || !APP_SECRET) {
      return Response.json({ error: "META_APP_ID or META_APP_SECRET not configured" }, { status: 400 });
    }
    if (!PAGE_ACCESS_TOKEN || !PAGE_ID) {
      return Response.json({ error: "META_PAGE_ACCESS_TOKEN or META_PAGE_ID not configured" }, { status: 400 });
    }

    // Schritt 1: Debug aktuellen Token um User Token zu extrahieren
    const debugRes = await fetch(
      `https://graph.facebook.com/debug_token?input_token=${PAGE_ACCESS_TOKEN}&access_token=${APP_ID}|${APP_SECRET}`
    );
    const debugJson = await debugRes.json();

    // Prüfe ob der Token schon long-lived ist
    const expiresAt = debugJson?.data?.expires_at;
    const isLongLived = expiresAt === 0 || expiresAt === null;

    if (isLongLived) {
      return Response.json({
        message: "Token is already long-lived (never expires)",
        expires_at: expiresAt,
        debug: debugJson,
      });
    }

    // Schritt 2: Hole Long-Lived User Token über Exchange
    // Zuerst brauchen wir den User Token der hinter dem Page Token steckt
    // Wenn PAGE_ACCESS_TOKEN bereits ein Page Token ist, holen wir direkt einen neuen
    const exchangeUrl = `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${PAGE_ACCESS_TOKEN}`;
    const exchangeRes = await fetch(exchangeUrl);
    const exchangeJson = await exchangeRes.json();

    if (exchangeJson.error) {
      return Response.json({
        error: "token_exchange_failed",
        detail: exchangeJson.error,
        hint: "Der aktuelle Token kann nicht direkt verlängert werden. Du brauchst einen frischen User Token aus dem Graph API Explorer.",
      }, { status: 400 });
    }

    const longLivedToken = exchangeJson.access_token;

    // Schritt 3: Hole dauerhaften Page Token mit Long-Lived User Token
    const pageTokenRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${PAGE_ID}?fields=access_token&access_token=${longLivedToken}`
    );
    const pageTokenJson = await pageTokenRes.json();

    if (pageTokenJson.error || !pageTokenJson.access_token) {
      return Response.json({
        error: "page_token_fetch_failed",
        detail: pageTokenJson.error ?? "no access_token in response",
        long_lived_user_token: longLivedToken,
        hint: "Trage long_lived_user_token manuell in Vercel als META_PAGE_ACCESS_TOKEN ein — er läuft in 60 Tagen ab.",
      }, { status: 400 });
    }

    return Response.json({
      success: true,
      message: "Long-lived page token generated — never expires. Update META_PAGE_ACCESS_TOKEN in Vercel.",
      new_page_token: pageTokenJson.access_token,
      exchange_token_expires_in: exchangeJson.expires_in,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "internal_error", message }, { status: 500 });
  }
}
