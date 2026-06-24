import { XMLParser } from "fast-xml-parser";

export interface SoroArticle {
  title: string;
  slug: string;
  description: string;
  content: string;
  pubDate: string;
  link: string;
}

const RSS_URL =
  process.env.SORO_RSS_URL ??
  "https://app.trysoro.com/api/rss/3e94583a-baad-4296-a2ef-e7d445982516";

let cache: { articles: SoroArticle[]; at: number } | null = null;
const CACHE_TTL = 60 * 60 * 1000; // 1h

function slugFromUrl(url: string): string {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? url;
  } catch {
    return url.split("/").filter(Boolean).at(-1) ?? url;
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export async function fetchSoroArticles(): Promise<SoroArticle[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL) return cache.articles;

  const res = await fetch(RSS_URL, {
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    console.error("[soro-rss] fetch failed", res.status);
    return cache?.articles ?? [];
  }

  const xml = await res.text();
  const parser = new XMLParser({ ignoreAttributes: false, cdataPropName: "__cdata" });
  const parsed = parser.parse(xml);

  const rawItems: unknown[] = (() => {
    const items = parsed?.rss?.channel?.item;
    if (!items) return [];
    return Array.isArray(items) ? items : [items];
  })();

  const articles: SoroArticle[] = rawItems
    .map((item) => {
      if (typeof item !== "object" || item === null) return null;
      const it = item as Record<string, unknown>;

      const link = str(it.link);
      const slug = slugFromUrl(link);
      if (!slug) return null;

      const content =
        str((it["content:encoded"] as Record<string, unknown>)?.__cdata) ||
        str(it["content:encoded"]) ||
        str((it.description as Record<string, unknown>)?.__cdata) ||
        str(it.description);

      const description =
        str((it.description as Record<string, unknown>)?.__cdata) ||
        str(it.description) ||
        str(it.title);

      return {
        title: str((it.title as Record<string, unknown>)?.__cdata) || str(it.title),
        slug,
        description: description.replace(/<[^>]+>/g, "").slice(0, 300),
        content,
        pubDate: str(it.pubDate),
        link,
      } satisfies SoroArticle;
    })
    .filter((a): a is SoroArticle => a !== null);

  cache = { articles, at: Date.now() };
  return articles;
}
