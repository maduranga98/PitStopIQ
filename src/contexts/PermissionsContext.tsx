import {
  createContext, useContext, useEffect, useState, useCallback, type ReactNode,
} from "react";
import { collection, doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../config/firebase";
import { useAuth } from "./AuthContext";
import type {
  AllRolePermissions, CustomRole, RolePermissions, StaffRoleKey,
} from "../types/permissions";
import type { StoreAddonKey } from "../types/auth";
import {
  DEFAULT_PERMISSIONS, LOCKED_OFF, getPermissionValue, mergeWithDefaults,
} from "../lib/defaultPermissions";

interface PermissionsContextValue {
  permissions: AllRolePermissions | null;
  customRoles: Record<string, CustomRole>;
  loading: boolean;
  hasPermission: (key: string) => boolean;
  saveRolePermissions: (role: StaffRoleKey, perms: RolePermissions) => Promise<void>;
  resetRolePermissions: (role: StaffRoleKey) => Promise<void>;
  // Store add-ons (Outlets/POS, Distributors) — super-admin managed, unlocked
  // once the owner's purchase request is approved. Not gated behind loading
  // the way role permissions are: storeAddonsLoading is its own flag so a
  // route guard doesn't have to wait on the (Pro-only) permissions doc.
  storeAddons: Partial<Record<StoreAddonKey, boolean>>;
  storeAddonsLoading: boolean;
  hasStoreAddon: (addon: StoreAddonKey) => boolean;
}

const PermissionsContext = createContext<PermissionsContextValue | null>(null);

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { currentUser } = useAuth();
  const centerId = currentUser?.centerId;
  const isPro = currentUser?.centerPlan === "pro";

  const [permissions, setPermissions] = useState<AllRolePermissions | null>(null);
  const [customRoles, setCustomRoles] = useState<Record<string, CustomRole>>({});
  const [loading, setLoading] = useState(true);
  const [storeAddons, setStoreAddons] = useState<Partial<Record<StoreAddonKey, boolean>>>({});
  const [storeAddonsLoading, setStoreAddonsLoading] = useState(true);

  // Store add-ons live on the center document itself (not gated to Pro), so
  // route guards reflect an admin's approval the instant it lands.
  useEffect(() => {
    if (!centerId) {
      setStoreAddons({});
      setStoreAddonsLoading(false);
      return;
    }
    const unsub = onSnapshot(
      doc(db, "servicecenters", centerId),
      snap => {
        setStoreAddons((snap.data()?.storeAddons as Partial<Record<StoreAddonKey, boolean>>) ?? {});
        setStoreAddonsLoading(false);
      },
      () => setStoreAddonsLoading(false),
    );
    return unsub;
  }, [centerId]);

  useEffect(() => {
    if (!centerId || !isPro) {
      setPermissions(null);
      setLoading(false);
      return;
    }

    const ref = doc(db, "servicecenters", centerId, "settings", "rolePermissions");
    const unsub = onSnapshot(ref, snap => {
      if (snap.exists()) {
        setPermissions(snap.data() as AllRolePermissions);
      } else {
        setPermissions(null);
      }
      setLoading(false);
    }, () => {
      setLoading(false);
    });

    return unsub;
  }, [centerId, isPro]);

  useEffect(() => {
    if (!centerId || !isPro) {
      setCustomRoles({});
      return;
    }
    const unsub = onSnapshot(
      collection(db, "servicecenters", centerId, "customRoles"),
      snap => {
        const map: Record<string, CustomRole> = {};
        snap.docs.forEach(d => { map[d.id] = { id: d.id, ...d.data() } as CustomRole; });
        setCustomRoles(map);
      },
      () => setCustomRoles({}),
    );
    return unsub;
  }, [centerId, isPro]);

  const hasPermission = useCallback((key: string): boolean => {
    const role = currentUser?.role;
    if (!role) return false;

    // Owner always has full access
    if (role === "Owner") return true;

    const roleKey = role.toLowerCase() as StaffRoleKey;

    // Check if permanently locked off for this role — this ceiling always
    // applies, even under a custom role, since it mirrors what firestore.rules
    // actually allows that base role to touch.
    if (LOCKED_OFF[roleKey]?.has(key)) return false;
    if (!DEFAULT_PERMISSIONS[roleKey]) return false;

    // A custom role's own feature grid takes over entirely in place of the
    // center's per-base-role permissions document — it is independently
    // edited, not a restricted subset of the base role's defaults.
    const customRoleId = currentUser?.customRoleId;
    const customRole = customRoleId ? customRoles[customRoleId] : undefined;
    if (customRole) {
      const rolePerms = mergeWithDefaults(roleKey, customRole.permissions);
      return getPermissionValue(rolePerms, key);
    }

    // Stored values win, but any key the stored document predates falls back
    // to the role default rather than reading as denied.
    const rolePerms = mergeWithDefaults(roleKey, permissions?.[roleKey]);

    return getPermissionValue(rolePerms, key);
  }, [currentUser?.role, currentUser?.customRoleId, permissions, customRoles]);

  async function saveRolePermissions(role: StaffRoleKey, perms: RolePermissions) {
    if (!centerId) throw new Error("No center ID");
    const ref = doc(db, "servicecenters", centerId, "settings", "rolePermissions");
    const current = permissions ?? buildDefaultAll();
    await setDoc(ref, { ...current, [role]: perms }, { merge: false });
  }

  async function resetRolePermissions(role: StaffRoleKey) {
    if (!centerId) throw new Error("No center ID");
    const ref = doc(db, "servicecenters", centerId, "settings", "rolePermissions");
    const current = permissions ?? buildDefaultAll();
    await setDoc(ref, { ...current, [role]: DEFAULT_PERMISSIONS[role] }, { merge: false });
  }

  const hasStoreAddon = useCallback(
    (addon: StoreAddonKey) => Boolean(storeAddons[addon]),
    [storeAddons],
  );

  return (
    <PermissionsContext.Provider value={{
      permissions, customRoles, loading, hasPermission, saveRolePermissions, resetRolePermissions,
      storeAddons, storeAddonsLoading, hasStoreAddon,
    }}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions() {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error("usePermissions must be used within PermissionsProvider");
  return ctx;
}

// Convenience hook for a single permission key
export function usePermission(key: string): boolean {
  const { hasPermission } = usePermissions();
  return hasPermission(key);
}

// Convenience hook for a single Store add-on
export function useStoreAddon(addon: StoreAddonKey): boolean {
  const { hasStoreAddon } = usePermissions();
  return hasStoreAddon(addon);
}

function buildDefaultAll(): AllRolePermissions {
  return {
    manager: DEFAULT_PERMISSIONS.manager,
    technician: DEFAULT_PERMISSIONS.technician,
    cashier: DEFAULT_PERMISSIONS.cashier,
    receptionist: DEFAULT_PERMISSIONS.receptionist,
  };
}
