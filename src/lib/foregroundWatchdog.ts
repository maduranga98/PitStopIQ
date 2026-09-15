// ── Coming back to a phone that was asleep ─────────────────────────────────────
//
// A service centre's tablet spends most of the day locked in someone's pocket or
// face-down on a bench. Mobile browsers freeze a backgrounded tab: timers stop,
// sockets are torn down, and IndexedDB handles can be reclaimed outright. When
// the tab is brought back, the Firestore client sometimes never recovers its
// connection — every read sits there, and the screen shows stale data or a
// spinner that will not end. From the counter that is "the app hangs when I pick
// the phone up".
//
// Nothing in the app noticed. This does: on returning to the foreground after a
// real absence, probe Firestore with a read that MUST go to the server. If the
// probe cannot answer inside its budget while the device is online, the client
// is wedged and only a fresh document recovers it.
//
// A reload is cheap here — writes are already committed to the local cache
// before this can fire (lib/firestoreWrite.ts), so nothing in flight is lost.
import { doc, getDocFromServer } from "firebase/firestore";
import { db } from "../config/firebase";

/**
 * How long the tab must have been away before returning is worth a probe.
 * Flipping to another app for a few seconds is normal use and must not cost a
 * round trip; a phone that has been in a pocket is the case worth checking.
 */
const ABSENCE_THRESHOLD_MS = 60_000;

/** The probe's budget. A healthy round trip is tens of milliseconds. */
const PROBE_TIMEOUT_MS = 8_000;

/**
 * The probe target: a document that does not exist, in a collection whose `get`
 * rule is public (see firestore.rules — `links/{code}`).
 *
 * Reading a missing document still makes the full server round trip, which is
 * the only thing being measured, and it works whether or not anyone is signed in
 * — so the watchdog does not need to know about auth, and cannot be fooled by a
 * cached copy of a real document.
 */
const PROBE_PATH = ["links", "__connectivity_probe__"] as const;

let hiddenSince: number | null = null;
let probing = false;

async function probeFirestore(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("probe timed out")), PROBE_TIMEOUT_MS);
  });
  try {
    await Promise.race([
      getDocFromServer(doc(db, PROBE_PATH[0], PROBE_PATH[1])).finally(() => clearTimeout(timer)),
      timeout,
    ]);
    return true;
  } catch (err) {
    // A rejection is not automatically a wedged client: permission-denied or a
    // genuine offline state are answers, and an answer means the transport works.
    const code = typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: unknown }).code)
      : undefined;
    if (code === "permission-denied" || code === "unauthenticated") return true;
    console.warn("[watchdog] Firestore probe failed:", err);
    return false;
  }
}

async function onReturnToForeground(): Promise<void> {
  if (probing) return;
  const away = hiddenSince === null ? 0 : Date.now() - hiddenSince;
  hiddenSince = null;
  if (away < ABSENCE_THRESHOLD_MS) return;

  // Offline is not wedged — it is offline, and the app already handles that.
  // Reloading here would drop an owner out of a screen they are working in with
  // no connection to reload from.
  if (typeof navigator !== "undefined" && !navigator.onLine) return;

  probing = true;
  try {
    const healthy = await probeFirestore();
    if (healthy) return;
    if (!navigator.onLine) return; // went offline mid-probe; not our case
    console.warn(`[watchdog] no response after ${Math.round(away / 1000)}s in the background; reloading`);
    window.location.reload();
  } finally {
    probing = false;
  }
}

/**
 * Start watching. Returns a teardown function.
 *
 * Two entry points, because they are genuinely different events:
 *
 *  - visibilitychange fires when the tab is shown again in the SAME document.
 *    The JavaScript heap survived; the network may not have.
 *  - pageshow with persisted=true is a bfcache restore — the browser froze the
 *    whole document (typically a back-navigation, or iOS Safari reclaiming it)
 *    and has put it back. Firestore's connection state after that is not
 *    trustworthy and is not worth probing: reload straight away.
 */
export function startForegroundWatchdog(): () => void {
  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      hiddenSince = Date.now();
      return;
    }
    void onReturnToForeground();
  };

  const onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted) return;
    console.info("[watchdog] restored from the back/forward cache; reloading for a fresh client");
    window.location.reload();
  };

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pageshow", onPageShow);
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pageshow", onPageShow);
  };
}
