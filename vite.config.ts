import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      devOptions: { enabled: true },
      manifest: {
        name: "PitstopIQ",
        short_name: "PitstopIQ",
        description: "Vehicle Service Center Management",
        theme_color: "#0B1120",
        background_color: "#0B1120",
        display: "standalone",
        orientation: "portrait-primary",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/pwa-192x192.svg", sizes: "192x192", type: "image/svg+xml", purpose: "maskable" },
          { src: "/pwa-512x512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        // Precache the SHELL ONLY — index.html, the entry bundle, the shared
        // vendor chunks and the stylesheet.
        //
        // It used to be every built file: ~180 entries and 3.3 MB, which the
        // service worker downloads in one burst the moment it installs. On a
        // mid-range Android phone on mobile data that burst competes with the
        // very page load that registered it (the analytics chunk with its chart
        // library, the spreadsheet importer, every route the user will never
        // open), and if any single request in it fails the whole install fails
        // and starts over on the next visit — which is what "the app is slow /
        // won't load" looks like from the counter.
        //
        // Route chunks are cached as they are actually visited instead, by the
        // /assets/ runtime rule below. They are content-hashed, so serving one
        // from the cache is always correct.
        // Exactly the files needed to get the app on screen: the HTML, the
        // stylesheet, the entry bundle and the chunks it statically imports
        // (the module runtime, the React/i18n vendor chunks and the Firebase
        // SDKs). ~1 MB, so an installed PWA still cold-starts offline against
        // its Firestore cache — while the ~2.5 MB of route chunks nobody has
        // opened yet is left to the /assets/ runtime rule below.
        globPatterns: [
          "index.html",
          "manifest.webmanifest",
          "assets/index-*.{js,css}",
          "assets/vendor-*.js",
          "assets/rolldown-runtime-*.js",
          "assets/firebase-*.js",
          "assets/index.esm-*.js",
        ],
        // Its own service worker, registered separately with a per-environment
        // query string (see src/lib/pushNotifications.ts) — precaching it here
        // would just be a stale, query-less copy the registration never uses.
        globIgnores: ["firebase-messaging-sw.js"],
        // Take over and drop the previous version's precache as soon as a new
        // service worker is available, so stale hashed chunks referenced by an
        // old index.html can't keep being served after a deploy.
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: "/index.html",
        // Never answer a request for a hashed asset with the index.html shell —
        // that HTML response is what triggers the "text/html" module MIME error.
        // Missing assets should fall through to the network (and a real 404).
        navigateFallbackDenylist: [/^\/assets\//, /\.[a-z0-9]+$/i],
        runtimeCaching: [
          {
            // Hashed route chunks: immutable, so cache-first with no
            // revalidation. A chunk is fetched once, on the first visit to the
            // page that needs it, and is instant (and offline-safe) after that.
            // The entry limit keeps a few deploys' worth and no more.
            urlPattern: ({ url, sameOrigin }) =>
              !!sameOrigin && url.pathname.startsWith("/assets/"),
            handler: "CacheFirst",
            options: {
              cacheName: "app-chunks",
              expiration: {
                maxEntries: 220,
                maxAgeSeconds: 60 * 60 * 24 * 30,
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts-stylesheets" },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "images",
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            urlPattern: /^https:\/\/.*\.firebaseapp\.com\/.*/i,
            handler: "NetworkOnly",
          },
          {
            urlPattern: /^https:\/\/.*\.googleapis\.com\/(?!fonts).*/i,
            handler: "NetworkOnly",
          },
          {
            urlPattern: /^https:\/\/.*\.cloudfunctions\.net\/.*/i,
            handler: "NetworkOnly",
          },
          {
            urlPattern: /^https:\/\/firestore\.googleapis\.com\/.*/i,
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // Split the libraries that never change out of the app bundle. Before
        // this, every deploy handed each phone a fresh ~650 KB entry chunk
        // because React and the router were bundled into it; now an app update
        // re-downloads only the small app shell and the vendor chunks stay in
        // the cache. The names are stable ("vendor-react-<hash>.js"), which is
        // what lets the precache glob above pick them up.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id)) {
            return "vendor-react";
          }
          if (/[\\/]node_modules[\\/](i18next|react-i18next)[\\/]/.test(id)) {
            return "vendor-i18n";
          }
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
