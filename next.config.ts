import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
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

export default nextConfig;
