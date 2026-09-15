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
        }],
      }],
    },
  },
  {
    // The one module allowed to call it: the wrapper itself.
    files: ["src/lib/listeners.ts"],
    rules: { "no-restricted-imports": "off" },
  },
])
