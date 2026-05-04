import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";

const SUPPORTED = ["de", "en"] as const;
type Locale = (typeof SUPPORTED)[number];
const DEFAULT: Locale = "de";

const DACH_COUNTRIES = new Set(["DE", "AT", "CH", "LU", "LI"]);

function isSupported(value: string | undefined | null): value is Locale {
  return !!value && (SUPPORTED as readonly string[]).includes(value);
}

function geoLocale(country: string | null): Locale | null {
  if (!country) return null;
  const code = country.toUpperCase();
  return DACH_COUNTRIES.has(code) ? "de" : "en";
}

function parseAcceptLanguage(header: string | null): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      let q = 1;
      for (const p of params) {
        const [k, v] = p.trim().split("=");
        if (k === "q") {
          const parsed = parseFloat(v);
          if (!Number.isNaN(parsed)) q = parsed;
        }
      }
      return { tag: tag.toLowerCase(), q };
    })
    .filter((entry) => entry.tag.length > 0)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    const primary = tag.split("-")[0];
    if (isSupported(primary)) return primary;
  }
  return null;
}

export default getRequestConfig(async () => {
  const hdrs = await headers();

  // 0) `?lang=de` / `?lang=en` URL override — set by middleware on the
  //    public marketing pages (/pro, /beta). Highest precedence so the
  //    canvas iframes (which can't share cookies cross-origin) and any
  //    deep-linked share URL render in the requested language regardless
  //    of cookie / IP-country / Accept-Language.
  const localeOverride = hdrs.get("x-glev-locale-override");
  if (isSupported(localeOverride)) {
    return {
      locale: localeOverride,
      messages: (await import(`../messages/${localeOverride}.json`)).default,
    };
  }

  // 1) Explicit cookie wins — set by the in-app language picker and by
  //    LanguageSync after a logged-in user signs in. This guarantees a
  //    visitor who flipped to the other language stays on it even when
  //    their geo says otherwise.
  const cookieStore = await cookies();
  const cookieLocaleRaw = cookieStore.get("NEXT_LOCALE")?.value ?? null;
  if (isSupported(cookieLocaleRaw)) {
    return {
      locale: cookieLocaleRaw,
      messages: (await import(`../messages/${cookieLocaleRaw}.json`)).default,
    };
  }

  // 2) Country-based: visitors from DE/AT/CH/LU/LI default to the German
  //    site (with EUR pricing); everyone else to the English site (with
  //    USD pricing).
  //
  //    The country code is forwarded by middleware as `x-glev-country`.
  //    Middleware reads the raw Vercel header (`x-vercel-ip-country`) at
  //    the edge and copies it into our own header so it reliably survives
  //    the edge→server header handoff in Next.js 16 (the raw Vercel
  //    header can be dropped when `new Headers(req.headers)` is forwarded
  //    via `NextResponse.next()`). Falls back to reading the Vercel
  //    header directly as a safety net.
  const country =
    hdrs.get("x-glev-country") ?? hdrs.get("x-vercel-ip-country");
  const geo = geoLocale(country);
  if (geo) {
    return {
      locale: geo,
      messages: (await import(`../messages/${geo}.json`)).default,
    };
  }

  // 3) No geo signal (local dev, Replit preview, non-Vercel hosting):
  //    sniff Accept-Language so first-time visitors land on their
  //    browser's preferred locale.
  const acceptLang = parseAcceptLanguage(hdrs.get("accept-language"));
  const locale: Locale = acceptLang ?? DEFAULT;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
