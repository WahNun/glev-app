import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { logDebugLine } from "@/lib/debug";
import { PATHNAME_HEADER } from "@/lib/appRoutes";

const SUPPORTED = ["de", "en"] as const;
type Locale = (typeof SUPPORTED)[number];
const DEFAULT: Locale = "de";

// ──────────────────────────────────────────────────────────────────────
// TEMPORARY DIAGNOSTIC LOGGING (task #219)
// Reason: a German visitor on glev.app lands on the English version even
// though the geo path should force `de`. We don't know which of the five
// detection paths actually fires in production. The `logLocaleDecision`
// helper below writes one structured line per request showing which path
// won, the resolved locale, and the raw signals (country header, cookie
// presence, truncated Accept-Language, request path). It deliberately
// avoids any PII (no IPs, no user IDs, no auth cookies, no full cookie
// jar — only whether NEXT_LOCALE is set and to what value).
// REMOVE this helper and its call sites once the production logs have
// pinpointed the offending path.
// ──────────────────────────────────────────────────────────────────────
type DetectionPath = "override" | "cookie" | "geo" | "accept-language" | "default";

function logLocaleDecision(args: {
  path: DetectionPath;
  locale: Locale;
  country: string | null;
  cookieLocale: string | null;
  acceptLanguage: string | null;
  requestPath: string | null;
}): void {
  const accept = args.acceptLanguage ? args.acceptLanguage.slice(0, 200) : null;
  // One compact, single-line structured record per request. Uses the
  // project's `logDebugLine` (single-line variant of `logDebug`) so the
  // entry stays greppable in production aggregators instead of being
  // split across multiple lines by pretty-printing.
  logDebugLine("locale-detection", {
    path: args.path,
    locale: args.locale,
    country: args.country,
    cookieLocale: args.cookieLocale,
    acceptLanguage: accept,
    requestPath: args.requestPath,
  });
}

// DACH + Liechtenstein. First-time visitors from these countries see the
// German marketing copy + EUR pricing. Everyone else sees English + USD.
// Lucas can extend this set later if e.g. Italy/France should also default
// to German for the German-speaking border regions, but for now the rule is
// strictly "German is the regional language here".
const DACH_COUNTRIES = new Set(["DE", "AT", "CH", "LU", "LI"]);

function isSupported(value: string | undefined | null): value is Locale {
  return !!value && (SUPPORTED as readonly string[]).includes(value);
}

// Vercel injects `x-vercel-ip-country` (ISO 3166-1 alpha-2) on every
// request once the project is deployed. In local dev / Replit preview the
// header is absent, so we return null and the caller falls through to the
// Accept-Language sniff. This keeps dev behaviour identical to before
// while the production behaviour becomes country-driven.
function geoLocale(country: string | null): Locale | null {
  if (!country) return null;
  const code = country.toUpperCase();
  return DACH_COUNTRIES.has(code) ? "de" : "en";
}

// Lightweight Accept-Language parser. Walks the comma-separated list in
// quality order (q=1.0 first, q=0.0 last) and returns the first tag whose
// primary language sub-tag matches one of our supported locales.
//
// Examples handled:
//   "de-DE,de;q=0.9,en;q=0.8"   → "de"
//   "en-US,en;q=0.9,de;q=0.7"   → "en"
//   "fr-FR,fr;q=0.9"            → null   (caller falls back to DEFAULT)
//
// Kept inline (no library) because we only need the basic case and adding
// a parser dep for one header on marketing pages would be overkill.
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

  // TEMP (task #219): snapshot raw signals once so we can attach them to
  // whichever detection path ends up winning. None of these are PII —
  // country is a 2-letter ISO code, cookieLocale is just "de"/"en"/null,
  // acceptLanguage gets truncated to 200 chars before logging, and the
  // request path is the routed pathname forwarded by middleware.
  const country = hdrs.get("x-vercel-ip-country");
  const cookieStore = await cookies();
  const cookieLocaleRaw = cookieStore.get("NEXT_LOCALE")?.value ?? null;
  const acceptLanguageRaw = hdrs.get("accept-language");
  const requestPath = hdrs.get(PATHNAME_HEADER);

  // 0) `?lang=de` / `?lang=en` URL override — set by middleware on the
  //    public marketing pages (/pro, /beta). Highest precedence so the
  //    canvas iframes (which can't share cookies cross-origin) and any
  //    deep-linked share URL render in the requested language regardless
  //    of cookie / IP-country / Accept-Language. Invalid values are
  //    ignored — the request falls through to the normal cookie/geo path
  //    so existing behaviour is preserved everywhere else.
  const localeOverride = hdrs.get("x-glev-locale-override");
  if (isSupported(localeOverride)) {
    logLocaleDecision({
      path: "override",
      locale: localeOverride,
      country,
      cookieLocale: cookieLocaleRaw,
      acceptLanguage: acceptLanguageRaw,
      requestPath,
    });
    return {
      locale: localeOverride,
      messages: (await import(`../messages/${localeOverride}.json`)).default,
    };
  }

  // 1) Explicit cookie wins — set by the in-app language picker and by
  //    LanguageSync after a logged-in user signs in. This guarantees a
  //    visitor who flipped to the other language stays on it even when
  //    their geo says otherwise.
  if (isSupported(cookieLocaleRaw)) {
    logLocaleDecision({
      path: "cookie",
      locale: cookieLocaleRaw,
      country,
      cookieLocale: cookieLocaleRaw,
      acceptLanguage: acceptLanguageRaw,
      requestPath,
    });
    return {
      locale: cookieLocaleRaw,
      messages: (await import(`../messages/${cookieLocaleRaw}.json`)).default,
    };
  }

  // 2) Country-based: visitors from DE/AT/CH/LU/LI default to the German
  //    site (with EUR pricing); everyone else to the English site (with
  //    USD pricing). Vercel sets `x-vercel-ip-country` automatically on
  //    every request once the project is deployed; on Replit / local dev
  //    this header is absent so we fall through to step 3.
  const geo = geoLocale(country);
  if (geo) {
    logLocaleDecision({
      path: "geo",
      locale: geo,
      country,
      cookieLocale: cookieLocaleRaw,
      acceptLanguage: acceptLanguageRaw,
      requestPath,
    });
    return {
      locale: geo,
      messages: (await import(`../messages/${geo}.json`)).default,
    };
  }

  // 3) No geo signal (local dev, Replit preview, non-Vercel hosting):
  //    sniff Accept-Language so first-time visitors land on their
  //    browser's preferred locale. Keeps dev iteration sane — a German
  //    browser on Replit still sees German copy without flipping a switch.
  const acceptLang = parseAcceptLanguage(acceptLanguageRaw);
  const locale: Locale = acceptLang ?? DEFAULT;

  logLocaleDecision({
    path: acceptLang ? "accept-language" : "default",
    locale,
    country,
    cookieLocale: cookieLocaleRaw,
    acceptLanguage: acceptLanguageRaw,
    requestPath,
  });

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
