import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import withSerwistInit from "@serwist/next";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  // Reload all open tabs when the user comes back online after being offline
  // so they get fresh data immediately.
  reloadOnOnline: true,
  // Disable the SW in development — it intercepts hot-module replacement
  // requests and breaks fast refresh in the Replit preview.
  disable: process.env.NODE_ENV === "development",
});

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

export default withSerwist(withNextIntl(nextConfig));
