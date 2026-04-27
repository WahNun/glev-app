import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { authenticate } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cgm/glucose
 *
 * Returns the latest CGM reading via Junction (NOT via the existing
 * LibreLink-Up direct integration). Used by:
 *   • The settings page CGM card to render connected / disconnected state.
 *   • The engine page on-mount auto-fill of the glucose input.
 *
 * Response shapes (always 200 — never blocks the user):
 *   { connected: false }                                         not connected
 *   { connected: true,  glucose: null,    timestamp: null }      connected but no data yet
 *   { connected: true,  glucose: <mg/dL>, timestamp: <iso> }     connected + data
 *
 * Errors against Junction or the DB are swallowed and surfaced as
 * { connected: false } with an error string, so the engine page can fail
 * silently as required by spec.
 */
export async function GET(req: NextRequest) {
  const { user, error: authErr } = await authenticate(req);
  if (!user) {
    return NextResponse.json({ error: authErr || "unauthorized" }, { status: 401 });
  }

  try {
    const apiKey = process.env.JUNCTION_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ connected: false, error: "no_api_key" });
    }

    const cookieStore = await cookies();
    const supabaseUrl =
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const anonKey =
      process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
    const sb = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        getAll: () =>
          cookieStore.getAll().map((c) => ({ name: c.name, value: c.value })),
        setAll: () => {},
      },
    });

    const { data: profile } = await sb
      .from("profiles")
      .select("junction_user_id, nightscout_url")
      .eq("user_id", user.id)
      .maybeSingle();

    // Nightscout takes precedence over Junction when both are connected,
    // matching the dispatcher rule in lib/cgm/index.ts (resolveSource):
    // an explicit Nightscout URL is the user's most recent intent.
    if (profile?.nightscout_url) {
      try {
        const { getLatest } = await import("@/lib/cgm/nightscout");
        const { current } = await getLatest(user.id);
        return NextResponse.json({
          connected: true,
          glucose: current?.value ?? null,
          timestamp: current?.timestamp ?? null,
          source: "nightscout",
        });
      } catch (e) {
        // Fail soft — settings card / engine page treat as disconnected
        // so the user can re-enter credentials. Don't fall through to
        // Junction: the user explicitly chose Nightscout.
        const msg = e instanceof Error ? e.message : "unknown";
        return NextResponse.json({
          connected: false,
          source: "nightscout",
          error: msg,
        });
      }
    }

    const junctionUserId = profile?.junction_user_id ?? null;
    if (!junctionUserId) {
      return NextResponse.json({ connected: false });
    }

    const baseUrl = junctionBaseUrl(apiKey);

    // 6-hour window is enough to find the freshest LibreView reading
    // (sensors push every 1–5 min) without dragging back hundreds of points.
    const end = new Date();
    const start = new Date(end.getTime() - 6 * 60 * 60 * 1000);
    const params = new URLSearchParams({
      start_date: start.toISOString(),
      end_date: end.toISOString(),
      provider: "abbott_libreview",
    });

    const tsRes = await fetch(
      `${baseUrl}/v2/timeseries/${junctionUserId}/glucose/grouped?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "x-vital-api-key": apiKey,
        },
      },
    );

    if (!tsRes.ok) {
      // Most common case: 404 means the user hasn't connected yet (no data
      // pulled). Treat as connected-but-empty rather than an error so the
      // settings card doesn't flash red right after redirect.
      return NextResponse.json({
        connected: true,
        glucose: null,
        timestamp: null,
        upstream_status: tsRes.status,
      });
    }

    const body = (await safeJson(tsRes)) as
      | { groups?: Record<string, Array<{ data?: GlucosePoint[] }>> }
      | null;

    const latest = pickLatest(body);
    if (!latest) {
      return NextResponse.json({
        connected: true,
        glucose: null,
        timestamp: null,
      });
    }

    return NextResponse.json({
      connected: true,
      glucose: toMgDl(latest.value, latest.unit),
      timestamp: latest.timestamp,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    // Spec says fail silently — the engine page must never break because
    // CGM is unreachable. Return connected=false so the client treats the
    // user as disconnected for this request.
    return NextResponse.json({ connected: false, error: msg });
  }
}

interface GlucosePoint {
  timestamp: string;
  value: number;
  unit: string;
  type?: string;
}

/**
 * Walk the groups → entries → data points and return the single point with
 * the most recent timestamp. We don't bias by provider because we asked for
 * abbott_libreview only, but the response structure is still nested.
 */
function pickLatest(
  body: { groups?: Record<string, Array<{ data?: GlucosePoint[] }>> } | null,
): GlucosePoint | null {
  if (!body?.groups) return null;
  let best: GlucosePoint | null = null;
  let bestTs = -Infinity;
  for (const groupName of Object.keys(body.groups)) {
    for (const entry of body.groups[groupName] ?? []) {
      for (const p of entry.data ?? []) {
        const t = Date.parse(p.timestamp);
        if (Number.isFinite(t) && t > bestTs) {
          best = p;
          bestTs = t;
        }
      }
    }
  }
  return best;
}

/**
 * Junction can return mmol/L (default for EU LibreView) or mg/dL depending
 * on the user's account preference. Always normalize to mg/dL so the engine
 * gets one consistent number to feed the dose calc. 1 mmol/L ≈ 18.0182 mg/dL.
 */
function toMgDl(value: number, unit: string): number {
  if (!Number.isFinite(value)) return 0;
  if (unit === "mmol/L" || unit === "mmol/l") {
    return Math.round(value * 18.0182);
  }
  return Math.round(value);
}

function junctionBaseUrl(apiKey: string): string {
  if (apiKey.startsWith("sk_eu_")) return "https://api.sandbox.eu.junction.com";
  if (apiKey.startsWith("sk_us_")) return "https://api.sandbox.us.junction.com";
  if (apiKey.startsWith("pk_eu_")) return "https://api.eu.junction.com";
  if (apiKey.startsWith("pk_us_")) return "https://api.us.junction.com";
  return "https://api.eu.junction.com";
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
