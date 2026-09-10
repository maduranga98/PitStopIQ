import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { i18nReady } from './i18n'
import App from './App.tsx'

// The entry bundle loaded and executed, so clear the one-shot recovery guard in
// index.html. This lets a later stale-deploy failure trigger a fresh recovery
// reload instead of being suppressed for the rest of the session.
window.sessionStorage.removeItem('pitstopiq:entry-reload')

// Mount once the active language's strings are in memory. English resolves
// immediately (it ships in this bundle); Sinhala and Tamil wait for their own
// chunk, which is what keeps those ~210 KB out of every English user's start-up.
// A failed load still resolves — the app renders in English rather than not at all.
i18nReady.finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
