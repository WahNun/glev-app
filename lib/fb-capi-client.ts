/**
 * lib/fb-capi-client.ts
 *
 * Browser-seitiger CAPI-Helper.
 * Feuert Browser-Pixel + Server-CAPI parallel mit identischer event_id
 * → Meta dedupliziert sauber.
 *
 * DSGVO: trackEvent() prüft window.__consent.marketing vor jedem Fire.
 * Der Cookie-Banner setzt window.__consent = { marketing: true } nach Opt-in.
 */

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    __consent?: { marketing?: boolean; analytics?: boolean };
  }
}

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const m = document.cookie.match(
    new RegExp("(?:^|; )" + name + "=([^;]*)"),
  );
  return m ? decodeURIComponent(m[1]) : undefined;
}

function fbcFromUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const fbclid = new URL(window.location.href).searchParams.get("fbclid");
  if (!fbclid) return undefined;
  return `fb.1.${Date.now()}.${fbclid}`;
}

export function uuid(): string {
  if (typeof crypto !== "undefined" && typeof (crypto as Crypto & { randomUUID?: () => string }).randomUUID === "function") {
    return (crypto as Crypto & { randomUUID: () => string }).randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Liest alle Hidden-Tracking-Felder aus einem Form-Element. */
export function readHiddenFields(form: HTMLFormElement): Record<string, string> {
  const fields: Record<string, string> = {};
  const keys = [
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "fbclid", "referrer", "page_url", "page_title",
    "meta_leadgen_id", "meta_campaign", "meta_ad", "meta_lead_form_id",
    "meta_lead_ad_id", "meta_lead_adset_id", "meta_lead_adset_name",
    "meta_lead_campaign_id", "meta_lead_platform",
    "plan", "plan_id", "plan_name",
  ];
  keys.forEach((k) => {
    const el = form.querySelector<HTMLInputElement>(`[name="${k}"]`);
    if (el?.value) fields[k] = el.value;
  });
  return fields;
}

export type ClientUser = {
  email: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  country?: string;
};

export type ClientEvent = {
  eventName:
    | "Lead"
    | "CompleteRegistration"
    | "StartTrial"
    | "Subscribe"
    | "Purchase"
    | "AddPaymentInfo"
    | "InitiateCheckout"
    | "ViewContent";
  value?: number;
  currency?: "EUR" | "USD";
  contentName?: string;
  contentIds?: string[];
  contentType?: "product" | "product_group";
  customData?: Record<string, unknown>;
};

function hasMarketingConsent(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.__consent?.marketing);
}

export async function trackEvent(
  user: ClientUser,
  ev: ClientEvent,
): Promise<string | null> {
  if (!hasMarketingConsent()) {
    console.info("[fb-capi] übersprungen — kein Marketing-Consent");
    return null;
  }

  const eventId         = uuid();
  const fbp             = readCookie("_fbp");
  const fbc             = readCookie("_fbc") || fbcFromUrl();
  const eventSourceUrl  =
    typeof window !== "undefined" ? window.location.href : undefined;

  // 1) Browser Pixel
  if (typeof window !== "undefined" && typeof window.fbq === "function") {
    const params: Record<string, unknown> = {};
    if (ev.value !== undefined)                params.value        = ev.value;
    if (ev.currency || ev.value !== undefined) params.currency     = ev.currency ?? "EUR";
    if (ev.contentName)                        params.content_name = ev.contentName;
    if (ev.contentIds)                         params.content_ids  = ev.contentIds;
    if (ev.contentType)                        params.content_type = ev.contentType;
    Object.assign(params, ev.customData ?? {});
    window.fbq("track", ev.eventName, params, { eventID: eventId });
  }

  // 2) Server CAPI — keepalive verhindert Abbruch bei Navigation
  try {
    await fetch("/api/fb-capi", {
      method:    "POST",
      headers:   { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        event: {
          ...ev,
          eventId,
          eventSourceUrl,
          currency: ev.currency ?? (ev.value !== undefined ? "EUR" : undefined),
        },
        user: { ...user, fbp, fbc },
      }),
    });
  } catch (e) {
    console.warn("[fb-capi] client POST fehlgeschlagen", e);
  }

  return eventId;
}
