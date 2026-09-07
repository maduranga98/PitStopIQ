import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../config/firebase";
import type { ServiceBay } from "../types/auth";

/** Stable empty list, so a disabled module doesn't hand out a new array each render. */
const EMPTY_BAYS: ServiceBay[] = [];

export interface WorkshopModules {
  /** Route each service line to a physical bay and track its progress there. */
  bayWorkflowEnabled: boolean;
  /** Pay technicians (and their supervisors) per service line. */
  commissionEnabled: boolean;
  /** True while the center doc has not been read yet. */
  loading: boolean;
}

/**
 * The two optional workshop modules, live off the center doc.
 *
 * Both default to false, which is what the overwhelming majority of centers
 * run — every caller must render exactly as it did before these existed while
 * that is the case, including during the initial read (both start false).
 */
export function useWorkshopModules(centerId: string | undefined): WorkshopModules {
  // null until the center doc is read — both modules read as off meanwhile,
  // which is the state that changes nothing for the majority of centers.
  const [flags, setFlags] = useState<{ bay: boolean; commission: boolean } | null>(null);

  useEffect(() => {
    if (!centerId) return;
    return onSnapshot(
      doc(db, "servicecenters", centerId),
      (snap) => {
        const d = snap.data() ?? {};
        setFlags({
          bay: d.bayWorkflowEnabled === true,
          commission: d.commissionEnabled === true,
        });
      },
      () => setFlags({ bay: false, commission: false }),
    );
  }, [centerId]);

  return {
    bayWorkflowEnabled: flags?.bay ?? false,
    commissionEnabled: flags?.commission ?? false,
    loading: centerId ? flags === null : false,
  };
}

/**
 * The center's service bays, ordered as the owner arranged them.
 *
 * Only subscribes when `enabled` — a center without the bay workflow never
 * reads the collection at all. `activeBays` is what every picker offers;
 * inactive bays stay readable so a job already routed to one still resolves
 * its name.
 */
export function useServiceBays(centerId: string | undefined, enabled: boolean) {
  const [bays, setBays] = useState<ServiceBay[]>([]);

  useEffect(() => {
    if (!centerId || !enabled) return;
    return onSnapshot(
      query(collection(db, "servicecenters", centerId, "bays"), orderBy("order")),
      (snap) => setBays(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ServiceBay))),
      () => setBays([]),
    );
  }, [centerId, enabled]);

  // A center that switched the module off (or has no center yet) offers no
  // bays, without having to clear state from inside the effect.
  const live = centerId && enabled ? bays : EMPTY_BAYS;
  const activeBays = useMemo(() => live.filter((b) => b.isActive !== false), [live]);
  return { bays: live, activeBays };
}
