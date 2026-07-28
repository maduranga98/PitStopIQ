import { getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { app, db } from "../config/firebase";

// Push alerts for cheques & credit reminders — the whole point is that the
// owner finds out about a cheque going stale without having to open the app.
// A separate service worker (public/firebase-messaging-sw.js) handles the
// message while the app isn't open; sendChequeCreditReminders in
// functions/index.js is what actually sends it, once a day.

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;

export type PushEnableResult = "granted" | "denied" | "unsupported";

function buildServiceWorkerUrl(): string {
  const params = new URLSearchParams({
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "",
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "",
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "",
    appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "",
  });
  return `/firebase-messaging-sw.js?${params.toString()}`;
}

/** Whether this browser can receive web push at all — before asking permission. */
export async function pushNotificationsSupported(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
    return false;
  }
  if (!VAPID_KEY) return false;
  try {
    return await isSupported();
  } catch {
    return false;
  }
}

/**
 * Registers the background service worker, asks for notification permission
 * if this is the first time, and saves the resulting FCM token against the
 * center so the reminder Cloud Function can reach this device. Safe to call
 * repeatedly (e.g. on every branch switch) — once permission is granted it
 * silently re-syncs the token without prompting again.
 */
export async function enablePushNotifications(centerId: string, uid: string): Promise<PushEnableResult> {
  if (!(await pushNotificationsSupported())) return "unsupported";
  if (Notification.permission === "denied") return "denied";

  const registration = await navigator.serviceWorker.register(buildServiceWorkerUrl());
  const permission = Notification.permission === "granted"
    ? "granted"
    : await Notification.requestPermission();
  if (permission !== "granted") return "denied";

  const messaging = getMessaging(app);
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token) return "denied";

  await setDoc(doc(db, "servicecenters", centerId, "pushTokens", token), {
    uid,
    token,
    userAgent: navigator.userAgent,
    updatedAt: serverTimestamp(),
  }, { merge: true });

  // Foreground messages don't surface as a system notification on their
  // own — the tab is visible, so show it through the same registration.
  onMessage(messaging, (payload) => {
    const notification = payload.notification;
    if (!notification) return;
    registration.showNotification(notification.title ?? "PitStopIQ", {
      body: notification.body ?? "",
      icon: "/logo.png",
      data: payload.data,
    });
  });

  return "granted";
}
