// ── Reference-list loading, with the failure visible ────────────────────────
//
// Every one-shot reference fetch (customers, technicians, ...) used to resolve
// on failure by swallowing the error and leaving the list empty — the same
// state as "this center genuinely has none". A center with real customers on
// a bad connection saw "No customers yet"; a Pro center with real technicians
// saw "No active technicians found. Add staff first." and could not create a
// job at all, because the technician picker requires at least one and had
// silently failed to load any.
//
// This hook keeps the fail-soft behaviour — never an infinite spinner — but
// makes the failure visible and recoverable:
//  - one silent auto-retry a couple of seconds after a failure, since most of
//    these on a workshop connection are a few seconds of bad signal, not a
//    real outage
//  - `error` distinguishes "the fetch failed" from "confirmed empty" so the
//    caller can render a "Couldn't load — tap to retry" state instead of the
//    misleading empty-state text
//  - `retry()` for a manual retry, which drops the stale refData cache entry
//    first (see lib/refCache.ts) so it doesn't just hand back the same
//    failure — refCache never caches a failure itself, but without dropping
//    the entry a retry inside the cache's normal TTL would still be a no-op.
import { useCallback, useEffect, useState } from "react";

/** How long to wait after a failed fetch before trying once, silently, on
 *  the caller's behalf — before surfacing anything to the user. */
const AUTO_RETRY_DELAY_MS = 2500;

export interface UseCachedRefListResult<T> {
  data: T[];
  /** True once a fetch has settled — success OR failure — at least once. */
  loaded: boolean;
  /** True when the most recent attempt failed. `data` may still hold a
   *  previous successful result while this is true — a retry never clears
   *  what's already on screen. */
  error: boolean;
  /** Re-run the fetch, bypassing whatever refData has cached. */
  retry: () => void;
}

/**
 * Loads `fetcher(centerId)` through refData's cache, tracking loaded/error
 * state and offering a retry — the shared shape behind the customer and
 * technician pickers on NewServicePage (and anywhere else that reads through
 * lib/refData.ts).
 *
 * `fetcher` and `invalidate` are expected to be the module-level functions
 * from lib/refData.ts (fetchCustomers, fetchTechnicians, ...) — stable by
 * construction, so they are deliberately left out of the effect's deps below
 * rather than requiring every call site to wrap them in useCallback.
 */
export function useCachedRefList<T>(
  centerId: string | undefined,
  fetcher: (centerId: string) => Promise<T[]>,
  invalidate: (centerId: string) => void,
): UseCachedRefListResult<T> {
  const [data, setData] = useState<T[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  // Bumping this re-runs the effect below without needing centerId to change
  // — what a manual retry does.
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (!centerId) {
      setData([]);
      setLoaded(false);
      setError(false);
      return;
    }

    let active = true;
    let autoRetryTimer: ReturnType<typeof setTimeout> | undefined;

    const run = (isRetry: boolean) => {
      fetcher(centerId)
        .then((list) => {
          if (!active) return;
          setData(list);
          setError(false);
          setLoaded(true);
        })
        .catch(() => {
          if (!active) return;
          if (!isRetry) {
            // First failure: try again once, quietly, before telling the
            // user anything went wrong.
            autoRetryTimer = setTimeout(() => {
              if (active) run(true);
            }, AUTO_RETRY_DELAY_MS);
            return;
          }
          // The auto-retry also failed — this is the one that shows up.
          setError(true);
          setLoaded(true);
        });
    };

    setLoaded(false);
    setError(false);
    run(false);

    return () => {
      active = false;
      if (autoRetryTimer) clearTimeout(autoRetryTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerId, retryTick]);

  const retry = useCallback(() => {
    if (centerId) invalidate(centerId);
    setRetryTick((n) => n + 1);
  }, [centerId, invalidate]);

  return { data, loaded, error, retry };
}
