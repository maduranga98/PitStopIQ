// Background push handler for PitStopIQ, registered separately from the
// Workbox-generated app shell (sw.js). A push event is delivered to whichever
// service worker registration owns the subscription — not by URL scope — so
// this can stay a small, standalone worker without touching the app's own
// asset caching.
//
// The Firebase web config isn't secret (it ships inside the app bundle too),
// but it does vary per environment. Rather than hardcode it here, the page
// registers this file with the config passed as query params — see
// src/lib/pushNotifications.ts — and we read them back below.

importScripts("https://www.gstatic.com/firebasejs/12.14.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.14.0/firebase-messaging-compat.js");

const params = new URL(self.location.href).searchParams;

firebase.initializeApp({
  apiKey: params.get("apiKey"),
  authDomain: params.get("authDomain"),
  projectId: params.get("projectId"),
  storageBucket: params.get("storageBucket"),
  messagingSenderId: params.get("messagingSenderId"),
  appId: params.get("appId"),
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const notification = payload.notification || {};
  const data = payload.data || {};
  self.registration.showNotification(notification.title || "PitStopIQ", {
    body: notification.body || "",
    icon: "/logo.png",
    badge: "/logo.png",
    tag: data.tag || "pitstopiq-reminder",
    data,
  });
});

// Tapping the notification focuses an already-open tab (navigating it to the
// target page) or opens a new one — the alert is only useful if it can get
// the owner back into the app.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/cheques";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          if ("navigate" in client) client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
