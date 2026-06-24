import { MetadataRoute } from "next";
import { fetchSoroArticles } from "@/lib/soro-rss";

// Static routes use build-time lastModified (refreshed on every Vercel deploy).
// Soro article dates come from pubDate in the RSS feed (revalidated hourly).
const LAST_MOD = new Date();

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const articles = await fetchSoroArticles().catch(() => []);

  const articleEntries: MetadataRoute.Sitemap = articles.map((a) => ({
    url: `https://glev.app/blog/${a.slug}`,
    lastModified: a.pubDate ? new Date(a.pubDate) : LAST_MOD,
    changeFrequency: "monthly",
    priority: 0.8,
  }));

  return [
    { url: "https://glev.app", lastModified: LAST_MOD, changeFrequency: "weekly", priority: 1 },
    { url: "https://glev.app/pro", lastModified: LAST_MOD, changeFrequency: "monthly", priority: 0.9 },
    { url: "https://glev.app/blog", lastModified: LAST_MOD, changeFrequency: "daily", priority: 0.9 },
    ...articleEntries,
    { url: "https://glev.app/beta", lastModified: LAST_MOD, changeFrequency: "monthly", priority: 0.7 },
    { url: "https://glev.app/setup", lastModified: LAST_MOD, changeFrequency: "monthly", priority: 0.6 },
    { url: "https://glev.app/klinik", lastModified: LAST_MOD, changeFrequency: "monthly", priority: 0.5 },
    { url: "https://glev.app/contact", lastModified: LAST_MOD, changeFrequency: "yearly", priority: 0.4 },
    { url: "https://glev.app/support", lastModified: LAST_MOD, changeFrequency: "monthly", priority: 0.6 },
    { url: "https://glev.app/legal", lastModified: LAST_MOD, changeFrequency: "yearly", priority: 0.3 },
    { url: "https://glev.app/legal/eula", lastModified: LAST_MOD, changeFrequency: "yearly", priority: 0.3 },
    { url: "https://glev.app/login", lastModified: LAST_MOD, changeFrequency: "yearly", priority: 0.2 },
  ];
}
