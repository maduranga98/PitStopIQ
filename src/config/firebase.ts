import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
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

// Offline-first Firestore for unreliable connections:
// - persistentLocalCache keeps all previously-read data in IndexedDB, so
//   pages render instantly from cache and keep working through drops;
//   writes made while offline are queued and synced when back online.
// - persistentSingleTabManager (NOT the multi-tab manager): the multi-tab
//   manager coordinates open tabs through a "primary lease" stored in
//   IndexedDB, where one client owns the network connection and the others
//   proxy through it. On mobile the OS freezes and kills backgrounded tabs
//   (and the installed PWA) without releasing that lease, so a fresh session
//   finds a stale lease it can never acquire. With no client able to become
//   primary the network listen never starts and every read hangs, which is
//   what stalled login on mobile with "Failed to obtain primary lease for
//   action 'maybeGarbageCollectMultiClientState'" logged every few seconds.
//   The single-tab manager keeps the offline cache but never runs that
//   cross-tab election, so it cannot get stuck on a stale lease.
// - forceOwnership: true — the single-tab manager still guards the IndexedDB
//   persistence layer with an exclusive lock, and mobile OSes freeze and kill
//   the backgrounded PWA/tab without releasing it. A fresh session then finds
//   that stale lock, fails to "obtain exclusive access to the persistence
//   layer", and silently falls back to an in-memory cache — losing the
//   offline-first behaviour above. forceOwnership makes the new session
//   forcibly reclaim the persistence layer (the modern equivalent of the old
//   experimentalForceOwningTab flag) instead of degrading to memory. This is
//   safe here because the app is single-tab by design; if the user really does
//   open a second tab, the newest one takes ownership rather than both stalling.
// - experimentalForceLongPolling: mobile networks and carrier proxies in Sri
//   Lanka frequently break the WebChannel streaming transport Firestore uses
//   by default. experimentalAutoDetectLongPolling is meant to cope, but its
//   detection probe can itself stall for minutes on those networks — which
//   showed up as the login spinner hanging on mobile and then dumping the user
//   back to /login when the profile reads finally timed out. Forcing
//   long-polling skips the flaky detection round-trip and connects reliably.
//   A service-center app doesn't need streaming-latency realtime, so the small
//   efficiency cost is well worth the reliability.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentSingleTabManager({ forceOwnership: true }),
  }),
  experimentalForceLongPolling: true,
});

export const storage = getStorage(app);
export const functions = getFunctions(app);
