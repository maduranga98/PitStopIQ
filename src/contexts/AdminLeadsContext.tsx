// ── One leads + callers feed for the whole super-admin portal ─────────────────
// Management, Calls and Callers each opened their own listener on `leads`
// (Management reads up to BOARD_LIMIT of them) and Callers then ran two billed
// count queries per caller on top. Every sidebar click re-downloaded the same
// pipeline.
//
// Here ONE listener serves all of them. It attaches on the first screen that
// asks (so Service Centers / Revenue never pay for it) and then stays open for
// the portal session: leaving and re-entering a screen costs nothing, and a
// change anywhere bills only the document that changed.
import {
  createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import { collection, limit, orderBy, query } from "firebase/firestore";
import { db } from "../config/firebase";
import { watchQuery } from "../lib/listeners";
import type { Lead } from "../types/leads";
import type { Caller } from "../types/auth";

/** Most leads held at once. Past this the feed is truncated (`truncated`). */
export const LEADS_FEED_LIMIT = 1000;

interface AdminLeadsValue {
  /** Newest first, archived rows included — callers filter `isDeleted` as needed. */
  leads: Lead[];
  /** Sorted by name. */
  callers: Caller[];
  loading: boolean;
  /** A listener was rejected (offline cache miss, rules). Lists may be incomplete. */
  error: boolean;
  /** True when the feed hit LEADS_FEED_LIMIT, so derived totals may undercount. */
  truncated: boolean;
  /** Attach the listeners (idempotent). Called by `useAdminLeads`. */
  start: () => void;
}

const Ctx = createContext<AdminLeadsValue | null>(null);

export function AdminLeadsProvider({ children }: { children: ReactNode }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [callers, setCallers] = useState<Caller[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [callersLoading, setCallersLoading] = useState(true);
  const [error, setError] = useState(false);
  const [started, setStarted] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!started) return;
    const stopLeads = watchQuery(
      query(collection(db, "leads"), orderBy("createdAt", "desc"), limit(LEADS_FEED_LIMIT)),
      (snap) => {
        setLeads(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Lead));
        setLeadsLoading(false);
      },
      () => { setError(true); setLeadsLoading(false); },
    );
    const stopCallers = watchQuery(
      query(collection(db, "callers"), orderBy("name")),
      (snap) => {
        setCallers(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Caller));
        setCallersLoading(false);
      },
      () => { setError(true); setCallersLoading(false); },
    );
    return () => { stopLeads(); stopCallers(); };
  }, [started]);

  const value = useMemo<AdminLeadsValue>(() => ({
    leads,
    callers,
    loading: leadsLoading || callersLoading,
    error,
    truncated: leads.length >= LEADS_FEED_LIMIT,
    start: () => {
      if (startedRef.current) return;
      startedRef.current = true;
      setStarted(true);
    },
  }), [leads, callers, leadsLoading, callersLoading, error]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Subscribe a screen to the shared feed; the first caller attaches it. */
export function useAdminLeads() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAdminLeads must be used within AdminLeadsProvider");
  const { start } = ctx;
  useEffect(() => { start(); }, [start]);
  return ctx;
}
