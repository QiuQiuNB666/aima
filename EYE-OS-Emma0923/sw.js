/* Bump this version whenever shipping an updated app shell. */
const VERSION = 'emma0923-v8';
const SCOPE = new URL(self.registration.scope);
const CACHE_PREFIX = `eyevue-console:${encodeURIComponent(SCOPE.href)}:`;
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;
const SHELL_FILES = ['index.html', 'app.js', 'styles.css', 'app.css', 'icon.svg', 'manifest.webmanifest', 'display.html', 'display.css', 'display-core.js', 'display-controller.js', 'display-receiver.js', 'exoskeleton-controller.js', 'hands.html', 'hands.css', 'hands-core.js', 'hands-controller.js', 'hands-input.js', 'hands-reader.js', 'wear-core.js', 'tutorial-core.js'];
const SHELL_URLS = new Set(SHELL_FILES.map(file => new URL(file, SCOPE).href));
const INDEX_URL = new URL('index.html', SCOPE).href;

self.addEventListener('install', event => {
  // Atomic installation: retain the previous version if any required file fails.
  // Do not skipWaiting; avoid replacing the shell of a currently open session.
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(
    [...SHELL_URLS].map(url => new Request(url, { cache: 'reload' }))
  )));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

function safeToCache(response) {
  if (!response || response.status !== 200 || response.type === 'opaque') return false;
  const url = new URL(response.url);
  return url.origin === SCOPE.origin && url.pathname.startsWith(SCOPE.pathname);
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  const relativePath = url.pathname.slice(SCOPE.pathname.length);
  // Never serve remembered device status or audio actions from a cache.
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')
    || relativePath === 'api' || relativePath.startsWith('api/')) return;

  if (request.mode === 'navigate') {
    // Keep controller and output HTML separate, including their offline fallback.
    const navigationKey = relativePath === '' || relativePath === 'index.html' ? INDEX_URL
      : ['display.html', 'hands.html'].includes(relativePath) ? new URL(relativePath, SCOPE).href : null;
    if (!navigationKey) return;
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response.status >= 500) throw new Error('Navigation temporarily unavailable');
        if (safeToCache(response) && response.headers.get('content-type')?.includes('text/html')) {
          await cache.put(navigationKey, response.clone());
        }
        return response;
      } catch {
        return (await cache.match(navigationKey)) || new Response('页面暂时不可用，请联网后重试。', {
          status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
    })());
    return;
  }

  const canonicalUrl = new URL(url);
  canonicalUrl.search = '';
  canonicalUrl.hash = '';
  if (!SHELL_URLS.has(canonicalUrl.href)) return;

  // Only app files enter Cache Storage; recordings and imported media do not.
  const refresh = (async () => {
    const response = await fetch(request);
    if (safeToCache(response)) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(canonicalUrl.href, response.clone());
    }
    return response;
  })();
  event.waitUntil(refresh.then(() => undefined).catch(() => undefined));
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const saved = await cache.match(canonicalUrl.href);
    if (saved) return saved;
    try { return await refresh; }
    catch {
      return new Response('资源暂时不可用，请联网后重试。', {
        status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  })());
});
