// Which layout the screen is actually wide enough for.
//
// Several list pages used to render a full desktop TABLE and a full set of
// mobile CARDS from the same array and hide one with Tailwind's
// `hidden md:block` / `md:hidden`. CSS hides them; React still builds every
// row twice — two elements, two prop objects, two reconciliations per record.
// On a 100-row inventory list on an older phone that is half the render work
// thrown away by the compositor.
//
// So the pages ask this instead and render one layout. The query is
// `min-width: 768px` — Tailwind's `md` breakpoint exactly — so what renders
// still matches what those classNames say, and the classNames stay on the
// elements so nothing looks different.
import { useSyncExternalStore } from "react";

const QUERY = "(min-width: 768px)";

// One MediaQueryList for the whole app rather than one per hook call: several
// of these pages mount more than one list, and a matchMedia listener per
// component is a listener per component to fire on every resize.
//
// Created lazily because this module is also imported where there is no
// window (the PWA's precache manifest build, tests), and matchMedia at module
// scope would throw there before React ever runs.
let mql: MediaQueryList | null = null;

function query(): MediaQueryList | null {
  if (typeof window === "undefined" || !window.matchMedia) return null;
  mql ??= window.matchMedia(QUERY);
  return mql;
}

function subscribe(onChange: () => void): () => void {
  const m = query();
  if (!m) return () => {};
  // addEventListener("change") rather than the deprecated addListener: the
  // oldest Android WebView this app supports (Chrome 39+ era) is long past
  // the point where the modern signature landed, and Safari caught up in 14.
  m.addEventListener("change", onChange);
  return () => m.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return query()?.matches ?? false;
}

// Server/prerender has no viewport to measure. Answering "not desktop" means
// the first paint is the mobile layout, which is the narrower and cheaper of
// the two — a desktop browser then corrects it on hydration.
function getServerSnapshot(): boolean {
  return false;
}

/** True when the viewport is at least Tailwind's `md` breakpoint (768px). */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
