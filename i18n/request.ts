import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";

const SUPPORTED = ["de", "en"] as const;
type Locale = (typeof SUPPORTED)[number];
const DEFAULT: Locale = "de";

function isSupported(value: string | undefined | null): value is Locale {
  return !!value && (SUPPORTED as readonly string[]).includes(value);
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
  // 1) Explicit cookie wins — set by the in-app language picker and by
  //    LanguageSync after a logged-in user signs in.
  const store = await cookies();
  const cookieValue = store.get("NEXT_LOCALE")?.value;
  if (isSupported(cookieValue)) {
    return {
      locale: cookieValue,
      messages: (await import(`../messages/${cookieValue}.json`)).default,
    };
  }

  // 2) Otherwise sniff Accept-Language so first-time visitors land on
  //    their browser's preferred locale (matters for non-logged-in
  //    German visitors hitting marketing pages — they should see
  //    German copy without having to flip a switch).
  const hdrs = await headers();
  const acceptLang = parseAcceptLanguage(hdrs.get("accept-language"));
  const locale: Locale = acceptLang ?? DEFAULT;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
