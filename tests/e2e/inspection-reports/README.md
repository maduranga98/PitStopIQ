# Inspection Reports — emulator end-to-end check

Drives the real Inspection Reports pages (list, new report with quick-add, editor,
photos, attachments, offline drafts, technician access, finalize / PDF / reopen) against
the Firebase Auth / Firestore / Storage / **Functions** emulators (the real callables in
`functions/inspectionReports.js`) with the **real `firestore.rules`**. The Storage emulator
uses `open-storage.rules` because its rules runtime can't always be downloaded; the real
`storage.rules` are not exercised here.

Not part of `npm test` and not bundled with the app. `main.tsx` + `mocks/` are a tiny
harness that swaps `src/config/firebase.ts` for an emulator-connected one and
`AuthContext` for a stub.

## Run

```
# one-off, in an empty scratch directory
npm i firebase-tools firebase @firebase/rules-unit-testing playwright-core sharp
cp -r <repo>/tests/e2e/inspection-reports/* .

# terminal 1 (from the repo root)
npx vite --config tests/e2e/inspection-reports/vite.config.ts

# terminal 2 (scratch dir; Chromium from PLAYWRIGHT_BROWSERS_PATH)
npx firebase emulators:exec --project demo-test --only auth,firestore,storage \
  --config firebase.e2e.json "node e2e.mjs"
```

`firebase.e2e.json`: `functions.source` → `<repo>/functions` (relative to that file), Firestore rules → `<repo>/firestore.rules`, Storage rules →
`open-storage.rules`, emulator ports auth 9099 / firestore 8085 / storage 9195.

Notes: run `npm ci` in `functions/` first. If your shell routes traffic through an HTTP
proxy, unset the proxy variables for the emulator run — the Functions emulator talks to its
own runtime over localhost and a proxy answers "request blocked". `pdftotext` and
`pdfimages` (poppler) are used to inspect the generated PDF.
