import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { initializeFirestore, connectFirestoreEmulator, persistentLocalCache, persistentSingleTabManager } from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { getFunctions } from "firebase/functions";
export const app = initializeApp({ projectId: "demo-test", apiKey: "x", appId: "x", storageBucket: "demo-test.appspot.com", authDomain: "demo-test.firebaseapp.com" });
export const auth = getAuth(app);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
export const db = initializeFirestore(app, { experimentalForceLongPolling: true, localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({ forceOwnership: true }) }) });
connectFirestoreEmulator(db, "127.0.0.1", 8085);
export const storage = getStorage(app);
connectStorageEmulator(storage, "127.0.0.1", 9195);
export const functions = getFunctions(app);
export const persistenceAvailable = true;
export async function recoverFromCorruptedCache() {}
