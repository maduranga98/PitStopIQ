// ── Reference-data cache ───────────────────────────────────────────────────────
// A process-lifetime cache for the small, slow-changing collections the app
// re-reads constantly: inventory, suppliers, servicePrices, staff, customers.
//
// Why this exists on top of Firestore's own cache: a one-shot getDocs() always
// hits the server and always bills for every document it returns. Firestore's
// persistent cache only saves reads for *listeners* (which resume from a token)
// — it does nothing for a getDocs the app fires again on the next mount. So a
// picker that calls getDocs(inventory) on every keystroke burst, or a page that
// reloads the whole supplier list on every visit, pays full price every time.
//
// This wraps those fetches in a keyed TTL cache with in-flight de-duplication:
//  - concurrent callers share ONE network round-trip instead of racing
//  - repeat callers inside the TTL pay ZERO reads
//  - anything that writes to a cached collection calls invalidate() so the next
//    read is fresh
//
// Only use this for data where a few seconds of staleness is harmless. Money,
// stock levels being decremented, and job status all need a live listener.

/** Default freshness window. Long enough to collapse a burst of pickers and
 *  re-mounts, short enough that a staff member's edit shows up on the next
 *  screen without a manual refresh. */
export const DEFAULT_TTL_MS = 60_000;

interface Entry<T> {
  /** Resolved value, absent while the first fetch is still in flight. */
  value?: T;
  /** When `value` was stored (epoch ms). */
  storedAt: number;
  /** The in-flight promise, so concurrent callers share one round-trip. */
  inFlight?: Promise<T>;
}

const cache = new Map<string, Entry<unknown>>();

/**
 * Fetch `key` through the cache, running `fetcher` only on a miss.
 *
 * @param key     Must include the centerId — never let one center's data be
 *                served to another. e.g. `inventory:${centerId}`.
 * @param fetcher Runs only when there is no fresh value and no in-flight fetch.
 * @param ttlMs   Freshness window for this key.
 */
export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<T> {
  const hit = cache.get(key) as Entry<T> | undefined;

  if (hit) {
    // A fetch is already running — join it rather than starting a second one.
    if (hit.inFlight) return hit.inFlight;
    if (hit.value !== undefined && Date.now() - hit.storedAt < ttlMs) {
      return hit.value;
    }
  }

  const inFlight = fetcher()
    .then(value => {
      cache.set(key, { value, storedAt: Date.now() });
      return value;
    })
    .catch(err => {
      // Never cache a failure: drop the entry so the next caller retries
      // against the server instead of inheriting the error.
      cache.delete(key);
      throw err;
    });

  cache.set(key, { storedAt: Date.now(), inFlight });
  return inFlight;
}

/** Drop one exact key. Call after writing to that collection. */
export function invalidate(key: string): void {
  cache.delete(key);
}

/** Drop every key starting with `prefix` — e.g. `invalidatePrefix(centerId)`
 *  on sign-out or branch switch so nothing leaks across centers. */
export function invalidatePrefix(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/** Drop everything. Used on sign-out. */
export function clearRefCache(): void {
  cache.clear();
}
