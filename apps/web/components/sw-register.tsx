'use client';

import { useEffect } from 'react';

/**
 * Enregistre le service worker (flow.md §41).
 *
 * L'enregistrement n'a lieu qu'en production et uniquement dans le navigateur :
 * pendant le développement, un service worker servi depuis le cache rendrait
 * les modifications invisibles.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    const register = async () => {
      try {
        await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      } catch {
        // l'application reste pleinement fonctionnelle sans service worker
      }
    };

    // après chargement, pour ne pas concurrencer le rendu initial (§42)
    if (document.readyState === 'complete') void register();
    else window.addEventListener('load', () => void register(), { once: true });
  }, []);

  return null;
}