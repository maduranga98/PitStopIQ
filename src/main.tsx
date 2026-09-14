import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { i18nReady } from './i18n'
import { recoverFromCorruptedCache } from './config/firebase'
import App from './App.tsx'

// The entry bundle loaded and executed, so clear the one-shot recovery guard in
// index.html. This lets a later stale-deploy failure trigger a fresh recovery
// reload instead of being suppressed for the rest of the session.
window.sessionStorage.removeItem('pitstopiq:entry-reload')

// ── Corrupted Firestore cache: global safety net ──────────────────────────────
// ErrorBoundary catches this crash when it surfaces during a render pass, but
// the SDK throws it from its own internal async queue — a background snapshot
// listener failing while the user is idle never reaches React at all. These two
// listeners catch that case. They share the one-shot guard key with
// ErrorBoundary.tsx, so whichever sees the error first is the only one that
// reloads.
const RECOVERY_GUARD_KEY = 'pitstopiq:cache-recovery-attempted'

function isFirestoreCacheCorruption(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  return msg.includes('INTERNAL ASSERTION FAILED') && msg.includes('Unexpected state')
}

function recoverOnce(err: unknown): void {
  if (!isFirestoreCacheCorruption(err)) return
  try {
    if (window.sessionStorage.getItem(RECOVERY_GUARD_KEY) === '1') return
    window.sessionStorage.setItem(RECOVERY_GUARD_KEY, '1')
  } catch {
    // sessionStorage unavailable (private mode / blocked storage). Without a
    // working guard a reload could loop, so leave recovery to the manual
    // "Fix & Reload" button in ErrorBoundary.
    return
  }
  // Not awaited: it ends in a full page reload.
  void recoverFromCorruptedCache()
}

window.addEventListener('error', (event) => recoverOnce(event.error ?? event.message))
window.addEventListener('unhandledrejection', (event) => recoverOnce(event.reason))

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
