import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  allowedDevOrigins: [
    "*.replit.dev",
    "*.repl.co",
    "*.kirk.replit.dev",
    "*.pike.replit.dev",
  ],
};

export default nextConfig;
