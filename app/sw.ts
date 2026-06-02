/// <reference lib="webworker" />
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist, CacheFirst, NetworkFirst, NetworkOnly, StaleWhileRevalidate, ExpirationPlugin } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: [
    // ── Next.js static assets (JS/CSS bundles, versioned by hash) ───────────
    // CacheFirst: these filenames contain content hashes, so a cached file
    // is always correct. 1-year TTL keeps them around for subsequent launches.
    {
      matcher: /\/_next\/static\/.*/i,
      handler: new CacheFirst({
        cacheName: "next-static",
        plugins: [
          new ExpirationPlugin({ maxAgeSeconds: 60 * 60 * 24 * 365, maxEntries: 200 }),
        ],
      }),
    },
    // ── Next.js image optimisation ───────────────────────────────────────────
    {
      matcher: /\/_next\/image\?.*/i,
      handler: new StaleWhileRevalidate({
        cacheName: "next-image",
        plugins: [
          new ExpirationPlugin({ maxAgeSeconds: 60 * 60 * 24 * 30, maxEntries: 60 }),
        ],
      }),
    },
    // ── Static public assets (icons, mockups, logos, fonts) ─────────────────
    {
      matcher: /\.(png|jpg|jpeg|svg|gif|webp|ico|woff2?|ttf|otf)$/i,
      handler: new CacheFirst({
        cacheName: "static-assets",
        plugins: [
          new ExpirationPlugin({ maxAgeSeconds: 60 * 60 * 24 * 30, maxEntries: 80 }),
        ],
      }),
    },
    // ── Auth API routes — never cache ────────────────────────────────────────
    // Login/signup/logout must always hit the network.
    {
      matcher: /^https:\/\/glev\.app\/api\/auth\/.*/i,
      handler: new NetworkOnly(),
    },
    // ── Stripe / webhook routes — never cache ────────────────────────────────
    {
      matcher: /^https:\/\/glev\.app\/api\/(pro\/webhook|webhooks)\/.*/i,
      handler: new NetworkOnly(),
    },
    // ── TTS audio — never cache (large binary, changes per request) ──────────
    {
      matcher: /^https:\/\/glev\.app\/api\/tts\/.*/i,
      handler: new NetworkOnly(),
    },
    // ── AI / chat routes — network first, short cache fallback ──────────────
    // Streaming endpoints need fresh data; cache only as offline fallback.
    {
      matcher: /^https:\/\/glev\.app\/api\/(chat|ai|engine)\/.*/i,
      handler: new NetworkFirst({
        cacheName: "api-ai",
        plugins: [
          new ExpirationPlugin({ maxAgeSeconds: 60 * 5, maxEntries: 10 }),
        ],
      }),
    },
    // ── Data API routes (meals, CGM, insulin, etc.) ──────────────────────────
    // NetworkFirst: shows cached data instantly if offline, refreshes when online.
    {
      matcher: /^https:\/\/glev\.app\/api\/.*/i,
      handler: new NetworkFirst({
        cacheName: "api-data",
        plugins: [
          new ExpirationPlugin({ maxAgeSeconds: 60 * 5, maxEntries: 60 }),
        ],
      }),
    },
    // ── App HTML pages (SSR, requires auth) ─────────────────────────────────
    // NetworkFirst: always try to get fresh SSR output; fall back to cached
    // shell if offline so the user sees something instead of a white screen.
    {
      matcher: /^https:\/\/glev\.app\/(dashboard|engine|entries|insights|settings).*/i,
      handler: new NetworkFirst({
        cacheName: "app-pages",
        plugins: [
          new ExpirationPlugin({ maxAgeSeconds: 60 * 60 * 24, maxEntries: 20 }),
        ],
      }),
    },
  ],
});

serwist.addEventListeners();
