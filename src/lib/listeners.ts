// ── Firestore listeners, with the failure path attached ────────────────────────
//
// An onSnapshot call has an optional error callback, and 21 of this app's 101
// listeners were written without one — including seven on DashboardPage, the
// first screen every owner sees. That omission is not cosmetic:
//
//  1. A listener with no error callback that fails throws into the SDK's own
//     async queue. It never reaches React, so ErrorBoundary cannot catch it and
//     the component simply stops updating. The only thing that sees it is the
//     global handler in main.tsx, which is looking for something else entirely.
//
//  2. The most common failure is not a bug, it is sign-out. Security rules stop
//     matching the moment the auth token is dropped, while the route that owns
//     the listener is still mounted — so every open listener fires
//     `permission-denied` at once. That storm is what "the app crashes when you
//     switch accounts" looks like from the counter. It is the expected
//     consequence of signing out, and it should be swallowed, not surfaced.
//
//  3. A missing composite index also reports through the error callback. Three
//     of the seven indexes this app is missing are on listeners that had no
//     error callback, so they fail in total silence today.
//
// So: one place that always attaches an error callback, tells those three cases
// apart, and keeps a registry of live listeners so sign-out can close them
// deliberately instead of racing React's unmount.
//
// Everything here returns the same Unsubscribe that onSnapshot returns, so a
// caller can keep doing `return watchQuery(...)` straight out of a useEffect.
import {
  onSnapshot,
  type DocumentReference,
  type DocumentSnapshot,
  type Query,
  type QuerySnapshot,
  type DocumentData,
  type FirestoreError,
  type Unsubscribe,
} from "firebase/firestore";
import { auth } from "../config/firebase";

/**
 * Error codes that CAN mean "you are signed out" rather than "something is
 * broken". Which one it is depends on whether anybody is actually signing out
 * — see isSignedOut() below, and the note on `signingOut`.
 *
 * Firestore raises these on every open listener the moment the token goes. In
 * that case they are logged at info level and swallowed: there is no user to
 * tell, and the screen holding the listener is already on its way out. With a
 * token still in hand they mean the opposite — a rules rejection — and they go
 * through the failure path like anything else.
 */
const BENIGN_CODES = new Set(["permission-denied", "unauthenticated"]);

/**
 * Set between the decision to sign out and Auth actually dropping the token.
 *
 * That window is the one place a `permission-denied` is expected while
 * `auth.currentUser` is still set, so it is the only thing that can tell those
 * denials apart from a rules bug. Cleared again by the next listener opened on
 * a live session (see register) — after a sign-out that stays on the same
 * document, such as the removed-staff path in AuthContext, the next sign-in
 * must not inherit a flag that hides real failures.
 */
let signingOut = false;

/** Is a `permission-denied` here the expected consequence of signing out? */
function isSignedOut(): boolean {
  return signingOut || auth.currentUser === null;
}

/**
 * Detach every listener, and mark the sign-out that is about to follow.
 *
 * Call this immediately BEFORE `signOut(auth)` on every path that drops the
 * token — not just the deliberate one in session.ts. A bare `signOut(auth)`
 * with screens still mounted denies every listener at once, which is the
 * console flood of "closed by sign-out: permission-denied" this exists to
 * prevent.
 */
export function closeListenersForSignOut(): void {
  signingOut = true;
  clearAllListeners();
}

/**
 * The third argument may be a plain error callback, exactly where onSnapshot
 * takes one. That keeps these a drop-in replacement at all 101 call sites — a
 * migration that forces every caller to change shape is a migration that
 * introduces bugs. Pass the object form when you want a label too.
 */
export type WatchErrorHandler = (err: FirestoreError) => void;

export interface WatchOptions {
  /**
   * Where this listener lives, for the console. Worth setting on anything that
   * loads a screen — "DashboardPage:jobs" in a log line is the difference
   * between a five-minute and a fifty-minute diagnosis.
   */
  label?: string;
  /**
   * Called for real failures only; benign sign-out codes never reach it. Use it
   * to clear a loading flag or show a message — the listener is dead either way,
   * Firestore does not retry after an error.
   */
  onError?: (err: FirestoreError) => void;
}

// Every live unsubscribe, so clearAllListeners() can close them all. A Set
// because the same unsubscribe must never be stored twice, and removal on
// normal teardown has to be cheap.
const live = new Set<Unsubscribe>();

/** How many listeners are currently open. Diagnostics only. */
export function liveListenerCount(): number {
  return live.size;
}

/**
 * Detach every listener this module opened.
 *
 * Called on sign-out, BEFORE the auth token is dropped, so that rules never get
 * the chance to deny a listener that is still open. Firestore's unsubscribe is
 * idempotent, so a component that later unmounts and calls its own unsubscribe
 * is harmless.
 *
 * One listener throwing must not prevent the rest from being closed, hence the
 * per-item try.
 */
export function clearAllListeners(): void {
  for (const unsub of [...live]) {
    try {
      unsub();
    } catch (err) {
      console.warn("[listeners] failed to detach a listener during teardown:", err);
    }
  }
  live.clear();
}

/**
 * Shared plumbing: register the unsubscribe, hand back a wrapped one that
 * deregisters, and route errors through the benign/real split.
 */
function register(
  attach: (onError: WatchErrorHandler) => Unsubscribe,
  opts: WatchOptions | WatchErrorHandler,
): Unsubscribe {
  const { label, onError } = typeof opts === "function" ? { label: undefined, onError: opts } : opts;
  const where = label ? ` (${label})` : "";

  // Declared before `attach` runs: onSnapshot can invoke the error callback
  // synchronously, and `unsub` would not be assigned yet if we captured it
  // directly. Going through the box keeps that case safe.
  const box: { unsub?: Unsubscribe } = {};

  const handleError = (err: FirestoreError) => {
    // The listener is finished either way — Firestore does not re-attach after
    // an error — so drop it from the registry before anything else.
    if (box.unsub) live.delete(box.unsub);

    if (BENIGN_CODES.has(err.code) && isSignedOut()) {
      console.info(`[listeners] closed by sign-out${where}: ${err.code}`);
      return;
    }
    // A permission-denied while the user is still signed in is NOT sign-out,
    // whatever it looks like: it is a rules rejection, and swallowing it is
    // how a screen ends up silently empty forever. Report it like any other
    // failure so the caller can stop its spinner and say something.
    console.error(`[listeners] listener failed${where}:`, err);
    if (onError) onError(err);
  };

  // Opening a listener with a live token means the session is live again, so
  // any sign-out we were mid-way through is over. Without this, a sign-out
  // that lands back on /login inside the same document would leave every
  // later rules failure mislabelled as sign-out for the rest of the tab.
  if (auth.currentUser !== null) signingOut = false;

  const raw = attach(handleError);
  const unsub: Unsubscribe = () => {
    live.delete(unsub);
    raw();
  };
  box.unsub = unsub;
  live.add(unsub);
  return unsub;
}

/**
 * onSnapshot for a query, with the error path attached and the listener
 * registered. Drop-in for `onSnapshot(q, cb)`.
 */
export function watchQuery<T = DocumentData>(
  q: Query<T>,
  onData: (snap: QuerySnapshot<T>) => void,
  options: WatchOptions | WatchErrorHandler = {},
): Unsubscribe {
  return register(
    (handleError) => onSnapshot(q, onData, handleError),
    options,
  );
}

/**
 * onSnapshot for a single document, with the error path attached and the
 * listener registered. Drop-in for `onSnapshot(ref, cb)`.
 */
export function watchDoc<T = DocumentData>(
  ref: DocumentReference<T>,
  onData: (snap: DocumentSnapshot<T>) => void,
  options: WatchOptions | WatchErrorHandler = {},
): Unsubscribe {
  return register(
    (handleError) => onSnapshot(ref, onData, handleError),
    options,
  );
}
