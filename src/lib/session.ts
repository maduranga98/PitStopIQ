// ── Sign-out, and the cross-tab account guard ─────────────────────────────────
//
// Signing out is not just dropping the token. Three things outlive it, and each
// one is a way for the next owner to see the previous owner's centre:
//
//  1. Open listeners. Rules stop matching the instant the token goes, while the
//     routes holding them are still mounted (handled in lib/listeners.ts).
//  2. The Firestore IndexedDB cache. Rules gate every re-read, so this is not a
//     data leak — but the SDK client carries query state and resume tokens for
//     the previous user, and on a shared counter tablet that is exactly the
//     surface the "switching accounts crashes the app" reports come from.
//  3. React state. Every mounted screen still holds the previous centre's rows
//     until it unmounts, and a router push does not guarantee that.
//
// Hence the hard navigate at the end. It is not belt-and-braces: terminate()
// permanently closes the Firestore client, and any component that survives the
// sign-out and touches `db` afterwards throws. Only a fresh document gets a
// fresh client, so a router push here would leave the app running against a
// terminated one.
import { signOut } from "firebase/auth";
import { auth, db } from "../config/firebase";
import { clearAllListeners } from "./listeners";
import { clearRefCache } from "./refCache";

/**
 * localStorage keys that belong to the SIGNED-IN ACCOUNT and must not survive
 * into the next session. Currently the remembered branch, which is keyed by uid
 * (`psiq_active_branch_<uid>`).
 *
 * Deliberately NOT cleared: `pitstopiq.lang`, `pitstopiq.invoicePaperSize` and
 * `pitstopiq.printSetupSeen`. Those describe the DEVICE — the language this
 * counter runs in and the printer sitting next to it — not whoever is signed in.
 * Wiping a centre's printer configuration on every sign-out would be its own
 * support call.
 */
const ACCOUNT_KEY_PREFIX = "psiq_active_branch_";

/** How long the Firestore teardown may take before sign-out proceeds without it. */
const CACHE_TEARDOWN_TIMEOUT_MS = 3000;

/**
 * Resolve `work`, or reject once the budget is spent. The original promise keeps
 * a no-op catch so a rejection arriving after we moved on cannot surface as an
 * unhandled rejection.
 */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  work.catch(() => {});
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    work.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    }),
  ]);
}

function clearAccountScopedStorage(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(ACCOUNT_KEY_PREFIX)) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable (private mode, locked-down WebView). The hard
    // navigate below still ends the session; a stale branch key is recoverable.
  }
  try {
    // All of it: the only things in here are this session's one-shot recovery
    // guards, which must not carry into the next sign-in.
    sessionStorage.clear();
  } catch {
    // As above.
  }
}

/**
 * Sign out completely and land on a clean document.
 *
 * Order matters and is the whole point:
 *   listeners → token → Firestore client → cache → storage → navigate
 *
 * Listeners go FIRST, while the token is still valid, so rules never get the
 * chance to deny a listener that is still attached. The navigate goes LAST,
 * because everything before it leaves the page unable to read Firestore.
 *
 * Every step after signOut is best-effort. Once the token is gone the user IS
 * signed out; a cache that refuses to clear must not strand them on a screen
 * they can no longer use, so each failure is logged and the navigate still
 * happens.
 */
export async function signOutSafely(redirectTo = "/login"): Promise<void> {
  clearAllListeners();
  clearRefCache();

  try {
    await signOut(auth);
  } catch (err) {
    // Even this is not fatal: clearing the cache and reloading still drops the
    // session from this device, which is what the user asked for.
    console.error("[session] signOut failed, continuing teardown:", err);
  }

  // Bounded on purpose. clearIndexedDbPersistence blocks while any other client
  // still holds the database open, and a backgrounded tab the OS froze without
  // closing is exactly that. Letting sign-out wait on it would reproduce, on the
  // way out, the same "tap the button and nothing happens" this whole effort is
  // about — so the teardown gets a budget and the navigate happens regardless.
  // A cache that outlives the budget is harmless: rules gate every read of it,
  // and the next sign-in starts a fresh client anyway.
  try {
    await withTimeout(
      (async () => {
        const { terminate, clearIndexedDbPersistence } = await import("firebase/firestore");
        await terminate(db);
        await clearIndexedDbPersistence(db);
      })(),
      CACHE_TEARDOWN_TIMEOUT_MS,
    );
  } catch (err) {
    console.warn("[session] could not clear the Firestore cache on sign-out:", err);
  }

  clearAccountScopedStorage();

  // replace(), not assign(): the signed-in screens must not be reachable with
  // the back button after the client has been terminated.
  window.location.replace(redirectTo);
}

// ── Cross-tab account guard ───────────────────────────────────────────────────
//
// Firebase Auth persistence is shared across tabs on one origin, but each tab
// holds its OWN AuthContext. Sign in as a different owner in a second tab and
// the first tab keeps the previous owner's uid and centerId in React state —
// and keeps writing to the previous owner's centre. On a shared counter machine
// that is a job card filed against the wrong business.
//
// Auth's own onAuthStateChanged does not reliably fire in the other tab, so the
// tabs tell each other directly. A tab that learns the signed-in account has
// changed underneath it reloads, which is the only way to rebuild every screen
// against the new identity.
const CHANNEL_NAME = "pitstopiq:auth";

type AuthBroadcast = { uid: string | null };

/** Post-reload suppression, so a reload can never re-trigger a reload. */
const GUARD_KEY = "pitstopiq:cross-tab-reloaded";

/**
 * Start listening for account changes in other tabs.
 *
 * `getCurrentUid` is read at message time rather than captured, so the guard
 * always compares against the uid this tab holds NOW.
 *
 * Returns a teardown function. BroadcastChannel is unavailable in some older
 * WebViews; there it is a no-op rather than a crash, and the app behaves as it
 * did before this guard existed.
 */
export function startCrossTabAuthGuard(getCurrentUid: () => string | null): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};

  let channel: BroadcastChannel;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    return () => {};
  }

  channel.onmessage = (event: MessageEvent<AuthBroadcast>) => {
    const theirs = event.data?.uid ?? null;
    const mine = getCurrentUid();

    // Nothing signed in here yet — the login screen has nothing to rebuild, and
    // reloading it would interrupt someone mid-sign-in.
    if (!mine) return;
    if (theirs === mine) return;

    try {
      if (sessionStorage.getItem(GUARD_KEY) === "1") {
        console.warn("[session] account changed in another tab again; not reloading twice");
        return;
      }
      sessionStorage.setItem(GUARD_KEY, "1");
    } catch {
      // Without a working guard a reload could loop, so do nothing at all.
      return;
    }

    console.info(`[session] signed-in account changed in another tab (${mine} → ${theirs ?? "signed out"}); reloading`);
    window.location.reload();
  };

  return () => {
    try {
      channel.close();
    } catch {
      // Already closed.
    }
  };
}

/** Tell the other tabs which account this one is now signed in as. */
export function broadcastAuthChange(uid: string | null): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage({ uid } satisfies AuthBroadcast);
    channel.close();
  } catch {
    // Not available — the guard simply does not run on this browser.
  }
}

/**
 * Clear the one-shot cross-tab reload guard.
 *
 * Called once the app has successfully resolved a profile after a reload: the
 * reload did its job, so a LATER account change in another tab should be
 * allowed to reload again. Without this, the guard would only ever work once
 * per tab.
 */
export function clearCrossTabGuard(): void {
  try {
    sessionStorage.removeItem(GUARD_KEY);
  } catch {
    // Nothing to clear.
  }
}
