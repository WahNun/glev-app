// Glev Service Worker — plain JS, no build step needed (Turbopack-compatible)
// Strategies mirror the original serwist config.

const CACHE_STATIC  = 'glev-static-v1';
const CACHE_IMAGES  = 'glev-images-v1';
const CACHE_PAGES   = 'glev-pages-v1';
const CACHE_API     = 'glev-api-v1';
const ALL_CACHES    = [CACHE_STATIC, CACHE_IMAGES, CACHE_PAGES, CACHE_API];

// ── Install: skip waiting so the new SW activates immediately ───────────────
self.addEventListener('install', () => self.skipWaiting());

// ── Activate: claim all clients and prune old caches ────────────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !ALL_CACHES.includes(k)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Only handle same-origin + glev.app requests
  if (url.hostname !== self.location.hostname && url.hostname !== 'glev.app') return;

  const path = url.pathname;

  // Never cache: auth, payment webhooks, TTS, streaming AI/chat/engine routes
  if (/\/api\/(auth|pro\/webhook|webhooks\/|tts|chat|ai|engine)/.test(path)) return;

  // Next.js content-hashed static assets → CacheFirst (1 year)
  if (path.startsWith('/_next/static/')) {
    e.respondWith(cacheFirst(CACHE_STATIC, request));
    return;
  }

  // Images and fonts → CacheFirst (30 days)
  if (/\.(png|jpg|jpeg|svg|gif|webp|ico|woff2?|ttf|otf)$/i.test(path)) {
    e.respondWith(cacheFirst(CACHE_IMAGES, request));
    return;
  }

  // Data API routes → NetworkFirst with 5-minute cache fallback
  if (path.startsWith('/api/')) {
    e.respondWith(networkFirst(CACHE_API, request, 5 * 60));
    return;
  }

  // Protected app pages → NetworkFirst with 24-hour offline fallback
  if (/\/(de|en)\/(dashboard|engine|entries|insights|settings)/.test(path)) {
    e.respondWith(networkFirst(CACHE_PAGES, request, 24 * 60 * 60));
    return;
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function cacheFirst(cacheName, request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(cacheName, request, maxAgeSeconds) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      // Only cache if response doesn't prohibit storage
      const cc = response.headers.get('cache-control') || '';
      if (!cc.includes('no-store')) {
        cache.put(request, response.clone());
      }
    }
    return response;
  } catch {
    // Network failed — try cache
    const cached = await caches.match(request);
    if (cached) {
      // Optionally check max age
      const dateHeader = cached.headers.get('date');
      if (dateHeader && maxAgeSeconds) {
        const age = (Date.now() - new Date(dateHeader).getTime()) / 1000;
        if (age > maxAgeSeconds) return fetch(request); // stale — re-throw
      }
      return cached;
    }
    throw new Error('Network error and no cache available');
  }
}

// ── Message: SKIP_WAITING support (for manual SW updates) ───────────────────
self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
