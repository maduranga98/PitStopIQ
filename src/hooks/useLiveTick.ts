import { useEffect, useState } from "react";

/**
 * Re-renders every `intervalMs` while `active`, so a running figure keeps
 * moving without anything being written. Idle otherwise — a paused or stopped
 * timer costs no renders at all. The time itself is read inside
 * summarizeTimeLog on each render, never cached here, so the figure is
 * current the moment the timer starts rather than one tick later.
 */
export function useLiveTick(active: boolean, intervalMs = 15_000): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
}
