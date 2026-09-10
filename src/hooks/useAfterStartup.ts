import { useEffect, useState } from "react";

/**
 * False while the app is still getting on screen, true once the browser is idle.
 *
 * Work that isn't needed for the first paint — a background subscription, a
 * badge count, a library only one panel uses — should wait behind this. On a
 * mid-range Android phone the start-up second is already spent on parsing the
 * bundle, opening IndexedDB and the first Firestore reads; anything else fired
 * in that window makes the app feel like it is not loading at all.
 *
 * requestIdleCallback where it exists (Chrome/Android), a timer everywhere else,
 * and a hard ceiling either way so a permanently busy page still gets there.
 */
export function useAfterStartup(maxDelayMs = 2500): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (ready) return;
    const idle = (window as typeof window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    });
    if (typeof idle.requestIdleCallback === "function") {
      const handle = idle.requestIdleCallback(() => setReady(true), { timeout: maxDelayMs });
      return () => idle.cancelIdleCallback?.(handle);
    }
    const timer = setTimeout(() => setReady(true), maxDelayMs);
    return () => clearTimeout(timer);
  }, [ready, maxDelayMs]);

  return ready;
}
