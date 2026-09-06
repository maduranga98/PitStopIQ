import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentSingleTabManager,
  type FirestoreSettings,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";

// Firebase Hosting auto-serves the /__/auth/* helper routes on every custom
// domain connected to this site, so pointing authDomain at whichever host is
// actually serving the app keeps the auth persistence iframe same-origin.
// Hardcoding it to the .firebaseapp.com domain instead makes that iframe
// cross-site on custom domains (e.g. app.pitstopiq.com), which browsers with
// third-party storage restrictions (including Chrome Incognito) block —
// causing sign-in to hang silently instead of completing or erroring.
const runtimeAuthDomain =
  typeof window !== "undefined" && window.location.hostname !== "localhost"
    ? window.location.hostname
    : import.meta.env.VITE_FIREBASE_AUTH_DOMAIN;

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: runtimeAuthDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// ── Local cache ────────────────────────────────────────────────────────────────
// persistentLocalCache (IndexedDB) is what keeps Firestore's read bill sane.
// Two things it does that the default in-memory cache cannot:
//
//  1. Query resume tokens survive a reload. When a listener re-attaches to a
//     query it already has cached, the SDK sends the stored token and the
//     server replies with only the documents that CHANGED since then. Billed
//     reads for an unchanged collection drop from N to ~0. With memory-only
//     caching every reload, new tab, and PWA cold start re-downloads — and
//     re-pays for — every document on every screen the user opens.
//  2. Offline writes are queued on disk instead of in the tab, so they survive
//     a reload while still offline (see firestoreWrite.ts).
//
// NOTE: persistence was previously removed (commit fda88a7) to fix slow app
// loads. The actual cause of that slowness was the useCacheWarming hook, which
// eagerly pre-fetched ~2,600 documents into IndexedDB on every login. That hook
// is gone and is NOT coming back — the cache is now filled lazily, only by
// reads the app was going to make anyway, so there is no start-up cost to pay.
//
// persistentSingleTabManager (NOT the multi-tab manager): the multi-tab manager
// coordinates open tabs through a "primary lease" in IndexedDB, where one
// client owns the network connection and the others proxy through it. Mobile
// OSes freeze and kill backgrounded tabs (and the installed PWA) without
// releasing that lease, so a fresh session finds a stale lease it can never
// acquire — the network listen never starts and every read hangs. That was the
// "Failed to obtain primary lease" login stall. The single-tab manager keeps
// the offline cache but never runs that cross-tab election.
//
// forceOwnership: the single-tab manager still guards IndexedDB with an
// exclusive lock that a killed background tab leaves behind. Without this a
// fresh session fails to "obtain exclusive access to the persistence layer" and
// silently degrades to an in-memory cache — quietly restoring the exact read
// amplification this config exists to prevent. forceOwnership makes the newest
// session reclaim the lock instead.
//
// experimentalForceLongPolling: mobile networks and carrier proxies in Sri
// Lanka frequently break the WebChannel streaming transport Firestore uses by
// default. experimentalAutoDetectLongPolling is meant to cope, but its
// detection probe can itself stall for minutes on those networks — which showed
// up as the login spinner hanging on mobile and then dumping the user back to
// /login when the profile reads finally timed out. Forcing long-polling skips
// the flaky detection round-trip and connects reliably. A service-center app
// doesn't need streaming-latency realtime, so the small efficiency cost is well
// worth the reliability.
const baseSettings: FirestoreSettings = {
  experimentalForceLongPolling: true,
};

// IndexedDB is unavailable in some privacy modes and locked-down WebViews.
// initializeFirestore itself throws there, so fall back to an explicit memory
// cache rather than letting the whole app fail to boot. The fallback costs
// reads, so it should stay the rare exception, not the norm.
function createDb() {
  try {
    return initializeFirestore(app, {
      ...baseSettings,
      localCache: persistentLocalCache({
        tabManager: persistentSingleTabManager({ forceOwnership: true }),
      }),
    });
  } catch (err) {
    console.warn(
      "[firestore] IndexedDB persistence unavailable, falling back to an " +
      "in-memory cache. Reads will not be deduplicated across reloads.",
      err,
    );
    return initializeFirestore(app, {
      ...baseSettings,
      localCache: memoryLocalCache(),
    });
  }
}

export const db = createDb();

export const storage = getStorage(app);
export const functions = getFunctions(app);
