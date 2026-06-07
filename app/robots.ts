import { MetadataRoute } from "next";

// NOTE: robots.txt is additionally managed by Cloudflare (the "Content-Signal"
// + AI-bot Disallow block is injected by Cloudflare and appended to whatever
// the origin returns). This origin file only adds the Sitemap reference and a
// permissive default — it does NOT touch the Cloudflare-managed Google-Extended
// / GPTBot / CCBot Disallow rules (those remain a Cloudflare-level strategy
// decision, see replit.md).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: "https://glev.app/sitemap.xml",
    host: "https://glev.app",
  };
}
