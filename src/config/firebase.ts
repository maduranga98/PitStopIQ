import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
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
// - persistentMultipleTabManager shares the cache across open tabs.
// - experimentalAutoDetectLongPolling falls back to long-polling on
//   networks/proxies where WebChannel streaming is blocked or unstable.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  experimentalAutoDetectLongPolling: true,
});

export const storage = getStorage(app);
export const functions = getFunctions(app);
