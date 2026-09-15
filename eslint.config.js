import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Raw onSnapshot has an OPTIONAL error callback, and 21 of this app's 101
      // listeners were written without one. A listener that fails with no error
      // callback throws into the Firestore SDK's own async queue: React never
      // sees it, ErrorBoundary cannot catch it, and the screen just stops
      // updating. That is also how a missing composite index fails silently.
      //
      // watchQuery/watchDoc always attach one, tell a sign-out denial apart from
      // a real fault, and register the listener so sign-out can close it before
      // rules start denying it. See src/lib/listeners.ts.
      "no-restricted-imports": ["error", {
        paths: [{
          name: "firebase/firestore",
          importNames: ["onSnapshot"],
          message:
            "Use watchQuery or watchDoc from src/lib/listeners instead — they always " +
            "attach an error callback and register the listener for teardown on sign-out.",
        }, {
          name: "firebase/firestore",
          // A transaction needs a live server round trip. In an offline-first
          // app that makes it the one call that hangs exactly where everything
          // else keeps working, and writeBatch/commit has the same problem.
          // safeWriteBatch and the safe* helpers commit locally first.
          importNames: ["runTransaction", "writeBatch"],
          message:
            "Client transactions and raw batches resolve only on a server round trip, so " +
            "they hang offline. Use the safe* helpers in src/lib/firestoreWrite (safeWriteBatch " +
            "for multi-document writes). Server-side transactions belong in functions/.",
        }],
      }],
    },
  },
  {
    // The two modules allowed the raw calls: the wrappers themselves.
    files: ["src/lib/listeners.ts", "src/lib/firestoreWrite.ts"],
    rules: { "no-restricted-imports": "off" },
  },
])
