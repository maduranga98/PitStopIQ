import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  type User,
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
import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
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
        let centerId: string | undefined;
        let role: UserRole | undefined;

        // Prefer custom claims if they happen to be set
        try {
          const tokenResult = await user.getIdTokenResult();
          const claims = tokenResult.claims as { centerId?: string; role?: UserRole };
          centerId = claims.centerId;
          role = claims.role;
        } catch {
          /* ignore */
        }

        // Fall back to a Firestore-based user index (works without Cloud Functions)
        if (!centerId || !role) {
          try {
            const userIndex = await getDoc(doc(db, "users", user.uid));
            if (userIndex.exists()) {
              const d = userIndex.data() as { centerId?: string; role?: UserRole };
              centerId = centerId ?? d.centerId;
              role = role ?? d.role;
            }
          } catch {
            /* ignore */
          }
        }

        // Legacy fallback: if this user owns a service center (centerId == uid)
        if (!centerId || !role) {
          try {
            const centerSnap = await getDoc(doc(db, "servicecenters", user.uid));
            if (centerSnap.exists()) {
              centerId = user.uid;
              role = "Owner";
              // Self-heal: write the user index so subsequent loads are fast
              try {
                await setDoc(doc(db, "users", user.uid), {
                  centerId: user.uid,
                  role: "Owner",
                  email: user.email,
                  createdAt: Timestamp.now(),
                });
              } catch {
                /* ignore */
              }
            }
          } catch {
            /* ignore */
          }
        }

        setCurrentUser({
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          centerId,
          role,
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
