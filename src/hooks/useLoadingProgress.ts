import { useEffect, useState } from "react";

export interface ProgressOptions {
  /** How long this operation usually takes. The estimate reaches ~90% here. */
  expectedMs?: number;
  /** After this long, tell the user the connection looks slow. */
  slowAfterMs?: number;
  /** After this long, offer a reload — something is probably wrong. */
  stuckAfterMs?: number;
}

/**
 * Time-based loading progress estimate.
 *
 * Firestore reads and lazily-loaded route chunks give us no byte-level
 * progress, so there is no true percentage to report. A bare spinner looks
 * exactly the same whether the app is working or wedged, which is what left
 * users unsure if they'd hit a bug. Instead we ease a counter toward 99% on a
 * curve calibrated to how long the operation normally takes, and surface the
 * elapsed seconds once it overruns — so "still working" and "stuck" become two
 * visibly different states.
 */
export function useLoadingProgress({
  expectedMs = 2500,
  slowAfterMs = 8000,
  stuckAfterMs = 20000,
}: ProgressOptions = {}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = performance.now();
    const id = window.setInterval(() => setElapsed(performance.now() - start), 100);
    return () => window.clearInterval(id);
  }, []);

  // Exponential ease-out: ~90% at expectedMs, then asymptotic to 99%. Never
  // reports 100% — the component unmounts when the data actually arrives.
  const percent = Math.min(
    99,
    Math.round(99 * (1 - Math.exp((-elapsed * Math.LN10) / Math.max(expectedMs, 1))))
  );

  return {
    percent,
    seconds: Math.floor(elapsed / 1000),
    slow: elapsed >= slowAfterMs,
    stuck: elapsed >= stuckAfterMs,
  };
}
