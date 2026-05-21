import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Keep recently visited pages in the Next.js Router Cache longer so
    // back-navigations (e.g. Engine → Entries) are served instantly from
    // memory without a round-trip to Vercel. dynamic=60 covers pages
    // generated per-request (all protected tabs); static=300 covers
    // fully-static pages like the marketing site.
    staleTimes: { dynamic: 60, static: 300 },
  },
  // Hide the floating "N" Next.js dev-mode badge in the bottom corner.
  // Production builds never render it; this just keeps the Replit dev
  // preview clean too.
  devIndicators: false,
  allowedDevOrigins: [
    "*.replit.dev",
    "*.repl.co",
    "*.kirk.replit.dev",
    "*.pike.replit.dev",
  ],
};

export default withNextIntl(nextConfig);
