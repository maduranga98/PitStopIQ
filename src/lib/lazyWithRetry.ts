import { lazy, type ComponentType } from "react";

/**
 * Drop-in replacement for React.lazy that survives stale-chunk failures.
 *
 * Every page is code-split, and the app ships as an auto-updating PWA. After a
 * new deploy the chunk filenames get fresh content hashes, so a tab still
 * holding the previous index.html tries to fetch a chunk that no longer exists
 * ("TypeError: Failed to fetch dynamically imported module: …/SettingsPage-XXXX.js").
 * The bare import() rejects and the route's ErrorBoundary shows a crash screen.
 *
 * This wrapper:
 *   1. retries the import once (covers a transient network blip), then
 *   2. if it still fails, forces a single full-page reload so the browser pulls
 *      the new index.html + chunk manifest. A sessionStorage guard makes sure we
 *      only reload once per session, so a genuinely broken chunk can't loop.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches React.lazy's own ComponentType<any> signature
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    const RELOAD_KEY = "pitstopiq:chunk-reload";
    try {
      const mod = await factory();
      window.sessionStorage.removeItem(RELOAD_KEY);
      return mod;
    } catch {
      // Retry once before assuming the chunk is gone for good.
      try {
        const mod = await factory();
        window.sessionStorage.removeItem(RELOAD_KEY);
        return mod;
      } catch (err) {
        const alreadyReloaded = window.sessionStorage.getItem(RELOAD_KEY);
        if (!alreadyReloaded) {
          window.sessionStorage.setItem(RELOAD_KEY, "1");
          window.location.reload();
          // Never resolve — the reload replaces the page before this matters.
          return new Promise<{ default: T }>(() => {});
        }
        // Second failure after a reload: the chunk is really unavailable, so
        // let the ErrorBoundary render its fallback instead of looping.
        throw err;
      }
    }
  });
}
