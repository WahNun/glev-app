import { MetadataRoute } from "next";

// Static list of public, indexable entry-point routes (each has a real
// top-level app/<route>/page.tsx). Admin (/glev-ops), protected app pages,
// auth callbacks and dynamic-only routes (e.g. /praxis/[slug], which has no
// root page) are intentionally excluded. /login is kept as a public sign-in
// entry point. lastModified is set at build time — Vercel rebuilds on every
// deploy so the timestamp stays reasonably fresh.
const LAST_MOD = new Date();

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: "https://glev.app", lastModified: LAST_MOD, changeFrequency: "weekly", priority: 1 },
    { url: "https://glev.app/pro", lastModified: LAST_MOD, changeFrequency: "monthly", priority: 0.9 },
    { url: "https://glev.app/beta", lastModified: LAST_MOD, changeFrequency: "monthly", priority: 0.7 },
    { url: "https://glev.app/blog", lastModified: LAST_MOD, changeFrequency: "weekly", priority: 0.6 },
    { url: "https://glev.app/setup", lastModified: LAST_MOD, changeFrequency: "monthly", priority: 0.6 },
    { url: "https://glev.app/klinik", lastModified: LAST_MOD, changeFrequency: "monthly", priority: 0.5 },
    { url: "https://glev.app/contact", lastModified: LAST_MOD, changeFrequency: "yearly", priority: 0.4 },
    { url: "https://glev.app/support", lastModified: LAST_MOD, changeFrequency: "monthly", priority: 0.6 },
    { url: "https://glev.app/legal", lastModified: LAST_MOD, changeFrequency: "yearly", priority: 0.3 },
    { url: "https://glev.app/legal/eula", lastModified: LAST_MOD, changeFrequency: "yearly", priority: 0.3 },
    { url: "https://glev.app/login", lastModified: LAST_MOD, changeFrequency: "yearly", priority: 0.2 },
  ];
}
