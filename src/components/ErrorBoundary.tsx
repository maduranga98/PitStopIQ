import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { recoverFromCorruptedCache } from "../config/firebase";

/**
 * A failed code-split chunk fetch ("Failed to fetch dynamically imported
 * module", "Importing a module script failed", "error loading dynamically
 * imported module"). These happen when a tab holds an old index.html after a
 * new deploy and the referenced chunk hash no longer exists. Re-rendering the
 * same component can never recover it — only a fresh page load that pulls the
 * new chunk manifest can — so the fallback offers a reload instead of a reset.
 */
function isChunkLoadError(error: Error): boolean {
  const msg = `${error?.name ?? ""} ${error?.message ?? ""}`.toLowerCase();
  return (
    msg.includes("dynamically imported module") ||
    msg.includes("importing a module script failed") ||
    msg.includes("error loading dynamically imported module") ||
    msg.includes("failed to fetch dynamically imported")
  );
}

/**
 * "FIRESTORE INTERNAL ASSERTION FAILED: Unexpected state" — the SDK's own
 * signal that its IndexedDB cache is inconsistent (see recoverFromCorruptedCache
 * in config/firebase.ts). Every subsequent read throws, including the profile
 * getDoc() right after login, so re-rendering loops forever; only clearing the
 * local cache recovers it.
 */
function isFirestoreCacheCorruption(error: Error): boolean {
  const msg = error?.message ?? "";
  return msg.includes("INTERNAL ASSERTION FAILED") && msg.includes("Unexpected state");
}

/**
 * One-shot guard, shared with the global handlers in main.tsx so the two can
 * never both fire a reload. If the same crash comes back after one automatic
 * recovery, clearing the cache is not what is wrong — stop auto-reloading and
 * show the user a button instead of spinning.
 */
const RECOVERY_GUARD_KEY = "pitstopiq:cache-recovery-attempted";

function recoveryAlreadyAttempted(): boolean {
  try {
    return window.sessionStorage.getItem(RECOVERY_GUARD_KEY) === "1";
  } catch {
    // sessionStorage unavailable (private mode / blocked storage). Treat it as
    // "already attempted" so a broken guard can never drive a reload loop.
    return true;
  }
}

function markRecoveryAttempted(): void {
  try {
    window.sessionStorage.setItem(RECOVERY_GUARD_KEY, "1");
  } catch {
    // ignored — see above.
  }
}

/**
 * Reload the page to pick up the freshly deployed chunk manifest. Clears the
 * once-per-session guard set by lazyWithRetry so this manual reload is never
 * suppressed, and best-effort tells any updated service worker to take over so
 * the reload is served the new index.html rather than the stale cached copy.
 */
function reloadForNewBuild(): void {
  try {
    window.sessionStorage.removeItem("pitstopiq:chunk-reload");
  } catch {
    // sessionStorage can be unavailable (private mode / blocked storage);
    // the reload below still recovers the common case.
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.update())))
      .catch(() => {})
      .finally(() => window.location.reload());
    return;
  }
  window.location.reload();
}

/**
 * A short code the owner can read down the phone or paste into WhatsApp.
 *
 * Two halves, both deliberate: the first four characters hash the error itself,
 * so the same fault always produces the same half and support can tell "it
 * happened again" from "something new broke"; the last three are the time, so
 * one owner reporting it twice gives two distinguishable codes that can be
 * matched against the logs. Crockford-style alphabet — no I, L, O or U — because
 * this gets read aloud in a noisy workshop.
 */
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function base32(n: number, length: number): string {
  let out = "";
  let v = Math.abs(Math.trunc(n));
  for (let i = 0; i < length; i++) {
    out = CODE_ALPHABET[v % CODE_ALPHABET.length] + out;
    v = Math.floor(v / CODE_ALPHABET.length);
  }
  return out;
}

function referenceCode(error: Error): string {
  const text = `${error?.name ?? ""}:${error?.message ?? ""}`;
  // djb2 — not cryptographic, and does not need to be. It only has to be stable
  // for the same message and spread different messages apart.
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return `PIQ-${base32(hash, 4)}-${base32(Math.floor(Date.now() / 1000), 3)}`;
}

/** Support channel shown on the recovery screen. */
const SUPPORT_WHATSAPP = "071 110 0800";

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
  label?: string;
}

interface State {
  error: Error | null;
  errorInfo: ErrorInfo | null;
  recovering: boolean;
  /** Generated once per crash so it stays stable while the screen is open. */
  reference: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null, recovering: false, reference: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error, reference: referenceCode(error) };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    // eslint-disable-next-line no-console
    console.error(
      `[ErrorBoundary${this.props.label ? ` · ${this.props.label}` : ""}] ${this.state.reference ?? ""}`,
      error,
      errorInfo,
    );

    // Corrupted local cache: fix it automatically, once. Most users should
    // never see an error screen for this at all — just a brief pause.
    if (isFirestoreCacheCorruption(error) && !recoveryAlreadyAttempted()) {
      markRecoveryAttempted();
      this.setState({ recovering: true });
      // Not awaited: it ends in a full page reload, so there is nothing to
      // resume here.
      void recoverFromCorruptedCache();
    }
  }

  reset = () => this.setState({ error: null, errorInfo: null, recovering: false, reference: null });

  fixCacheAndReload = () => {
    this.setState({ recovering: true });
    void recoverFromCorruptedCache();
  };

  render() {
    const { error, errorInfo, recovering, reference } = this.state;
    if (!error) return this.props.children;

    const cacheCorruption = isFirestoreCacheCorruption(error);

    // Automatic recovery is in flight and ends in a reload — show a pause, not
    // a crash the user has to act on.
    if (cacheCorruption && recovering) {
      return (
        <div className="min-h-screen bg-[#0B1120] flex items-center justify-center p-6">
          <div className="w-10 h-10 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      );
    }

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    // Stale-chunk crashes can only be fixed by a fresh load, so "Try again"
    // reloads (fetching the new build) instead of re-rendering the same crash.
    const chunkError = isChunkLoadError(error);

    return (
      <div className="min-h-screen bg-[#0B1120] text-white flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-[#162032] border border-red-500/30 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0" />
            <h2 className="font-semibold text-white text-lg">Something went wrong</h2>
          </div>
          {this.props.label && (
            <p className="text-xs text-gray-500 uppercase tracking-wider">
              {this.props.label}
            </p>
          )}
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-sm text-red-300 break-words">
            <div className="font-medium">{error.name}: {error.message}</div>
          </div>
          {chunkError && (
            <p className="text-sm text-gray-400">
              A new version of the app was released. Reload to load the latest version.
            </p>
          )}
          {cacheCorruption && (
            <p className="text-sm text-gray-400">
              This can happen on some Android tablets. Your data is safe on our servers —
              tap below and it fixes itself in a few seconds.
            </p>
          )}
          {/* The first thing an owner needs to know is that they have not lost the
              job card they just saved. Writes are committed locally the moment
              they are made (see lib/firestoreWrite.ts), so this is true even if
              the crash happened mid-sync. */}
          <p className="text-sm text-gray-300">
            Your saved work is safe. Anything already entered is stored on this device
            and will sync on its own.
          </p>
          {reference && (
            <div className="bg-black/30 border border-white/10 rounded-lg px-3 py-2">
              <p className="text-xs text-gray-500 mb-1">
                Reference code — send this to WhatsApp {SUPPORT_WHATSAPP} if it keeps happening
              </p>
              <p className="text-sm font-mono text-white tracking-wider">{reference}</p>
            </div>
          )}
          {errorInfo?.componentStack && (
            <details className="text-xs text-gray-400">
              <summary className="cursor-pointer hover:text-white">Stack trace</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words bg-black/30 p-2 rounded text-[11px] max-h-64 overflow-auto">
                {error.stack}
                {"\n\nComponent stack:"}
                {errorInfo.componentStack}
              </pre>
            </details>
          )}
          <div className="flex gap-2">
            <button
              onClick={
                cacheCorruption
                  ? this.fixCacheAndReload
                  : chunkError
                    ? reloadForNewBuild
                    : this.reset
              }
              className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-2 rounded-lg text-sm font-medium"
            >
              {cacheCorruption ? "Fix & Reload" : chunkError ? "Reload" : "Try again"}
            </button>
            <button
              onClick={() => window.location.assign("/")}
              className="flex-1 bg-white/10 hover:bg-white/20 text-white py-2 rounded-lg text-sm"
            >
              Go home
            </button>
          </div>
        </div>
      </div>
    );
  }
}
