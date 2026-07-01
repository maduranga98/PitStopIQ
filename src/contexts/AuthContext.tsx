import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  type User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  browserLocalPersistence,
  browserSessionPersistence,
  setPersistence,
  createUserWithEmailAndPassword,
} from "firebase/auth";

import {
  doc, getDoc, setDoc, getDocs, collection, query, where, Timestamp,
} from "firebase/firestore";
import { auth, db } from "../config/firebase";
import type { AuthUser, UserRole, ServiceCenter } from "../types/auth";

interface AuthContextValue {
  currentUser: AuthUser | null;
  loading: boolean;
  // True when the *currently active* branch is blocked — not a global
  // sign-out condition. Other branches the owner has may still be usable.
  centerBlocked: boolean;
  // All branches (primary + additional) the signed-in Owner has. Empty for
  // staff, who are always locked to the single branch they were created in.
  branches: ServiceCenter[];
  // True once we know the Owner has more than one branch and no valid
  // selection has been made yet — the app should show the branch selector.
  needsBranchSelection: boolean;
  switchBranch: (centerId: string) => Promise<void>;
  login: (email: string, password: string, rememberMe: boolean) => Promise<void>;
  logout: () => Promise<void>;
  createAccount: (email: string, password: string) => Promise<string>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function branchStorageKey(uid: string) {
  return `psiq_active_branch_${uid}`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [centerBlocked, setCenterBlocked] = useState(false);
  const [branches, setBranches] = useState<ServiceCenter[]>([]);
  const [needsBranchSelection, setNeedsBranchSelection] = useState(false);

  // A saved, still-valid selection wins; otherwise if there's exactly one
  // branch just use it silently (this is the common single-branch case and
  // must behave identically to before this feature existed).
  function pickEffectiveCenterId(uid: string, ownerBranches: ServiceCenter[]): string | undefined {
    if (ownerBranches.length === 0) return undefined;
    const saved = localStorage.getItem(branchStorageKey(uid));
    if (saved && ownerBranches.some((b) => b.id === saved)) return saved;
    if (ownerBranches.length === 1) return ownerBranches[0].id;
    return undefined;
  }

  // All branches (servicecenters docs) this owner uid has, oldest first so
  // the primary branch — created at registration — sorts to the front.
  async function loadOwnerBranches(uid: string): Promise<ServiceCenter[]> {
    try {
      const snap = await getDocs(
        query(collection(db, "servicecenters"), where("ownerUid", "==", uid)),
      );
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as ServiceCenter))
        .filter((b) => b.isActive !== false)
        .sort((a, b) => {
          const at = (a.createdAt as unknown as Timestamp)?.seconds ?? 0;
          const bt = (b.createdAt as unknown as Timestamp)?.seconds ?? 0;
          return at - bt;
        });
    } catch {
      return [];
    }
  }

  // Plan + blocked status for one specific center document.
  async function resolveCenterFields(centerId: string): Promise<{ plan?: "basic" | "pro"; blocked: boolean }> {
    try {
      const centerSnap = await getDoc(doc(db, "servicecenters", centerId));
      if (!centerSnap.exists()) return { blocked: false };
      const data = centerSnap.data() as { plan?: "basic" | "pro"; status?: string };
      return { plan: data.plan ?? "basic", blocked: data.status === "blocked" };
    } catch {
      return { blocked: false };
    }
  }

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
    let legacyCenterDoc: Record<string, unknown> | undefined;
    if (!centerId || !role) {
      try {
        const centerSnap = await getDoc(doc(db, "servicecenters", user.uid));
        if (centerSnap.exists()) {
          centerId = user.uid;
          role = "Owner";
          legacyCenterDoc = centerSnap.data();
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

    // Self-heal: backfill multi-branch fields onto primary centers that
    // predate this feature, so the ownerUid-based branch query below finds
    // them immediately.
    if (centerId && role === "Owner") {
      try {
        const primaryData =
          legacyCenterDoc ?? (await getDoc(doc(db, "servicecenters", centerId))).data();
        if (primaryData && primaryData.ownerUid === undefined) {
          await setDoc(
            doc(db, "servicecenters", centerId),
            {
              ownerUid: user.uid,
              isBranch: false,
              primaryCenterId: null,
              monthlyRate: primaryData.plan === "pro" ? 7999 : 4999,
              isActive: true,
            },
            { merge: true },
          );
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

    // Owners may have more than one branch (primary + additional, provisioned
    // by the super admin). Staff are always locked to their single branch.
    let ownerBranches: ServiceCenter[] = [];
    let effectiveCenterId = centerId;
    if (centerId && role === "Owner") {
      ownerBranches = await loadOwnerBranches(user.uid);
      if (ownerBranches.length > 0) {
        effectiveCenterId = pickEffectiveCenterId(user.uid, ownerBranches);
      }
    }
    setBranches(ownerBranches);
    setNeedsBranchSelection(role === "Owner" && ownerBranches.length > 1 && !effectiveCenterId);

    let centerPlan: "basic" | "pro" | undefined;
    let blocked = false;
    if (effectiveCenterId) {
      const fields = await resolveCenterFields(effectiveCenterId);
      centerPlan = fields.plan;
      blocked = fields.blocked;
    }
    setCenterBlocked(blocked);

    return {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      centerId: effectiveCenterId,
      role,
      centerPlan,
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

  // Switch which of the owner's branches is active. Persists the choice so
  // it survives reloads, and re-checks plan/blocked state for the new branch.
  async function switchBranch(centerId: string) {
    const user = auth.currentUser;
    if (!user) return;
    localStorage.setItem(branchStorageKey(user.uid), centerId);
    const fields = await resolveCenterFields(centerId);
    setCenterBlocked(fields.blocked);
    setNeedsBranchSelection(false);
    setCurrentUser((prev) => (prev ? { ...prev, centerId, centerPlan: fields.plan } : prev));
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user: User | null) => {
      if (user) {
        const resolved = await resolveAuthUser(user);
        setCurrentUser(resolved);
      } else {
        setCurrentUser(null);
        setBranches([]);
        setNeedsBranchSelection(false);
        setCenterBlocked(false);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  async function login(email: string, password: string, rememberMe: boolean) {
    setCenterBlocked(false);
    await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
    await signInWithEmailAndPassword(auth, email, password);
  }

  async function logout() {
    await signOut(auth);
  }

  async function createAccount(email: string, password: string): Promise<string> {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    return credential.user.uid;
  }

  return (
    <AuthContext.Provider
      value={{
        currentUser, loading, centerBlocked, branches, needsBranchSelection,
        switchBranch, login, logout, createAccount, refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
