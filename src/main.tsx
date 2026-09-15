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

// ── Unhandled promise rejections ──────────────────────────────────────────────
// A rejected promise nobody awaited never reaches React, so ErrorBoundary cannot
// show it and it lands in the console as an unactionable red wall. Most of them
// here are one specific, harmless thing: an in-flight Firestore read or a token
// refresh that was still running when the user signed out. Rules deny it, the
// promise rejects, and there is nobody left to tell — the screen that wanted the
// data is already gone.
//
// Those are logged at info and swallowed. Everything else is a real fault and is
// logged loudly with its code, so it is greppable in a support session rather
// than buried among sign-out noise.
const BENIGN_REJECTION_CODES = new Set([
  'permission-denied',
  'unauthenticated',
  'cancelled',
  'auth/user-token-expired',
  'auth/user-disabled',
  'auth/user-not-found',
  'auth/network-request-failed',
])

function rejectionCode(reason: unknown): string | undefined {
  if (typeof reason === 'object' && reason !== null && 'code' in reason) {
    const code = (reason as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return undefined
}

window.addEventListener('unhandledrejection', (event) => {
  // Cache corruption first: it is the one case that can actually be repaired,
  // and it ends in a reload.
  recoverOnce(event.reason)

  const code = rejectionCode(event.reason)
  if (code && BENIGN_REJECTION_CODES.has(code)) {
    console.info(`[app] ignored a rejection from a signed-out session: ${code}`)
    // Stops the browser printing it as an uncaught error. The promise is dead
    // either way; this only decides whether it shouts on the way out.
    event.preventDefault()
    return
  }
  console.error('[app] unhandled promise rejection:', event.reason)
})

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
