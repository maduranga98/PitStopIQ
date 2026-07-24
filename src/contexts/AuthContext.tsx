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
  type DocumentReference, type DocumentData, type DocumentSnapshot,
} from "firebase/firestore";
import { auth, db } from "../config/firebase";
import type { AuthUser, UserRole, ServiceCenter } from "../types/auth";

interface AuthContextValue {
  currentUser: AuthUser | null;
  loading: boolean;
  // True from the moment login() is called until the freshly signed-in
  // user's role/branch/plan data has finished resolving. Covers the gap
  // between the credential check succeeding and onAuthStateChanged's async
  // Firestore lookups completing, during which currentUser is still null.
  authenticating: boolean;
  // Set when the user is genuinely signed in with Firebase but their profile
  // (centerId/role) could not be read because a Firestore read failed on the
  // network after retries. This is NOT a login failure — the Firebase session
  // is still valid — so the route guards must show a retry affordance rather
  // than bounce the user back to the login form.
  profileError: boolean;
  // Re-run the profile resolution for the still-signed-in user. Wired to the
  // "Try again" button shown when profileError is true.
  retryProfileLoad: () => Promise<void>;
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

function profileCacheKey(uid: string) {
  return `psiq_profile_cache_${uid}`;
}

// Signalled when a Firestore read the profile genuinely depends on fails on
// the network after our retries are exhausted. Distinct from a document that
// simply doesn't exist (a real "not onboarded yet" state) and from a
// permission error (a real access decision) — only a transient read failure
// throws this, so the caller can show a retry screen instead of fabricating
// an empty profile that looks like a failed login.
export class ProfileResolutionError extends Error {
  readonly cause?: unknown;
  constructor(cause?: unknown) {
    super("Couldn't load your profile. Check your connection and try again.");
    this.name = "ProfileResolutionError";
    this.cause = cause;
  }
}

// permission-denied is a genuine access decision, not a network blip — treat
// it like an absent document (fall through) rather than a retryable failure.
function isPermissionError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "permission-denied"
  );
}

// The identity reads on sign-in decide which center (if any) the user belongs
// to. On flaky mobile connections a single dropped read used to leave centerId
// undefined, which silently bounced the freshly-authenticated user straight
// back to /login. Retry a few times with a short backoff so a transient blip
// doesn't cost the whole session; a genuine failure after all attempts is
// surfaced to the caller (which turns it into a retry screen), never swallowed.
async function getDocWithRetry(
  ref: DocumentReference<DocumentData>,
  attempts = 3,
): Promise<DocumentSnapshot<DocumentData>> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await getDoc(ref);
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 400 * (i + 1)));
      }
    }
  }
  throw lastErr;
}

// A read that either returns the snapshot or classifies why it couldn't.
// `netErr` marks a transient/network failure worth surfacing as a retry;
// a permission-denied resolves to neither (treated as "no document").
type SafeRead = { snap?: DocumentSnapshot<DocumentData>; netErr?: unknown };

async function safeGet(ref: DocumentReference<DocumentData>): Promise<SafeRead> {
  try {
    return { snap: await getDocWithRetry(ref) };
  } catch (err) {
    if (isPermissionError(err)) return {};
    return { netErr: err };
  }
}

// The assembled profile plus the derived branch/plan/blocked state, returned
// together so callers can push it into React state and the cache in one go.
interface ResolvedProfile {
  user: AuthUser;
  branches: ServiceCenter[];
  needsBranchSelection: boolean;
  centerBlocked: boolean;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState(false);
  const [centerBlocked, setCenterBlocked] = useState(false);
  const [branches, setBranches] = useState<ServiceCenter[]>([]);
  const [needsBranchSelection, setNeedsBranchSelection] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);

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

  // Stale-while-revalidate cache. On an app reopen the Firebase session
  // restores synchronously but the profile read waterfall does not, which used
  // to mean a full-screen spinner every launch. Painting the last-known
  // profile immediately lets routes resolve instantly while the real read runs
  // in the background and corrects anything that changed.
  function readProfileCache(uid: string): { user: AuthUser; centerBlocked: boolean } | null {
    try {
      const raw = localStorage.getItem(profileCacheKey(uid));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { user?: AuthUser; centerBlocked?: boolean };
      if (!parsed.user || parsed.user.uid !== uid) return null;
      return { user: parsed.user, centerBlocked: parsed.centerBlocked ?? false };
    } catch {
      return null;
    }
  }

  function writeProfileCache(uid: string, resolved: ResolvedProfile) {
    // Only cache a fully-decided profile. A multi-branch owner still waiting to
    // pick a branch must not be instant-painted onto a branch, so skip those.
    if (resolved.needsBranchSelection) {
      clearProfileCache(uid);
      return;
    }
    try {
      localStorage.setItem(
        profileCacheKey(uid),
        JSON.stringify({ user: resolved.user, centerBlocked: resolved.centerBlocked }),
      );
    } catch {
      /* ignore — cache is best-effort */
    }
  }

  function clearProfileCache(uid: string) {
    try {
      localStorage.removeItem(profileCacheKey(uid));
    } catch {
      /* ignore */
    }
  }

  // All branches (servicecenters docs) this owner uid has, oldest first so
  // the primary branch — created at registration — sorts to the front.
  // Legacy primary centers (doc id == uid) may lack ownerUid because
  // Firestore rules prevent owners from writing that field — the self-heal
  // below silently fails. We compensate by fetching the legacy doc directly,
  // reusing the already-loaded primary snapshot when we have it.
  async function loadOwnerBranches(
    uid: string,
    primarySnap?: DocumentSnapshot<DocumentData>,
  ): Promise<ServiceCenter[]> {
    try {
      const snap = await getDocs(
        query(collection(db, "servicecenters"), where("ownerUid", "==", uid)),
      );
      const branches = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as ServiceCenter));

      // Legacy primary centers have doc id === owner uid but may not have the
      // ownerUid field set. Include the legacy doc when the query missed it.
      if (!branches.some((b) => b.id === uid)) {
        const legacy = primarySnap ?? (await getDoc(doc(db, "servicecenters", uid)).catch(() => undefined));
        if (legacy?.exists()) {
          branches.push({ id: legacy.id, ...legacy.data() } as ServiceCenter);
        }
      }

      return branches
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

  // Plan + blocked status for one specific center document. A center the
  // super admin has closed (isActive: false) is treated as blocked too —
  // without this, a single-branch owner (whose users-index centerId bypasses
  // the loadOwnerBranches isActive filter) and all staff of a closed center
  // could still sign in.
  async function resolveCenterFields(centerId: string): Promise<{ plan?: "basic" | "pro"; blocked: boolean }> {
    try {
      const centerSnap = await getDoc(doc(db, "servicecenters", centerId));
      if (!centerSnap.exists()) return { blocked: false };
      const data = centerSnap.data() as { plan?: "basic" | "pro"; status?: string; isActive?: boolean };
      return {
        plan: data.plan ?? "basic",
        blocked: data.status === "blocked" || data.isActive === false,
      };
    } catch {
      return { blocked: false };
    }
  }

  // Resolve the centerId/role for a signed-in Firebase user. Returns the
  // assembled profile, or null if the user has been removed and signed out.
  // Throws ProfileResolutionError when a read the profile depends on fails on
  // the network — the caller must not treat that as a profile-less account.
  async function resolveAuthUser(user: User): Promise<ResolvedProfile | null> {
    let centerId: string | undefined;
    let role: UserRole | undefined;

    // The two authoritative identity reads are independent, so fire them in
    // parallel: the Firestore user index (users/{uid}) and the legacy
    // owner-center doc (servicecenters/{uid}). The old getIdTokenResult()
    // custom-claims lookup was removed — functions/index.js never sets any
    // claims, so it was a guaranteed-empty round trip on every sign-in.
    const [idxRes, legacyRes] = await Promise.all([
      safeGet(doc(db, "users", user.uid)),
      safeGet(doc(db, "servicecenters", user.uid)),
    ]);

    if (idxRes.snap?.exists()) {
      const d = idxRes.snap.data() as { centerId?: string; role?: UserRole };
      centerId = d.centerId;
      role = d.role;
    }

    // Legacy fallback: if this user owns a service center (centerId == uid).
    let legacyCenterDoc: Record<string, unknown> | undefined;
    if ((!centerId || !role) && legacyRes.snap?.exists()) {
      centerId = user.uid;
      role = "Owner";
      legacyCenterDoc = legacyRes.snap.data();
      // Self-heal the user index so subsequent loads skip the fallback.
      // Fire-and-forget: this write must never block the sign-in path.
      void setDoc(doc(db, "users", user.uid), {
        centerId: user.uid,
        role: "Owner",
        email: user.email,
        createdAt: Timestamp.now(),
      }).catch(() => {
        /* ignore — best-effort self-heal */
      });
    }

    // If we still have no profile but a read the answer depended on failed on
    // the network, this is a load failure — not a genuinely profile-less
    // account. Surface it so the guards show a retry screen instead of
    // bouncing a validly-authenticated user back to /login.
    if ((!centerId || !role) && (idxRes.netErr || legacyRes.netErr)) {
      throw new ProfileResolutionError(idxRes.netErr ?? legacyRes.netErr);
    }

    // Self-heal: backfill multi-branch fields onto primary centers that
    // predate this feature, so the ownerUid-based branch query below finds
    // them immediately. Reuse the already-loaded primary snapshot; fire the
    // write and move on rather than blocking the sign-in.
    if (centerId && role === "Owner") {
      const primaryData =
        legacyCenterDoc ??
        (centerId === user.uid ? legacyRes.snap?.data() : undefined);
      if (primaryData && primaryData.ownerUid === undefined) {
        void setDoc(
          doc(db, "servicecenters", centerId),
          {
            ownerUid: user.uid,
            isBranch: false,
            primaryCenterId: null,
            monthlyRate: primaryData.plan === "pro" ? 7999 : 4999,
            isActive: true,
          },
          { merge: true },
        ).catch(() => {
          /* ignore — best-effort self-heal */
        });
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
      ownerBranches = await loadOwnerBranches(
        user.uid,
        centerId === user.uid ? legacyRes.snap : undefined,
      );
      if (ownerBranches.length > 0) {
        effectiveCenterId = pickEffectiveCenterId(user.uid, ownerBranches);
      }
    }
    const needsSelection = role === "Owner" && ownerBranches.length > 1 && !effectiveCenterId;

    let centerPlan: "basic" | "pro" | undefined;
    let blocked = false;
    if (effectiveCenterId) {
      const fields = await resolveCenterFields(effectiveCenterId);
      centerPlan = fields.plan;
      blocked = fields.blocked;
    }

    return {
      user: {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        centerId: effectiveCenterId,
        role,
        centerPlan,
      },
      branches: ownerBranches,
      needsBranchSelection: needsSelection,
      centerBlocked: blocked,
    };
  }

  // Push a resolved profile (or the signed-out null) into React state.
  function applyResolved(resolved: ResolvedProfile | null) {
    if (!resolved) {
      setCurrentUser(null);
      setBranches([]);
      setNeedsBranchSelection(false);
      setCenterBlocked(false);
      return;
    }
    setCurrentUser(resolved.user);
    setBranches(resolved.branches);
    setNeedsBranchSelection(resolved.needsBranchSelection);
    setCenterBlocked(resolved.centerBlocked);
  }

  // Re-resolve the current user's profile. Used right after onboarding so the
  // freshly-written centerId/role are reflected without a full page reload.
  async function refreshUser() {
    const user = auth.currentUser;
    if (!user) return;
    try {
      const resolved = await resolveAuthUser(user);
      applyResolved(resolved);
      setProfileError(false);
      if (resolved) writeProfileCache(user.uid, resolved);
      else clearProfileCache(user.uid);
    } catch (err) {
      if (err instanceof ProfileResolutionError) {
        setProfileError(true);
      } else {
        throw err;
      }
    }
  }

  // Retry the profile read after a network-induced failure. Wired to the
  // "Try again" button in the route guards; the Firebase session is untouched.
  async function retryProfileLoad() {
    const user = auth.currentUser;
    if (!user) return;
    setProfileError(false);
    setLoading(true);
    try {
      const resolved = await resolveAuthUser(user);
      applyResolved(resolved);
      if (resolved) writeProfileCache(user.uid, resolved);
      else clearProfileCache(user.uid);
    } catch (err) {
      if (err instanceof ProfileResolutionError) {
        setProfileError(true);
      } else {
        console.error("Auth resolution failed", err);
        setCurrentUser(null);
      }
    } finally {
      setLoading(false);
    }
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
    setCurrentUser((prev) => {
      const next = prev ? { ...prev, centerId, centerPlan: fields.plan } : prev;
      if (next) writeProfileCache(user.uid, { user: next, branches, needsBranchSelection: false, centerBlocked: fields.blocked });
      return next;
    });
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user: User | null) => {
      if (!user) {
        applyResolved(null);
        setProfileError(false);
        setLoading(false);
        setAuthenticating(false);
        return;
      }

      // Stale-while-revalidate: paint the last-known profile immediately so an
      // app reopen resolves routes without a spinner, then run the real read.
      const cached = readProfileCache(user.uid);
      if (cached) {
        setCurrentUser(cached.user);
        setCenterBlocked(cached.centerBlocked);
        setBranches([]);
        setNeedsBranchSelection(false);
        setProfileError(false);
        setLoading(false);
      }

      try {
        const resolved = await resolveAuthUser(user);
        applyResolved(resolved);
        setProfileError(false);
        if (resolved) writeProfileCache(user.uid, resolved);
        else clearProfileCache(user.uid);
      } catch (err) {
        if (err instanceof ProfileResolutionError) {
          // A read failed on the network. The Firebase session is still valid,
          // so don't clear it — show the retry screen instead. If the cache
          // already painted a usable profile, keep it and stay silent.
          console.warn("Profile load failed", err);
          if (!cached) setProfileError(true);
        } else {
          // Never leave the app stuck on the loading spinner if resolution
          // throws unexpectedly — surface it and let the guards react.
          console.error("Auth resolution failed", err);
          setCurrentUser(null);
        }
      } finally {
        setLoading(false);
        setAuthenticating(false);
      }
    });
    return unsubscribe;
  }, []);

  async function login(email: string, password: string, rememberMe: boolean) {
    setCenterBlocked(false);
    setProfileError(false);
    setAuthenticating(true);
    try {
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
      await signInWithEmailAndPassword(auth, email, password);
      // Left true here on purpose: onAuthStateChanged fires next and clears
      // it once the signed-in user's profile has fully resolved.
    } catch (err) {
      setAuthenticating(false);
      throw err;
    }
  }

  async function logout() {
    const uid = auth.currentUser?.uid;
    if (uid) clearProfileCache(uid);
    await signOut(auth);
  }

  async function createAccount(email: string, password: string): Promise<string> {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    return credential.user.uid;
  }

  return (
    <AuthContext.Provider
      value={{
        currentUser, loading, authenticating, profileError, retryProfileLoad,
        centerBlocked, branches, needsBranchSelection,
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
