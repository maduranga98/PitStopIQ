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
    origin: "platform",
    status: "sent",
    mask: SENDER_MASK,
    sentAt: Timestamp.now(),
  });
}

export const ADMIN_SMS_MASKS = ["Lumora Tech", "PitStopIQ"] as const;
export type AdminSmsMask = (typeof ADMIN_SMS_MASKS)[number];

const last9 = (p?: string) => (p ?? "").replace(/\D/g, "").slice(-9);

/** One reachable owner: branches that share an owner phone collapse into one. */
export type OwnerRecipient = { key: string; centerId: string; phone: string; ownerName: string; centerName: string };

/** Distinct owners (by phone) from a list of centers; centers without a phone are skipped. */
export function ownerRecipients(centers: ServiceCenter[]): OwnerRecipient[] {
  const seen = new Map<string, OwnerRecipient>();
  for (const c of centers) {
    const key = last9(c.ownerPhone);
    if (key.length < 9 || seen.has(key)) continue;
    seen.set(key, { key, centerId: c.id, phone: c.ownerPhone!, ownerName: c.ownerName ?? "", centerName: c.name });
  }
  return [...seen.values()];
}

/** Fills {OwnerName} / {CenterName} for one recipient. */
export function personalise(template: string, r: Pick<OwnerRecipient, "ownerName" | "centerName">): string {
  return template
    .replace(/\{OwnerName\}/g, r.ownerName || "there")
    .replace(/\{CenterName\}/g, r.centerName);
}

/** Queues a super-admin written SMS to one owner via the smsLogs pipeline. */
export async function sendCustomSms(r: OwnerRecipient, template: string, mask: AdminSmsMask): Promise<void> {
  await safeAddDoc(collection(db, "servicecenters", r.centerId, "smsLogs"), {
    customerName: r.ownerName,
    phone: r.phone,
    message: personalise(template, r),
    messageType: "Custom",
    origin: "platform",
    status: "sent",
    mask,
    sentAt: Timestamp.now(),
  });
}
