import type { Timestamp } from "firebase/firestore";

export type DiagnosticReportType = "pre" | "post" | "standalone";
export type DiagnosticReportFileType = "pdf" | "image";

/**
 * An OBD scan report (PDF export or photo of the scanner screen) attached to
 * a job or, standalone, to a vehicle. Lives at
 * servicecenters/{centerId}/diagnosticReports/{reportId}.
 *
 * No structured DTC data in this phase — file attachment only.
 */
export interface DiagnosticReport {
  id: string;
  centerId: string;
  /** null = standalone, not tied to a job. */
  serviceId: string | null;
  vehicleId: string;
  customerId: string;

  /** "DIAG-2026-0087" */
  reportNumber: string;
  reportType: DiagnosticReportType;
  title: string;
  scanTool: string | null;

  /** null while an offline upload is queued. */
  fileUrl: string | null;
  fileType: DiagnosticReportFileType;
  fileName: string;
  fileSizeBytes: number;
  /** First-page render, PDF only. */
  thumbnailUrl: string | null;

  /** 32-char random, unique — the public /r/:shareToken lookup key. */
  shareToken: string;
  isPublic: boolean;
  viewCount: number;
  lastViewedAt: Timestamp | null;

  uploadedBy: string;
  uploadedByName: string;
  notes: string | null;
  /** true until the file reaches Storage. */
  uploadPending: boolean;
  createdAt: Timestamp;
}

/** What the upload sheet collects before a DiagnosticReport document exists. */
export interface DiagnosticReportDraft {
  file: File;
  reportType: DiagnosticReportType;
  title: string;
  scanTool: string | null;
  notes: string | null;
}
