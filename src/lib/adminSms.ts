import { collection, Timestamp } from "firebase/firestore";
import { db } from "../config/firebase";
import { safeAddDoc } from "./firestoreWrite";
import type { ServiceCenter } from "../types/auth";

// Billing-related SMS sent by the super admin to service center owners,
// signed as Lumora Tech (the second sender mask approved with Dialog eSMS
// alongside the default PitStopIQ one).
const SENDER_MASK = "Lumora Tech";

export function buildPaymentReminderMessage(center: Pick<ServiceCenter, "ownerName" | "name" | "branchName" | "isBranch" | "monthlyRate" | "paymentCode">): string {
  const label = center.isBranch ? (center.branchName ?? center.name) : center.name;
  const amount = center.monthlyRate ?? 0;
  return (
    `Dear ${center.ownerName || "there"}, your PitStopIQ payment for "${label}" is due. ` +
    `Amount: LKR ${amount.toLocaleString()}${center.paymentCode ? ` (Ref: ${center.paymentCode})` : ""}. ` +
    `Please log in and upload your payment slip to avoid service interruption.\n- Lumora Tech`
  );
}

/** Queues a payment-reminder SMS to a center's owner via the smsLogs pipeline. */
export async function sendPaymentReminderSms(center: ServiceCenter): Promise<void> {
  if (!center.ownerPhone) throw new Error(`No owner phone on file for ${center.name}.`);
  await safeAddDoc(collection(db, "servicecenters", center.id, "smsLogs"), {
    phone: center.ownerPhone,
    message: buildPaymentReminderMessage(center),
    messageType: "Reminder",
    status: "sent",
    mask: SENDER_MASK,
    sentAt: Timestamp.now(),
  });
}
