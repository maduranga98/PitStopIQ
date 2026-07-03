import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { collection, serverTimestamp } from "firebase/firestore";
import { safeAddDoc } from "./firestoreWrite";
import { db, storage } from "../config/firebase";
import type { PaymentPeriod } from "../types/auth";

interface UploadPaymentSlipParams {
  centerId: string;
  centerName: string;
  paymentCode: string;
  plan: "basic" | "pro";
  amount: number;
  period: PaymentPeriod;
  file: File;
  notes?: string;
  uploadedBy?: string;
}

/**
 * Uploads a payment slip image/PDF to Storage and files a
 * `paymentSlipRequests` document for the super admin to review. Shared by
 * the settings subscription tab, the blocked-center screen, and the
 * multi-branch selector (each branch's slip is scoped by its own centerId).
 */
export async function uploadPaymentSlip({
  centerId, centerName, paymentCode, plan, amount, period, file, notes, uploadedBy,
}: UploadPaymentSlipParams): Promise<string> {
  const ext = file.name.split(".").pop();
  const slipRef = storageRef(storage, `paymentSlips/${centerId}/${Date.now()}.${ext}`);
  await uploadBytes(slipRef, file);
  const slipUrl = await getDownloadURL(slipRef);

  await safeAddDoc(collection(db, "paymentSlipRequests"), {
    centerId,
    centerName,
    paymentCode,
    plan,
    period,
    amount,
    slipUrl,
    notes: notes || null,
    status: "pending",
    ...(uploadedBy ? { uploadedBy } : {}),
    createdAt: serverTimestamp(),
  });

  return slipUrl;
}

/** Monthly rate for a given plan, falling back to the standard list prices. */
export function monthlyAmountFor(center: { plan: "basic" | "pro"; monthlyRate?: number }): number {
  if (center.monthlyRate) return center.monthlyRate;
  return center.plan === "pro" ? 7999 : 4999;
}
