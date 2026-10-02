import { collection, doc } from "firebase/firestore";
import { db } from "../../config/firebase";
import { TEMPLATE_DOC_ID } from "../../constants/inspectionReports";

// ── Feature gate ─────────────────────────────────────────────────────────────

/** No plan check, on purpose: every center with the switch on gets the module. */
export function inspectionReportsModuleEnabled(
  center: { standaloneInspectionEnabled?: boolean } | null | undefined,
): boolean {
  return center?.standaloneInspectionEnabled === true;
}

// ── Firestore paths ──────────────────────────────────────────────────────────

export const inspectionReportsCollection = (centerId: string) =>
  collection(db, "servicecenters", centerId, "inspectionReports");

export const inspectionReportDoc = (centerId: string, reportId: string) =>
  doc(db, "servicecenters", centerId, "inspectionReports", reportId);

export const inspectionTemplatesCollection = (centerId: string) =>
  collection(db, "servicecenters", centerId, "inspectionTemplates");

export const inspectionTemplateDoc = (centerId: string, templateId: string = TEMPLATE_DOC_ID) =>
  doc(db, "servicecenters", centerId, "inspectionTemplates", templateId);

// ── Storage paths ────────────────────────────────────────────────────────────
// Mirrored in storage.rules and functions/inspectionReports.js.

export const inspectionMediaStoragePath = (centerId: string, reportId: string, fileId: string) =>
  `inspectionReports/${centerId}/${reportId}/${fileId}`;

/** Written by the finalize callable with the Admin SDK; not client-writable. */
export const inspectionPdfStoragePath = (centerId: string, reportId: string) =>
  `inspectionReports/${centerId}/${reportId}/report.pdf`;
