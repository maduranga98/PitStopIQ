import { collection, Timestamp } from "firebase/firestore";
import { db } from "../config/firebase";
import { safeAddDoc } from "./firestoreWrite";
import type { RegisterEntry } from "./chequeRegister";

// The moment a receivable cheque or credit tab is marked received, the party
// that paid gets a short thank-you SMS — queued through the same smsLogs
// pipeline every other outbound message in the app uses (see
// functions/index.js: dispatchSmsLog).

export function buildThankYouMessage(entry: RegisterEntry, centerName: string): string {
  const amount = entry.amount.toLocaleString("en-LK", { minimumFractionDigits: 2 });
  const what = entry.kind === "cheque"
    ? `cheque ${entry.chequeNumber ?? entry.reference}`
    : `payment against ${entry.reference}`;
  return `Hi ${entry.partyName}, thank you! We've received your ${what} for LKR ${amount}. - ${centerName}`;
}

export interface ThankYouParty {
  id: string;
  name: string;
  phone?: string;
}

/**
 * Queues the thank-you SMS. A no-op when the party has no phone on file — the
 * payment is still marked received either way, this is best-effort courtesy.
 */
export async function queueThankYouSms(
  centerId: string,
  entry: RegisterEntry,
  party: ThankYouParty,
  centerName: string,
): Promise<void> {
  if (!party.phone) return;

  const data: Record<string, unknown> = {
    customerName: party.name,
    phone: party.phone,
    messageType: "ThankYou",
    status: "sent",
    message: buildThankYouMessage(entry, centerName),
    sentAt: Timestamp.now(),
  };
  if (entry.source === "invoice") {
    data.customerId = party.id;
    data.invoiceId = entry.docId;
  } else if (entry.source === "distributorOrder") {
    data.distributorId = party.id;
  }

  await safeAddDoc(collection(db, "servicecenters", centerId, "smsLogs"), data);
}
