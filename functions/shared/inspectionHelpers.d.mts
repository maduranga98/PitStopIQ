// Types for shared/inspectionHelpers.mjs (hand-written, like phone.d.mts).
export declare const MEDIA_RETENTION_MONTHS: 12;
export declare const REPORT_NUMBER_PREFIX: "INS";
export declare const REPORT_TIME_ZONE: "Asia/Colombo";
export declare function addMonths(date: Date, n: number): Date;
export declare function yearInZone(date: Date, timeZone?: string): number;
export declare function formatReportNumber(year: number, seq: number): string;

export interface FinalizableReport {
  type?: string;
  title?: string;
  templateSnapshot?: Array<{ items?: Array<{ id: string }> }>;
  reportOnlyItems?: Array<{ id: string }>;
  results?: Record<string, { status?: string | null } | undefined>;
  media?: Record<string, { pending?: boolean; url?: string | null; mediaDeleted?: boolean; mimeType?: string } | undefined>;
}
export declare function checklistItemIds(report: FinalizableReport): string[];
export declare function unansweredItemCount(report: FinalizableReport): number;
export declare function needsRepairCount(report: FinalizableReport): number;
export declare function pendingMediaCount(report: FinalizableReport): number;
export declare function finalizeBlockers(report: FinalizableReport): string[];
export declare function mediaDeleteAt(item: { mimeType?: string } | undefined, finalizedAt: Date, months?: number): Date | null;
export declare function pdfSafe(text: string | null | undefined): string;
export declare function isStorageDownloadUrl(url: unknown, opts?: { allowEmulator?: boolean }): boolean;
