import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

const SUPPORTED = ["de", "en"] as const;
type Locale = (typeof SUPPORTED)[number];
const DEFAULT: Locale = "de";

function isSupported(value: string | undefined): value is Locale {
  return !!value && (SUPPORTED as readonly string[]).includes(value);
}

export default getRequestConfig(async () => {
  const store = await cookies();
  const cookieValue = store.get("NEXT_LOCALE")?.value;
  const locale: Locale = isSupported(cookieValue) ? cookieValue : DEFAULT;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
