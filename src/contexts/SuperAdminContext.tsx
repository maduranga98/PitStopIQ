import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../config/firebase";
import type { SuperAdmin } from "../types/auth";

interface SuperAdminContextValue {
  superAdmin: SuperAdmin | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const SuperAdminContext = createContext<SuperAdminContextValue | null>(null);

export function SuperAdminProvider({ children }: { children: ReactNode }) {
  const [superAdmin, setSuperAdmin] = useState<SuperAdmin | null>(null);
  const [loading, setLoading] = useState(true);

  async function resolveSuperAdmin(user: User): Promise<SuperAdmin | null> {
    try {
      const snap = await getDoc(doc(db, "superadmins", user.uid));
      if (!snap.exists()) return null;
      return { id: user.uid, ...snap.data() } as SuperAdmin;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const resolved = await resolveSuperAdmin(user);
        setSuperAdmin(resolved);
      } else {
        setSuperAdmin(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  async function login(email: string, password: string) {
    await signInWithEmailAndPassword(auth, email, password);
  }

  async function logout() {
    await signOut(auth);
  }

  return (
    <SuperAdminContext.Provider value={{ superAdmin, loading, login, logout }}>
      {children}
    </SuperAdminContext.Provider>
  );
}

export function useSuperAdmin() {
  const ctx = useContext(SuperAdminContext);
  if (!ctx) throw new Error("useSuperAdmin must be used within SuperAdminProvider");
  return ctx;
}
