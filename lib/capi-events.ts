// Client + Server helper for glev.app (Next.js, App Router).
// Fires the Meta Pixel AND posts the same event with a shared event_id to the
// Layer-One CAPI Gateway (separate domain) → Pixel/CAPI dedup + high EMQ.
//
// ENV — browser (NEXT_PUBLIC_*):
//   NEXT_PUBLIC_FB_PIXEL_ID      = 1388009386583284
//   NEXT_PUBLIC_CAPI_ENDPOINT    = https://capi.mealpatterns.app/collect
//   NEXT_PUBLIC_CAPI_CLIENT_KEY  = <shared secret>
//
// ENV — server-only (preferred when window is undefined):
//   CAPI_GATEWAY_URL    = https://capi.mealpatterns.app/collect
//   CAPI_SHARED_SECRET  = <same shared secret>
//
// Security: the browser-exposed key is protected by the Gateway's origin
// allowlist. For maximum security use the server relay (app/api/fb-capi).

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

export interface CapiUser {
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  gender?: string;
  date_of_birth?: string; // YYYYMMDD
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  external_id?: string;
}

export interface CapiCustomData {
  value?: number;
  currency?: string;
  content_ids?: (string | number)[];
  content_type?: string;
  content_name?: string;
  content_category?: string;
  order_id?: string;
  num_items?: number;
  [key: string]: unknown;
}

function getCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]!) : undefined;
}

function getFbc(): string | undefined {
  const cookie = getCookie("_fbc");
  if (cookie) return cookie;
  if (typeof window === "undefined") return undefined;
  const fbclid = new URLSearchParams(window.location.search).get("fbclid");
  if (!fbclid) return undefined;
  return `fb.1.${Date.now()}.${fbclid}`;
}

export function newEventId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export async function trackEvent(
  eventName: string,
  opts: {
    user?: CapiUser;
    customData?: CapiCustomData;
    eventId?: string;
    sourceUrl?: string;
  } = {},
): Promise<void> {
  const eventId = opts.eventId ?? newEventId();
  const sourceUrl =
    opts.sourceUrl ??
    (typeof window !== "undefined" ? window.location.href : undefined);

  // 1) Browser Pixel (with eventID for dedup) — no-op on server
  if (typeof window !== "undefined" && typeof window.fbq === "function") {
    window.fbq("track", eventName, opts.customData ?? {}, { eventID: eventId });
  }

  // 2) CAPI Gateway — prefer server-only vars when running outside the browser
  const isServer = typeof window === "undefined";
  const endpoint = (isServer ? process.env.CAPI_GATEWAY_URL : undefined) ??
    process.env.NEXT_PUBLIC_CAPI_ENDPOINT;
  if (!endpoint) return;

  const secret = (isServer ? process.env.CAPI_SHARED_SECRET : undefined) ??
    process.env.NEXT_PUBLIC_CAPI_CLIENT_KEY ??
    "";

  const body = {
    event_name: eventName,
    event_id: eventId,
    event_source_url: sourceUrl,
    action_source: "website",
    user: {
      ...opts.user,
      fbp: getCookie("_fbp"),
      fbc: getFbc(),
    },
    custom_data: opts.customData,
  };

  try {
    await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CAPI-Secret": secret,
      },
      body: JSON.stringify(body),
      keepalive: true,
    });
  } catch {
    // Tracking must never block UX
  }
}

// Convenience helpers:
export const trackLead = (user?: CapiUser) =>
  trackEvent("Lead", { user });

export const trackCompleteRegistration = (user?: CapiUser, customData?: CapiCustomData) =>
  trackEvent("CompleteRegistration", { user, customData });

export const trackStartTrial = (user?: CapiUser, customData?: CapiCustomData) =>
  trackEvent("StartTrial", { user, customData });

export const trackInitiateCheckout = (user?: CapiUser, customData?: CapiCustomData) =>
  trackEvent("InitiateCheckout", { user, customData });

export const trackPurchase = (customData: CapiCustomData, user?: CapiUser) =>
  trackEvent("Purchase", { user, customData });
