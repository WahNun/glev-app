import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    staleTimes: { dynamic: 60, static: 300 },
  },
  devIndicators: false,
  allowedDevOrigins: [
    "*.replit.dev",
    "*.repl.co",
    "*.kirk.replit.dev",
    "*.pike.replit.dev",
  ],
  async headers() {
    return [
      {
        // apple-app-site-association has no extension — Apple's CDN verifier
        // requires application/json, otherwise it ignores the file entirely
        // and Password AutoFill / Associated Domains won't activate.
        source: "/.well-known/apple-app-site-association",
        headers: [
          { key: "Content-Type", value: "application/json" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
