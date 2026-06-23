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

type FirebaseUser = User;
import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import { auth, db } from "../config/firebase";
import type { AuthUser, UserRole } from "../types/auth";

interface AuthContextValue {
  currentUser: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string, rememberMe: boolean) => Promise<void>;
  loginWithGoogle: () => Promise<FirebaseUser>;
  logout: () => Promise<void>;
  sendReset: (email: string) => Promise<void>;
  createAccount: (email: string, password: string) => Promise<string>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const googleProvider = new GoogleAuthProvider();

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Resolve the centerId/role for a signed-in Firebase user. Returns the
  // assembled AuthUser, or null if the user has been removed and signed out.
  async function resolveAuthUser(user: User): Promise<AuthUser | null> {
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

    // Check if the service center has been blocked by a super admin.
    if (centerId) {
      try {
        const centerSnap = await getDoc(doc(db, "servicecenters", centerId));
        if (centerSnap.exists() && centerSnap.data()?.status === "blocked") {
          await signOut(auth);
          return null;
        }
      } catch {
        /* ignore */
      }
    }

    // Verify the staff member is still active. Removed members (active: false)
    // must not be allowed in. Owners (centerId == uid) bypass this check.
    if (centerId && role && role !== "Owner") {
      try {
        const staffSnap = await getDoc(doc(db, "servicecenters", centerId, "staff", user.uid));
        if (!staffSnap.exists() || staffSnap.data()?.active === false) {
          // Member has been removed — sign them out and clear state
          await signOut(auth);
          return null;
        }
      } catch {
        /* ignore on permission error */
      }
    }

    return {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      centerId,
      role,
    };
  }

  // Re-resolve the current user's profile. Used right after onboarding so the
  // freshly-written centerId/role are reflected without a full page reload.
  async function refreshUser() {
    const user = auth.currentUser;
    if (!user) return;
    const resolved = await resolveAuthUser(user);
    setCurrentUser(resolved);
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user: User | null) => {
      if (user) {
        const resolved = await resolveAuthUser(user);
        setCurrentUser(resolved);
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
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
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
    <AuthContext.Provider value={{ currentUser, loading, login, loginWithGoogle, logout, sendReset, createAccount, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
