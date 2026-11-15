import { doc } from "firebase/firestore";
import { db } from "../config/firebase";
import { boundedGetDoc } from "./firestoreRead";

// Jobs, invoices, bookings and reports each carry a copy of the customer's
// phone from the day they were created. A message must go to the number on the
// customer record as it stands NOW — a customer whose number was corrected
// yesterday should not get today's SMS on the old one — so every sender reads
// the live customer here and only falls back to the copy when that read fails
// (offline, or the customer is gone).

/** The customer's current phone, or `fallback` when it can't be read. */
export async function resolveCustomerPhone(
  centerId: string, customerId: string | null | undefined, fallback?: string | null,
): Promise<string> {
  const copy = fallback?.trim() ?? "";
  if (!centerId || !customerId) return copy;
  try {
    const snap = await boundedGetDoc(doc(db, "servicecenters", centerId, "customers", customerId));
    const live = (snap.data()?.phone as string | undefined)?.trim();
    return live || copy;
  } catch {
    return copy;
  }
}
