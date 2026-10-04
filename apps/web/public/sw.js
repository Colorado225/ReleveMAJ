/*
 * ConsoCI — service worker (flow.md §41).
 *
 * Stratégie volontairement limitée à la V1, comme le demande le cahier des
 * charges : on ne rend pas toute l'application offline. On provide :
 *   - le squelette de l'application (installable, ouverture hors ligne) ;
 *   - le dashboard précédemment chargé, servi depuis le cache ;
 *   - la page « Ajouter », pour permettre un relevé hors ligne.
 *
 * Les Server Actions ne sont pas mises en cache : une écriture en base doit
 * toujours atteindre le serveur. Un relevé hors ligne est donc saisissable
 * visuellement, puis synchronisé par l'utilisateur.
 */

const VERSION = 'consci-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const DATA_CACHE = `${VERSION}-data`;

// le squelette : suffisant pour afficher l'application hors ligne
const SHELL_ASSETS = ['/', '/connexion', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API et Server Actions : toujours réseau, jamais de cache stale
  if (url.pathname.startsWith('/api/')) return;

  // navigation : réseau d'abord, cache en secours (flow.md §41)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(DATA_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match('/')),
        ),
    );
    return;
  }

  // ressources statiques : cache d'abord
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok && (url.pathname.startsWith('/_next/static') || url.pathname.startsWith('/icons'))) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});

// permet à la page de demander l'activation immédiate d'une nouvelle version
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});