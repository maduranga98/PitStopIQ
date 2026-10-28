import { collection, doc, query, where, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../config/firebase";
import { safeUpdateDoc } from "./firestoreWrite";
import { countDocs } from "./counts";

/** Writes and reads for the super admin's Callers screen (`callers/{uid}`). */

export const callersCollection = () => collection(db, "callers");
export const callerDoc = (callerId: string) => doc(db, "callers", callerId);

export interface NewCaller {
  name: string;
  email: string;
  phone: string;
}

export interface CreatedCaller {
  success: boolean;
  callerId: string;
  email: string;
  /** Returned once by the function and stored nowhere. */
  tempPassword: string;
  verified: boolean;
}

export async function createCaller(input: NewCaller): Promise<CreatedCaller> {
  const fn = httpsCallable<NewCaller, CreatedCaller>(functions, "createCallerAccount");
  const res = await fn(input);
  return res.data;
}

/**
 * Switch an account on or off. Only the flag changes: the Auth account stays,
 * and so do the caller's leads and any commission still owed to them.
 */
export async function setCallerActive(callerId: string, isActive: boolean): Promise<void> {
  await safeUpdateDoc(callerDoc(callerId), { isActive, updatedAt: serverTimestamp() });
}

export interface CallerCounts {
  /** Leads currently assigned to them. */
  assigned: number;
  /** Leads with a confirmed payment whose commission has not been paid out. */
  payoutsPending: number;
}

/** Server-side counts; rejects when offline, so callers should handle that. */
export async function callerCounts(callerId: string): Promise<CallerCounts> {
  const leads = collection(db, "leads");
  const [assigned, payoutsPending] = await Promise.all([
    countDocs(query(leads, where("assignedTo", "==", callerId))),
    countDocs(query(leads, where("assignedTo", "==", callerId), where("payoutStatus", "==", "pending"))),
  ]);
  return { assigned, payoutsPending };
}
