// ── Diagnostic report attachments ───────────────────────────────────────────
//
// OBD scan reports (PDF exports from Launch X-431 / Autel / etc., or photos
// of the scanner screen) attached to a job or, standalone, to a vehicle, and
// shared with the customer via a public /r/:shareToken link. No structured
// DTC entry in this phase — file attachment only.
//
// The module is gated by `diagnosticReportsEnabled` on the center document,
// checked once at bootstrap (see store/diagnosticReportsSlice.ts) rather than
// on every render. Turning the module off never touches existing data or
// share links — see reportsModuleEnabled below and the matching rule in
// firestore.rules.
import {
  collection, doc, getDocs, limit, orderBy, query, serverTimestamp, where,
  type DocumentData, type QueryDocumentSnapshot,
} from "firebase/firestore";
import { ref as storageRef, deleteObject } from "firebase/storage";
import { db, storage } from "../config/firebase";
import { boundedGetDoc, boundedGetDocs } from "./firestoreRead";
import { safeSetDoc, safeUpdateDoc, safeDeleteDoc } from "./firestoreWrite";
import type {
  DiagnosticReport, DiagnosticReportType, DiagnosticReportFileType,
} from "../types/diagnosticReports";

// ── Feature gating ──────────────────────────────────────────────────────────

/** Available on both plans — no plan gate, just the center's own toggle. */
export function reportsModuleEnabled(center: { diagnosticReportsEnabled?: boolean }): boolean {
  return center.diagnosticReportsEnabled === true;
}

// ── Paths ───────────────────────────────────────────────────────────────────

export const reportsCollection = (centerId: string) =>
  collection(db, "servicecenters", centerId, "diagnosticReports");

export const reportDoc = (centerId: string, reportId: string) =>
  doc(db, "servicecenters", centerId, "diagnosticReports", reportId);

const reportCounterDoc = (centerId: string) =>
  doc(db, "servicecenters", centerId, "counters", "diagnosticReports");

export function reportStoragePath(centerId: string, vehicleId: string, reportId: string, ext: string) {
  return `diagnosticReports/${centerId}/${vehicleId}/${reportId}.${ext}`;
}

export function reportThumbnailStoragePath(centerId: string, vehicleId: string, reportId: string) {
  return `diagnosticReports/${centerId}/${vehicleId}/${reportId}_thumb.jpg`;
}

// ── Report numbering ─────────────────────────────────────────────────────────
//
// DIAG-YYYY-NNNN, per-center per-year. Deliberately not a client
// runTransaction: the scan happens in the service bay on a flaky connection,
// and a transaction requires a live server round trip — the exact hang the
// safe* write helpers exist to prevent (see saveTemplate in
// postServiceChecklist.ts for the same trade-off, made the same way). This
// reads the counter best-effort (falling back to the offline cache), bumps it
// locally and writes it back with a normal merge write. Two devices minting a
// number offline at once can collide; flagDuplicateReportNumber in Cloud
// Functions flags the later one exactly like flagDuplicateInvoiceNumber does
// for invoices, so a human can renumber it rather than the system silently
// guessing.
export async function nextReportNumber(centerId: string): Promise<string> {
  const year = new Date().getFullYear();
  const ref = reportCounterDoc(centerId);
  let seq: number;
  try {
    const snap = await boundedGetDoc(ref);
    const data = snap.exists() ? snap.data() : undefined;
    seq = data?.year === year ? (Number(data.seq) || 0) + 1 : 1;
  } catch {
    // Offline with nothing cached yet — start at 1 and let the dedupe
    // trigger catch any collision once this syncs.
    seq = 1;
  }
  await safeSetDoc(ref, { year, seq }, { merge: true });
  return `DIAG-${year}-${String(seq).padStart(4, "0")}`;
}

// ── Share tokens ─────────────────────────────────────────────────────────────

const TOKEN_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** 32-char random token. crypto.getRandomValues is available in every browser
 *  this PWA targets, so this never falls back to Math.random. */
export function generateShareToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => TOKEN_CHARS[b % TOKEN_CHARS.length]).join("");
}

// ── Titles / defaults ────────────────────────────────────────────────────────

export const REPORT_TYPE_LABEL: Record<DiagnosticReportType, string> = {
  pre: "Pre-Repair Scan",
  post: "Post-Repair Scan",
  standalone: "Diagnostic Scan",
};

/** Default report type for the upload sheet, based on the job it is opened
 *  from — pending/in_progress jobs are scanned before work starts. */
export function defaultReportType(jobStatus?: string): DiagnosticReportType {
  if (jobStatus === "pending" || jobStatus === "in_progress") return "pre";
  if (jobStatus === "done" || jobStatus === "delivered") return "post";
  return "standalone";
}

export function defaultReportTitle(type: DiagnosticReportType): string {
  return REPORT_TYPE_LABEL[type];
}

export function fileTypeFor(mimeType: string): DiagnosticReportFileType {
  return mimeType === "application/pdf" ? "pdf" : "image";
}

// ── Scan tool autocomplete ───────────────────────────────────────────────────

const LAST_SCAN_TOOL_KEY = "pitstopiq.diagnosticReports.lastScanTool";

export function lastUsedScanTool(centerId: string): string | null {
  try {
    return localStorage.getItem(`${LAST_SCAN_TOOL_KEY}.${centerId}`);
  } catch {
    return null;
  }
}

export function rememberScanTool(centerId: string, scanTool: string) {
  try {
    localStorage.setItem(`${LAST_SCAN_TOOL_KEY}.${centerId}`, scanTool);
  } catch {
    // Storage may be unavailable (private browsing); losing the memory of
    // the last tool used is a small inconvenience, not a failure worth
    // surfacing.
  }
}

/** Previously used scan tool names for this center, most recent first —
 *  what the upload sheet's combobox autocompletes against. */
export async function fetchScanToolSuggestions(centerId: string): Promise<string[]> {
  const snap = await boundedGetDocs(
    query(reportsCollection(centerId), orderBy("createdAt", "desc"), limit(50)),
  );
  const seen = new Set<string>();
  const tools: string[] = [];
  for (const d of snap.docs) {
    const tool = (d.data() as DocumentData).scanTool as string | null | undefined;
    if (tool && !seen.has(tool)) {
      seen.add(tool);
      tools.push(tool);
    }
  }
  return tools;
}

// ── Reads ───────────────────────────────────────────────────────────────────

function reportFromSnap(snap: QueryDocumentSnapshot<DocumentData>): DiagnosticReport {
  return { id: snap.id, ...snap.data() } as DiagnosticReport;
}

function sortNewestFirst(reports: DiagnosticReport[]): DiagnosticReport[] {
  return [...reports].sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
}

export async function fetchReportsForJob(centerId: string, serviceId: string): Promise<DiagnosticReport[]> {
  const snap = await boundedGetDocs(
    query(reportsCollection(centerId), where("serviceId", "==", serviceId)),
  );
  return sortNewestFirst(snap.docs.map(reportFromSnap));
}

/** Every report for a vehicle, job-linked and standalone together. */
export async function fetchReportsForVehicle(centerId: string, vehicleId: string): Promise<DiagnosticReport[]> {
  const snap = await boundedGetDocs(
    query(reportsCollection(centerId), where("vehicleId", "==", vehicleId)),
  );
  return sortNewestFirst(snap.docs.map(reportFromSnap));
}

/** Only the shared ones — what the vehicle QR history page shows a customer. */
export async function fetchPublicReportsForVehicle(centerId: string, vehicleId: string): Promise<DiagnosticReport[]> {
  const reports = await fetchReportsForVehicle(centerId, vehicleId);
  return reports.filter((r) => r.isPublic);
}

export async function countReports(centerId: string): Promise<number> {
  const snap = await getDocs(reportsCollection(centerId));
  return snap.size;
}

// ── Writes ──────────────────────────────────────────────────────────────────

export interface CreateReportInput {
  centerId: string;
  serviceId: string | null;
  vehicleId: string;
  customerId: string;
  reportType: DiagnosticReportType;
  title: string;
  scanTool: string | null;
  notes: string | null;
  fileName: string;
  fileType: DiagnosticReportFileType;
  fileSizeBytes: number;
  /** null when the upload is still queued offline. */
  fileUrl: string | null;
  uploadPending: boolean;
  uploadedBy: string;
  uploadedByName: string;
}

/** Creates the Firestore document. The caller (the upload sheet) owns getting
 *  the file to Storage — directly when online, through the offline queue
 *  (lib/photoUploadQueue.ts) when not — so this never blocks on the upload
 *  itself. */
export async function createDiagnosticReport(input: CreateReportInput): Promise<DiagnosticReport> {
  const ref = doc(reportsCollection(input.centerId));
  const reportNumber = await nextReportNumber(input.centerId);
  const report: Omit<DiagnosticReport, "id"> = {
    centerId: input.centerId,
    serviceId: input.serviceId,
    vehicleId: input.vehicleId,
    customerId: input.customerId,
    reportNumber,
    reportType: input.reportType,
    title: input.title.trim() || defaultReportTitle(input.reportType),
    scanTool: input.scanTool?.trim() || null,
    fileUrl: input.fileUrl,
    fileType: input.fileType,
    fileName: input.fileName,
    fileSizeBytes: input.fileSizeBytes,
    thumbnailUrl: null,
    shareToken: generateShareToken(),
    isPublic: true,
    viewCount: 0,
    lastViewedAt: null,
    uploadedBy: input.uploadedBy,
    uploadedByName: input.uploadedByName,
    notes: input.notes?.trim() || null,
    uploadPending: input.uploadPending,
    createdAt: serverTimestamp() as unknown as DiagnosticReport["createdAt"],
  };
  await safeSetDoc(ref, report, { merge: true });
  if (input.scanTool?.trim()) rememberScanTool(input.centerId, input.scanTool.trim());
  return { id: ref.id, ...report };
}

export async function renameReport(centerId: string, reportId: string, title: string): Promise<void> {
  await safeUpdateDoc(reportDoc(centerId, reportId), { title: title.trim() });
}

export async function setReportPublic(centerId: string, reportId: string, isPublic: boolean): Promise<void> {
  await safeUpdateDoc(reportDoc(centerId, reportId), { isPublic });
}

/** Marks a queued upload as landed — called once the offline queue actually
 *  reaches Storage for this report (see the "diagnosticReport" case in
 *  lib/photoUploadQueue.ts). */
export async function markReportUploaded(centerId: string, reportId: string, fileUrl: string): Promise<void> {
  await safeUpdateDoc(reportDoc(centerId, reportId), { fileUrl, uploadPending: false });
}

/** Deletes the Firestore document and its Storage object(s). The thumbnail,
 *  if any, is best-effort — a report missing its thumbnail is harmless, a
 *  delete that fails because the thumbnail delete failed is not. */
export async function deleteReport(report: DiagnosticReport): Promise<void> {
  const ext = report.fileType === "pdf" ? "pdf" : (report.fileName.split(".").pop() || "jpg");
  const filePath = reportStoragePath(report.centerId, report.vehicleId, report.id, ext);
  const thumbPath = reportThumbnailStoragePath(report.centerId, report.vehicleId, report.id);
  await Promise.allSettled([
    deleteObject(storageRef(storage, filePath)),
    report.thumbnailUrl ? deleteObject(storageRef(storage, thumbPath)) : Promise.resolve(),
  ]);
  await safeDeleteDoc(reportDoc(report.centerId, report.id));
}

// ── WhatsApp share ───────────────────────────────────────────────────────────

export function publicReportUrl(shareToken: string): string {
  return `https://app.pitstopiq.com/r/${shareToken}`;
}

export function buildWhatsAppShareMessage(report: {
  centerName: string; plateNumber: string; title: string; dateLabel: string; shareToken: string;
}): string {
  return [
    report.centerName,
    `${report.plateNumber} — ${report.title}`,
    report.dateLabel,
    `View report: ${publicReportUrl(report.shareToken)}`,
  ].join("\n");
}

export function whatsAppShareLink(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}
