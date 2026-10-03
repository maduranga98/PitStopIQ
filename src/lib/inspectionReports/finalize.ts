// ── Finalize / regenerate PDF / reopen (client side of the callables) ────────
// Every one of these needs a connection; drafts do not. The rules refuse client
// writes to the fields these change, so the callables in
// functions/inspectionReports.js are the only way to finalize.
import { httpsCallable } from "firebase/functions";
import { waitForPendingWrites } from "firebase/firestore";
import { db, functions } from "../../config/firebase";
import { finalizeBlockers } from "../../../functions/shared/inspectionHelpers.mjs";
import type { InspectionReport } from "../../types/inspectionReports";

/** Why this draft can't be finalized yet; the same check the server runs. */
export const reportFinalizeBlockers = (report: InspectionReport): string[] => finalizeBlockers(report);

export interface FinalizeResult { reportNumber: string; pdfUrl: string | null; pdfReady: boolean }

/** Let queued local edits reach the server first — the callable validates the
 *  server's copy, not this device's. Bounded: a stalled connection must not hang the button. */
async function syncPendingEdits(timeoutMs = 15000): Promise<void> {
  await Promise.race([
    waitForPendingWrites(db),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Still syncing your changes. Check your connection and try again.")), timeoutMs)),
  ]);
}

const call = <T>(name: string, centerId: string, reportId: string) =>
  httpsCallable<{ centerId: string; reportId: string }, T>(functions, name)({ centerId, reportId }).then((r) => r.data);

export async function finalizeReport(centerId: string, reportId: string): Promise<FinalizeResult> {
  await syncPendingEdits();
  return call<FinalizeResult>("finalizeInspectionReport", centerId, reportId);
}

export const regenerateReportPdf = (centerId: string, reportId: string) =>
  call<{ pdfUrl: string }>("regenerateInspectionReportPdf", centerId, reportId);

export const reopenReport = (centerId: string, reportId: string) =>
  call<{ ok: true }>("reopenInspectionReport", centerId, reportId);
