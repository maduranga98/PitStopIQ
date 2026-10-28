import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { doc } from "firebase/firestore";
import { boundedGetDoc } from "../lib/firestoreRead";
import { auth, db } from "../config/firebase";
import { signOutSafely } from "../lib/session";
import { closeListenersForSignOut, watchDoc } from "../lib/listeners";
import { CallerAuthError } from "../lib/callerAuth";
import type { Caller } from "../types/auth";

interface CallerContextValue {
  caller: Caller | null;
  loading: boolean;
  /** Set when a signed-in caller was switched off; the login page explains it. */
  notice: "deactivated" | null;
  clearNotice: () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Always resolves the same way for an unknown email, so it can't be used to probe accounts. */
  resetPassword: (email: string) => Promise<void>;
}

const CallerContext = createContext<CallerContextValue | null>(null);

type Resolution =
  | { kind: "caller"; caller: Caller }
  | { kind: "inactive" }
  | { kind: "none" };

async function resolveCaller(user: User): Promise<Resolution> {
  try {
    const snap = await boundedGetDoc(doc(db, "callers", user.uid));
    if (!snap.exists()) return { kind: "none" };
    const caller = { id: user.uid, ...snap.data() } as Caller;
    return caller.isActive === true ? { kind: "caller", caller } : { kind: "inactive" };
  } catch {
    return { kind: "none" };
  }
}

export function CallerProvider({ children }: { children: ReactNode }) {
  const [caller, setCaller] = useState<Caller | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<"deactivated" | null>(null);
  const stopWatching = useRef<(() => void) | null>(null);

  // A caller whose account was switched off is signed out. Listeners first,
  // token second — see lib/session.ts. No page reload here, so the notice
  // survives to the login screen.
  async function endSession() {
    stopWatching.current?.();
    stopWatching.current = null;
    closeListenersForSignOut();
    setCaller(null);
    setNotice("deactivated");
    try {
      await signOut(auth);
    } catch (err) {
      console.error("[caller] sign-out after deactivation failed:", err);
    }
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      stopWatching.current?.();
      stopWatching.current = null;

      if (!user) {
        setCaller(null);
        setLoading(false);
        return;
      }

      const resolved = await resolveCaller(user);
      if (resolved.kind === "caller") {
        setCaller(resolved.caller);
        // Deactivating a caller takes effect while they are signed in: the rules
        // already cut off their data, this stops them staring at permission
        // errors until they reload.
        stopWatching.current = watchDoc(
          doc(db, "callers", user.uid),
          (snap) => {
            if (!snap.exists() || (snap.data() as Caller).isActive !== true) {
              void endSession();
            } else {
              setCaller({ id: user.uid, ...snap.data() } as Caller);
            }
          },
          { label: "CallerContext:self" },
        );
      } else if (resolved.kind === "inactive") {
        await endSession();
      } else {
        // Signed in as someone who is not a caller (a super admin who wandered
        // here). Not ours to sign out — login() does that for a fresh sign-in.
        setCaller(null);
      }
      setLoading(false);
    });
    return () => {
      unsubscribe();
      stopWatching.current?.();
    };
  }, []);

  async function login(email: string, password: string) {
    setNotice(null);
    const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
    const resolved = await resolveCaller(credential.user);
    if (resolved.kind === "caller") return;

    closeListenersForSignOut();
    await signOut(auth);
    throw new CallerAuthError(resolved.kind === "inactive" ? "deactivated" : "not-a-caller");
  }

  async function logout() {
    await signOutSafely("/caller/login");
  }

  async function resetPassword(email: string) {
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "auth/user-not-found" || code === "auth/invalid-email") return;
      throw err;
    }
  }

  return (
    <CallerContext.Provider
      value={{ caller, loading, notice, clearNotice: () => setNotice(null), login, logout, resetPassword }}
    >
      {children}
    </CallerContext.Provider>
  );
}

export function useCaller() {
  const ctx = useContext(CallerContext);
  if (!ctx) throw new Error("useCaller must be used within CallerProvider");
  return ctx;
}
