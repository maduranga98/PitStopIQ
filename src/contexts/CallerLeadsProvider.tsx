import { useEffect, useMemo, useState, type ReactNode } from "react";
import { collection, limit, query, where } from "firebase/firestore";
import { db } from "../config/firebase";
import { watchQuery } from "../lib/listeners";
import { useCaller } from "./CallerContext";
import { CallerLeadsContext } from "./callerLeadsContext";
import type { Lead } from "../types/leads";

/** A caller works a few hundred leads at most; this only guards against an unbounded stream. */
const LEADS_LIMIT = 500;

/**
 * The query is the scope the rules require (`assignedTo == uid`). Held above
 * the routes so switching between My Leads and Revenue doesn't re-read it.
 */
export function CallerLeadsProvider({ children }: { children: ReactNode }) {
  const { caller } = useCaller();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const callerId = caller?.id;

  useEffect(() => {
    if (!callerId) return;
    return watchQuery(
      query(collection(db, "leads"), where("assignedTo", "==", callerId), limit(LEADS_LIMIT)),
      (snap) => {
        setLeads(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Lead)).filter((l) => !l.isDeleted));
        setLoading(false);
        setError(false);
      },
      () => { setLoading(false); setError(true); },
    );
  }, [callerId]);

  const value = useMemo(() => ({ leads, loading, error }), [leads, loading, error]);
  return <CallerLeadsContext.Provider value={value}>{children}</CallerLeadsContext.Provider>;
}
