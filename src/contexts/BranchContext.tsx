import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { collection, onSnapshot, query, orderBy, getDoc, doc } from "firebase/firestore";
import { db } from "../config/firebase";
import { useAuth } from "./AuthContext";
import type { Branch, StaffMember } from "../types/auth";

interface BranchContextValue {
  branches: Branch[];
  allBranches: Branch[];
  activeBranchId: string | null;
  setActiveBranchId: (id: string | null) => void;
  activeBranch: Branch | null;
  isAllBranches: boolean;
  hasBranches: boolean;
  loading: boolean;
}

const BranchContext = createContext<BranchContextValue | null>(null);
const LS_KEY = "psiq_active_branch";

function filterAccessible(all: Branch[], isOwner: boolean, staffIds: string[] | null): Branch[] {
  const active = all.filter(b => b.active);
  if (isOwner || staffIds === null) return active;
  return active.filter(b => staffIds.includes(b.id));
}

export function BranchProvider({ children }: { children: ReactNode }) {
  const { currentUser } = useAuth();
  const [allBranches, setAllBranches] = useState<Branch[]>([]);
  const [branchesLoaded, setBranchesLoaded] = useState(false);
  const [staffBranchIds, setStaffBranchIds] = useState<string[] | null>(null);
  const [activeBranchId, setActiveBranchIdRaw] = useState<string | null>(null);
  const initDone = useRef(false);

  const isOwner = currentUser?.role === "Owner";
  const centerId = currentUser?.centerId;

  useEffect(() => {
    initDone.current = false;
    setActiveBranchIdRaw(null);
    setBranchesLoaded(false);
    setAllBranches([]);
    setStaffBranchIds(null);
  }, [centerId]);

  useEffect(() => {
    if (!centerId) {
      setBranchesLoaded(true);
      return;
    }
    const q = query(
      collection(db, "servicecenters", centerId, "branches"),
      orderBy("createdAt", "asc"),
    );
    return onSnapshot(q, snap => {
      setAllBranches(snap.docs.map(d => ({ id: d.id, ...d.data() } as Branch)));
      setBranchesLoaded(true);
    });
  }, [centerId]);

  useEffect(() => {
    if (!centerId || !currentUser?.uid || isOwner) {
      setStaffBranchIds(null);
      return;
    }
    getDoc(doc(db, "servicecenters", centerId, "staff", currentUser.uid)).then(snap => {
      const st = snap.exists() ? (snap.data() as StaffMember) : null;
      setStaffBranchIds(st?.branchIds ?? []);
    });
  }, [centerId, currentUser?.uid, isOwner]);

  useEffect(() => {
    if (!branchesLoaded) return;
    if (!isOwner && staffBranchIds === null && allBranches.length > 0) return;
    if (initDone.current) return;
    initDone.current = true;

    const accessible = filterAccessible(allBranches, isOwner, staffBranchIds);
    if (accessible.length === 0) return;

    const saved = localStorage.getItem(LS_KEY);
    if (saved === "all" && isOwner) {
      setActiveBranchIdRaw(null);
    } else if (saved && accessible.some(b => b.id === saved)) {
      setActiveBranchIdRaw(saved);
    } else {
      setActiveBranchIdRaw(accessible[0].id);
    }
  }, [branchesLoaded, allBranches, isOwner, staffBranchIds]);

  function setActiveBranchId(id: string | null) {
    setActiveBranchIdRaw(id);
    localStorage.setItem(LS_KEY, id ?? "all");
  }

  const branches = filterAccessible(allBranches, isOwner, staffBranchIds);
  const activeBranch = activeBranchId ? (branches.find(b => b.id === activeBranchId) ?? null) : null;
  const isAllBranches = activeBranchId === null && isOwner && allBranches.length > 0;
  const hasBranches = allBranches.length > 0;

  return (
    <BranchContext.Provider value={{
      branches,
      allBranches,
      activeBranchId,
      setActiveBranchId,
      activeBranch,
      isAllBranches,
      hasBranches,
      loading: !branchesLoaded,
    }}>
      {children}
    </BranchContext.Provider>
  );
}

export function useBranch() {
  const ctx = useContext(BranchContext);
  if (!ctx) throw new Error("useBranch must be used within BranchProvider");
  return ctx;
}
