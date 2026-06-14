import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import {
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  sendPasswordResetEmail,
  browserLocalPersistence,
  browserSessionPersistence,
  setPersistence,
  createUserWithEmailAndPassword,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../config/firebase";
import type { AuthUser, UserRole } from "../types/auth";

interface AuthContextValue {
  currentUser: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string, rememberMe: boolean) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  sendReset: (email: string) => Promise<void>;
  createAccount: (email: string, password: string) => Promise<string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const googleProvider = new GoogleAuthProvider();

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user: User | null) => {
      if (user) {
        const tokenResult = await user.getIdTokenResult();
        const claims = tokenResult.claims as { centerId?: string; role?: UserRole };
        setCurrentUser({
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          centerId: claims.centerId,
          role: claims.role,
        });
      } else {
        setCurrentUser(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  async function login(email: string, password: string, rememberMe: boolean) {
    await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
    await signInWithEmailAndPassword(auth, email, password);
  }

  async function loginWithGoogle() {
    await signInWithPopup(auth, googleProvider);
  }

  async function logout() {
    await signOut(auth);
  }

  async function sendReset(email: string) {
    await sendPasswordResetEmail(auth, email);
  }

  async function createAccount(email: string, password: string): Promise<string> {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    return credential.user.uid;
  }

  return (
    <AuthContext.Provider value={{ currentUser, loading, login, loginWithGoogle, logout, sendReset, createAccount }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
