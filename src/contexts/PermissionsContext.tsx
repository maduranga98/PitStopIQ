import {
  createContext, useContext, useEffect, useState, useCallback, type ReactNode,
} from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../config/firebase";
import { useAuth } from "./AuthContext";
import type { AllRolePermissions, RolePermissions, StaffRoleKey } from "../types/permissions";
import {
  DEFAULT_PERMISSIONS, LOCKED_OFF, getPermissionValue,
} from "../lib/defaultPermissions";

interface PermissionsContextValue {
  permissions: AllRolePermissions | null;
  loading: boolean;
  hasPermission: (key: string) => boolean;
  saveRolePermissions: (role: StaffRoleKey, perms: RolePermissions) => Promise<void>;
  resetRolePermissions: (role: StaffRoleKey) => Promise<void>;
}

const PermissionsContext = createContext<PermissionsContextValue | null>(null);

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { currentUser } = useAuth();
  const centerId = currentUser?.centerId;
  const isPro = currentUser?.centerPlan === "pro";

  const [permissions, setPermissions] = useState<AllRolePermissions | null>(null);
  const [loading, setLoading] = useState(true);

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

  const hasPermission = useCallback((key: string): boolean => {
    const role = currentUser?.role;
    if (!role) return false;

    // Owner always has full access
    if (role === "Owner") return true;

    const roleKey = role.toLowerCase() as StaffRoleKey;

    // Check if permanently locked off for this role
    if (LOCKED_OFF[roleKey]?.has(key)) return false;

    // Get value from loaded permissions (or defaults if no custom permissions saved)
    const rolePerms = permissions?.[roleKey] ?? DEFAULT_PERMISSIONS[roleKey];
    if (!rolePerms) return false;

    return getPermissionValue(rolePerms, key);
  }, [currentUser?.role, permissions]);

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

  return (
    <PermissionsContext.Provider value={{ permissions, loading, hasPermission, saveRolePermissions, resetRolePermissions }}>
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

function buildDefaultAll(): AllRolePermissions {
  return {
    manager: DEFAULT_PERMISSIONS.manager,
    technician: DEFAULT_PERMISSIONS.technician,
    cashier: DEFAULT_PERMISSIONS.cashier,
    receptionist: DEFAULT_PERMISSIONS.receptionist,
  };
}
