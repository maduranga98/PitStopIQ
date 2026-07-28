import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../config/firebase";
import type { DistributorOrder, Invoice, SupplierSupply } from "../types/auth";
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
export function useChequeRegister(centerId: string | undefined): ChequeRegisterData {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [orders, setOrders] = useState<DistributorOrder[]>([]);
  const [supplies, setSupplies] = useState<SupplierSupply[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!centerId) return;
    return onSnapshot(
      query(collection(db, "servicecenters", centerId, "invoices"), orderBy("createdAt", "desc"), limit(DOC_LIMIT)),
      snap => {
        setInvoices(snap.docs.map(d => ({ id: d.id, ...d.data() } as Invoice)));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [centerId]);

  useEffect(() => {
    if (!centerId) return;
    return onSnapshot(
      query(collection(db, "servicecenters", centerId, "distributorOrders"), orderBy("createdAt", "desc"), limit(DOC_LIMIT)),
      snap => setOrders(snap.docs.map(d => ({ id: d.id, ...d.data() } as DistributorOrder))),
      () => setOrders([]),
    );
  }, [centerId]);

  useEffect(() => {
    if (!centerId) return;
    return onSnapshot(
      query(collection(db, "servicecenters", centerId, "supplierSupplies"), orderBy("createdAt", "desc"), limit(DOC_LIMIT)),
      snap => setSupplies(snap.docs.map(d => ({ id: d.id, ...d.data() } as SupplierSupply))),
      () => setSupplies([]),
    );
  }, [centerId]);

  const entries = useMemo(
    () => collectRegisterEntries({ invoices, orders, supplies })
      .sort((a, b) => effectiveDate(a).getTime() - effectiveDate(b).getTime()),
    [invoices, orders, supplies],
  );

  const sources = useMemo(() => ({
    invoices: new Map(invoices.map(i => [i.id, i])),
    orders: new Map(orders.map(o => [o.id, o])),
    supplies: new Map(supplies.map(s => [s.id, s])),
  }), [invoices, orders, supplies]);

  return { entries, sources, loading };
}
