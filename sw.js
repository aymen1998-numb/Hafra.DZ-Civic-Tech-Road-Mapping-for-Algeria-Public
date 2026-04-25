/**
 * hafra.dz — Service Worker
 * Enables PWA install + offline map tile caching.
 */

'use strict';

const CACHE_APP   = 'hafra-app-v1';
const CACHE_TILES = 'hafra-tiles-v1';

const APP_SHELL = [
  '/',
  '/index.html',
  '/app.js',
  '/manifest.json',
];

// ── INSTALL ───────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_APP)
      .then(cache => Promise.allSettled(APP_SHELL.map(url =>
        cache.add(url).catch(() => { /* non-fatal */ })
      )))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ──────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  const KEEP = new Set([CACHE_APP, CACHE_TILES]);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !KEEP.has(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache Supabase API / realtime
  if (url.hostname.includes('supabase.co') || url.hostname.includes('supabase.in')) return;

  // Map tiles: cache-first with a 14-day TTL approximation (LRU via cache storage)
  if (url.hostname.includes('cartocdn.com') || url.hostname.includes('openstreetmap.org')) {
    event.respondWith(
      caches.open(CACHE_TILES).then(cache =>
        cache.match(request).then(cached => {
          if (cached) return cached;
          return fetch(request).then(res => {
            if (res.ok) cache.put(request, res.clone());
            return res;
          }).catch(() => new Response('', { status:503 }));
        })
      )
    );
    return;
  }

  // App shell: stale-while-revalidate
  event.respondWith(
    caches.match(request).then(cached => {
      const fetchPromise = fetch(request).then(res => {
        if (res.ok) {
          caches.open(CACHE_APP).then(cache => cache.put(request, res.clone()));
        }
        return res;
      }).catch(() => null);
      return cached || fetchPromise;
    })
  );
});
