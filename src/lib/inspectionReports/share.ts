// ── Sharing a finalized report (IO) ──────────────────────────────────────────
// Mirrors the diagnostic reports' token model: the customer page is served by a
// callable (no rule grants a public read), SMS goes through the existing
// smsLogs → dispatchSmsLog path and the center's monthly quota, WhatsApp is a
// wa.me link. Sending needs a connection; the UI says so.
import { Timestamp, doc, collection, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../config/firebase";
import { boundedGetDoc } from "../firestoreRead";
import { safeAddDoc, safeSetDoc, safeUpdateDoc } from "../firestoreWrite";
import { analyzeSms, smsQuotaLimit } from "../smsTemplates";
import { inspectionReportDoc } from "./paths";
import {
  SMS_LINK_HOST, buildSmsMessage, publicReportUrl, shortCodeForToken,
} from "./shareText";
import type { InspectionReport, PublicInspectionPayload } from "../../types/inspectionReports";

export interface ShareCenter { name: string; phone: string; smsUsed: number; smsLimit: number }

/** Name, phone and this month's SMS quota — the quota figures the invoice
 *  screen reads (smsQuotaUsed / smsQuotaLimit, falling back to the plan's). */
export async function loadShareCenter(centerId: string): Promise<ShareCenter> {
  const snap = await boundedGetDoc(doc(db, "servicecenters", centerId));
  const d = snap.exists() ? snap.data() : {};
  return {
    name: d.name ?? "",
    phone: d.phone ?? "",
    smsUsed: d.smsQuotaUsed ?? 0,
    smsLimit: d.smsQuotaLimit ?? smsQuotaLimit(d.plan ?? "basic"),
  };
}

/** Same test as the invoice SMS: blocked once the quota is used up. */
export const smsQuotaExhausted = (c: Pick<ShareCenter, "smsUsed" | "smsLimit">) => c.smsUsed >= c.smsLimit;

export class SmsQuotaError extends Error {
  constructor() {
    super("This month's SMS quota is used up. You can still send by WhatsApp or copy the link.");
    this.name = "SmsQuotaError";
  }
}

/** Makes sure `links/{code}` resolves to this report; returns the link to put in
 *  the SMS (the short one, or the full URL in the unlikely event of a code clash). */
async function smsLinkFor(centerId: string, shareToken: string): Promise<string> {
  const code = shortCodeForToken(shareToken);
  const ref = doc(db, "links", code);
  try {
    const existing = await boundedGetDoc(ref);
    if (existing.exists()) {
      return existing.data().shareToken === shareToken ? `${SMS_LINK_HOST}/v/${code}` : publicReportUrl(shareToken).replace("https://", "");
    }
    await safeSetDoc(ref, { type: "inspectionReport", centerId, shareToken, createdAt: serverTimestamp() });
    return `${SMS_LINK_HOST}/v/${code}`;
  } catch {
    return publicReportUrl(shareToken).replace("https://", "");
  }
}

/** Records that the report was sent (Owner/Manager may write this on a finalized report). */
export const markShared = (centerId: string, reportId: string) =>
  safeUpdateDoc(inspectionReportDoc(centerId, reportId), { sharedAt: Timestamp.now(), updatedAt: Timestamp.now() });

export const setVisibleToCustomer = (centerId: string, reportId: string, visible: boolean) =>
  safeUpdateDoc(inspectionReportDoc(centerId, reportId), { visibleToCustomer: visible, updatedAt: Timestamp.now() });

export interface SmsPreview { message: string; segments: number }

export function previewReportSms(report: InspectionReport, centerName: string): SmsPreview {
  const message = buildSmsMessage({
    customerName: report.header.customerName, reportNumber: report.reportNumber ?? "", centerName, shareToken: report.shareToken,
  });
  return { message, segments: analyzeSms(message).segments };
}

/** Queue the SMS through the normal pipeline (smsLogs → dispatchSmsLog, which
 *  consumes the quota on delivery) and mark the report as sent. */
export async function sendReportSms(centerId: string, report: InspectionReport, center: ShareCenter): Promise<void> {
  // Re-check on the live figure: the screen may have been open a while.
  const fresh = await loadShareCenter(centerId);
  if (smsQuotaExhausted(fresh)) throw new SmsQuotaError();
  const link = await smsLinkFor(centerId, report.shareToken);
  const message = buildSmsMessage({
    customerName: report.header.customerName, reportNumber: report.reportNumber ?? "", centerName: center.name || fresh.name,
    shareToken: report.shareToken, link,
  });
  await safeAddDoc(collection(db, "servicecenters", centerId, "smsLogs"), {
    customerId: report.customerId,
    customerName: report.header.customerName,
    phone: report.header.customerPhone,
    vehicleId: report.vehicleId,
    plateNumber: report.header.plateNumber,
    reportId: report.id,
    messageType: "InspectionReport",
    status: "sent",
    message,
    sentAt: Timestamp.now(),
  });
  await markShared(centerId, report.id);
}

// ── Callables ────────────────────────────────────────────────────────────────

export const setReportLinkRevoked = (centerId: string, reportId: string, revoked: boolean) =>
  httpsCallable<{ centerId: string; reportId: string; revoked: boolean }, { shareRevoked: boolean }>(
    functions, "revokeInspectionReportLink",
  )({ centerId, reportId, revoked }).then((r) => r.data);

export const fetchPublicReport = (shareToken: string) =>
  httpsCallable<{ shareToken: string }, PublicInspectionPayload>(functions, "getPublicInspectionReport")({ shareToken }).then((r) => r.data);

export const trackPublicReportView = (shareToken: string) =>
  httpsCallable(functions, "trackInspectionReportView")({ shareToken }).catch(() => {});
