// ── Inspection Reports: limits and retention ─────────────────────────────────
//
// Every tunable number for the module lives here so a product change is a
// one-line edit. Server code (functions/inspectionReports.js) keeps its own
// copy of the few values it needs, marked "mirrors src/constants/
// inspectionReports.ts", because functions/ deploys as its own package.

export const INSPECTION_REPORT_NUMBER_PREFIX = "INS";

/** Attachments (PDF / JPG / PNG) per report. Checklist photos are separate. */
export const MAX_ATTACHMENTS_PER_REPORT = 10;

/** Per file, attachments and photos alike. Mirrored in storage.rules. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export const ATTACHMENT_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export type AttachmentMimeType = (typeof ATTACHMENT_MIME_TYPES)[number];

/** Longest side of a stored photo, after EXIF fix and resize. */
export const PHOTO_MAX_DIMENSION_PX = 1600;
export const PHOTO_JPEG_QUALITY = 0.8;

/** Images are deleted this many months after the report is finalized. Report
 *  text and the generated PDF are kept permanently. */
export const MEDIA_RETENTION_MONTHS = 12;

/** List pages (staff list, vehicle history, customer portal). */
export const REPORT_PAGE_SIZE = 20;

export const REPORT_TYPES = ["checklist", "diagnostic"] as const;
export const REPORT_STATUSES = ["draft", "finalized"] as const;
export const RESULT_STATUSES = ["meets", "needs_repair", "na"] as const;

export const DEFAULT_REPORT_DISCLAIMER =
  "This report records a visual and functional check of the vehicle at the time of " +
  "inspection. It is not a warranty or a guarantee of future performance, and it does " +
  "not cover defects that could not be seen or tested during the inspection.";

/** The one template per center lives at inspectionTemplates/{TEMPLATE_DOC_ID}. */
export const TEMPLATE_DOC_ID = "default";

/** Longest section title / checklist item label a center can enter. */
export const MAX_TEMPLATE_LABEL_LENGTH = 200;
