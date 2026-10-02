import { useEffect, useMemo, useState } from "react";
import { collection, getDocsFromCache, limit, orderBy, query, type Query } from "firebase/firestore";
import { watchQuery } from "../lib/listeners";
import { boundedGetDocs } from "../lib/firestoreRead";
import { cachedFetch } from "../lib/refCache";
import { db } from "../config/firebase";
import type { DistributorOrder, Invoice, ManualRegisterEntry, SupplierSupply } from "../types/auth";
import {
  collectRegisterEntries, effectiveDate, type RegisterEntry, type RegisterSources,
} from "../lib/chequeRegister";

// A center rarely has more open paper than this; the cap keeps every listener
// that uses this hook from pulling a center's whole history down at once.
const DOC_LIMIT = 500;

export interface ChequeRegisterData {
  entries: RegisterEntry[];
  sources: RegisterSources;
  loading: boolean;
}

/**
 * Live cheque/credit register for a center — invoices, distributor orders and
 * supplier supplies, flattened into one list. Shared by the Cheques & Credits
 * page and the notification bell so both read the same live data.
 */
// The bell only counts reminders, so it reads the register once and reuses it
// for this long instead of holding four live listeners open on every page.
const SNAPSHOT_TTL_MS = 10 * 60_000;

// refCache lives in memory, so a reload or a PWA relaunch starts it empty and
// the bell paid for up to 2,000 documents (4 sources x 500) on EVERY app open —
// a handful of owners opening the app a few times a day was enough to exhaust
// the daily read quota on its own. The persistent Firestore cache already holds
// those documents from the last time they were read, and reading from it is
// free, so for this long after a server read the bell is served from the device.
// A badge that is a few hours behind is the trade; the Cheques page is live and
// refreshes the same cache whenever it is opened.
const DEVICE_TTL_MS = 4 * 60 * 60_000;

const stampKey = (centerId: string, name: string) => `piq:chequeRegister:${centerId}:${name}`;

function freshOnDevice(centerId: string, name: string): boolean {
  try {
    const at = Number(localStorage.getItem(stampKey(centerId, name)));
    return at > 0 && Date.now() - at < DEVICE_TTL_MS;
  } catch { return false; }
}

function markRead(centerId: string, name: string): void {
  try { localStorage.setItem(stampKey(centerId, name), String(Date.now())); } catch { /* private mode */ }
}

/**
 * One-shot, cached read of a register source. Concurrent callers share one
 * round-trip and repeat callers inside the TTL pay zero reads.
 */
function watchOrFetch<T>(
  centerId: string,
  name: string,
  q: Query,
  live: boolean,
  onData: (rows: T[]) => void,
  onError: () => void,
): (() => void) | undefined {
  if (live) {
    return watchQuery(q, snap => onData(snap.docs.map(d => ({ id: d.id, ...d.data() } as T))), onError);
  }
  let active = true;
  cachedFetch(
    `${centerId}:chequeRegister:${name}`,
    async () => {
      // Empty cache result means "not cached here", not "no rows" — fall through.
      if (freshOnDevice(centerId, name)) {
        const cached = await getDocsFromCache(q).catch(() => undefined);
        if (cached && !cached.empty) return cached.docs.map(d => ({ id: d.id, ...d.data() } as T));
      }
      const snap = await boundedGetDocs(q);
      markRead(centerId, name);
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as T));
    },
    SNAPSHOT_TTL_MS,
  )
    .then(rows => { if (active) onData(rows); })
    .catch(() => { if (active) onError(); });
  return () => { active = false; };
}

export function useChequeRegister(
  centerId: string | undefined,
  { live = true }: { live?: boolean } = {},
): ChequeRegisterData {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [orders, setOrders] = useState<DistributorOrder[]>([]);
  const [supplies, setSupplies] = useState<SupplierSupply[]>([]);
  const [manual, setManual] = useState<ManualRegisterEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!centerId) return;
    return watchOrFetch<Invoice>(
      centerId, "invoices",
      query(collection(db, "servicecenters", centerId, "invoices"), orderBy("createdAt", "desc"), limit(DOC_LIMIT)),
      live,
      rows => { setInvoices(rows.filter(inv => !inv.isDeleted)); setLoading(false); },
      () => setLoading(false),
    );
  }, [centerId, live]);

  useEffect(() => {
    if (!centerId) return;
    return watchOrFetch<DistributorOrder>(
      centerId, "orders",
      query(collection(db, "servicecenters", centerId, "distributorOrders"), orderBy("createdAt", "desc"), limit(DOC_LIMIT)),
      live, setOrders, () => setOrders([]),
    );
  }, [centerId, live]);

  useEffect(() => {
    if (!centerId) return;
    return watchOrFetch<SupplierSupply>(
      centerId, "supplies",
      query(collection(db, "servicecenters", centerId, "supplierSupplies"), orderBy("createdAt", "desc"), limit(DOC_LIMIT)),
      live, setSupplies, () => setSupplies([]),
    );
  }, [centerId, live]);

  // Cheques and credit typed in by hand — paper with no invoice, order or
  // delivery behind it. Deleted ones are filtered out when they're flattened.
  useEffect(() => {
    if (!centerId) return;
    return watchOrFetch<ManualRegisterEntry>(
      centerId, "manual",
      query(collection(db, "servicecenters", centerId, "manualRegisterEntries"), orderBy("date", "desc"), limit(DOC_LIMIT)),
      live, setManual, () => setManual([]),
    );
  }, [centerId, live]);

  const entries = useMemo(
    () => collectRegisterEntries({ invoices, orders, supplies, manual })
      .sort((a, b) => effectiveDate(a).getTime() - effectiveDate(b).getTime()),
    [invoices, orders, supplies, manual],
  );

  const sources = useMemo(() => ({
    invoices: new Map(invoices.map(i => [i.id, i])),
    orders: new Map(orders.map(o => [o.id, o])),
    supplies: new Map(supplies.map(s => [s.id, s])),
    manual: new Map(manual.map(m => [m.id, m])),
  }), [invoices, orders, supplies, manual]);

  return { entries, sources, loading };
}
