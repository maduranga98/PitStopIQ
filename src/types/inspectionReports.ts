import type { Timestamp } from "firebase/firestore";

// ── Inspection Reports ───────────────────────────────────────────────────────
// Independent of the job-card inspection module (types/auth.ts) and of the
// diagnostic-report attachments (types/diagnosticReports.ts).

export type InspectionReportType = "checklist" | "diagnostic";
export type InspectionReportStatus = "draft" | "finalized";
export type InspectionResultStatus = "meets" | "needs_repair" | "na";

// ── Template (servicecenters/{c}/inspectionTemplates/default) ────────────────

export interface InspectionTemplateItem {
  id: string;
  label: string;
  /** Soft hide — items are never hard-deleted so old snapshots stay valid. */
  hidden: boolean;
  order: number;
  /** true for items that came from the shipped defaults. */
  isDefault: boolean;
  /** Stable key of the shipped default this came from; null for custom items. */
  defaultKey: string | null;
}

export interface InspectionTemplateSection {
  id: string;
  title: string;
  hidden: boolean;
  order: number;
  items: InspectionTemplateItem[];
  /** true for sections that came from the shipped defaults. */
  isDefault: boolean;
}

export interface InspectionTemplate {
  id: string;
  name: string;
  sections: InspectionTemplateSection[];
  /** DEFAULTS_VERSION the center's copy was seeded from. */
  defaultsVersion: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ── Media ────────────────────────────────────────────────────────────────────
// Stored as a MAP keyed by file id (not arrays) so the offline upload queue can
// land a finished upload with a plain dotted-path write — `media.<id>.url` —
// which an array element cannot take.

export type InspectionMediaKind = "photo" | "attachment";

export interface InspectionMediaItem {
  id: string;
  kind: InspectionMediaKind;
  name: string;
  mimeType: "image/jpeg" | "image/png" | "application/pdf";
  sizeBytes: number;
  /** null while the upload is still queued, and after the media expires. */
  url: string | null;
  /** true until the file reaches Storage. */
  pending: boolean;
  /** Set by finalize: finalizedAt + MEDIA_RETENTION_MONTHS. Images only. */
  mediaDeleteAt: Timestamp | null;
  /** Set by dailyStandaloneInspectionCleanup; UI shows "Photo expired". */
  mediaDeleted: boolean;
}

// ── Results ──────────────────────────────────────────────────────────────────

export interface InspectionItemResult {
  status: InspectionResultStatus;
  remark: string;
  /** Keys into InspectionReport.media. */
  photoIds: string[];
}

/** An item added for this report only (optionally also saved to the template). */
export interface InspectionReportOnlyItem {
  id: string;
  sectionId: string;
  label: string;
  order: number;
}

// ── Report (servicecenters/{c}/inspectionReports/{id}) ───────────────────────

export interface InspectionReportHeader {
  customerName: string;
  customerPhone: string;
  plateNumber: string;
  make: string;
  model: string;
  vehicleType: string;
}

export interface InspectionReport {
  id: string;
  centerId: string;
  type: InspectionReportType;
  status: InspectionReportStatus;
  /** "INS-2026-0001", assigned server-side at finalize. null while draft. */
  reportNumber: string | null;

  vehicleId: string;
  customerId: string;
  /** Snapshot taken at creation; later customer/vehicle edits don't change it. */
  header: InspectionReportHeader;
  /** A plain value inside this report. Never written back to the vehicle. */
  mileage: number | null;
  reportDate: Timestamp;

  /** Diagnostic reports: short title + findings summary. */
  title: string;
  findings: string;

  /** Full copy of the template (visible sections only) at creation. */
  templateSnapshot: InspectionTemplateSection[];
  templateDefaultsVersion: number;
  results: Record<string, InspectionItemResult>;
  reportOnlyItems: InspectionReportOnlyItem[];

  media: Record<string, InspectionMediaItem>;
  /** Report-level attachments (keys into `media`), in display order. */
  attachmentIds: string[];

  observations: string;
  recommendations: string;
  disclaimer: string;
  inspectorUid: string | null;
  inspectorName: string;
  signatureName: string;
  /** Technician this draft is assigned to; null = unassigned. */
  assignedToUid: string | null;

  // ── Server-owned (callables / Admin SDK only; rules refuse client writes) ──
  finalizedAt: Timestamp | null;
  pdfUrl: string | null;
  pdfPath: string | null;
  pdfGeneratedAt: Timestamp | null;
  /** Earliest pending mediaDeleteAt; what the cleanup query scans. null = nothing to expire. */
  nextMediaDeleteAt: Timestamp | null;
  shareToken: string;
  shareRevoked: boolean;
  viewedAt: Timestamp | null;
  lastViewedAt: Timestamp | null;
  viewCount: number;

  // ── Owner-editable at any status ───────────────────────────────────────────
  visibleToCustomer: boolean;
  sharedAt: Timestamp | null;

  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Keys clients may never write (mirrored in firestore.rules). */
export const SERVER_OWNED_REPORT_KEYS = [
  "status", "reportNumber", "finalizedAt", "pdfUrl", "pdfPath", "pdfGeneratedAt",
  "nextMediaDeleteAt", "shareToken", "shareRevoked", "viewedAt", "lastViewedAt", "viewCount",
] as const;
