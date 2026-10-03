// ── Report drafts ────────────────────────────────────────────────────────────
//
// Everything a draft needs to work offline: ids are minted client-side, writes
// go through the safe* helpers (resolve once committed locally), and edits are
// dotted-path patches so two fields edited in the same second don't overwrite
// each other. No transactions. The server-owned half of the document (number,
// PDF, share/view tracking, lifecycle) is only ever written by the callables
// in later phases; createDraftReport writes those fields as explicit nulls
// because the rules require them present and empty.
import {
  Timestamp, doc, limit, orderBy, query, startAfter, where,
  type DocumentData, type QueryDocumentSnapshot,
} from "firebase/firestore";
import { deleteObject, ref as storageRef } from "firebase/storage";
import { storage } from "../../config/firebase";
import { boundedGetDocs } from "../firestoreRead";
import { safeDeleteDoc, safeSetDoc, safeUpdateDoc } from "../firestoreWrite";
import { DEFAULT_REPORT_DISCLAIMER, REPORT_PAGE_SIZE } from "../../constants/inspectionReports";
import { DIAGNOSTIC_QUICK_CHECK_SECTION_ID } from "../../constants/defaultInspectionChecklist";
import {
  inspectionMediaStoragePath, inspectionPdfStoragePath, inspectionReportDoc, inspectionReportsCollection,
} from "./paths";
import { visibleSections } from "./templateOps";
import type {
  InspectionMediaItem, InspectionReport, InspectionReportHeader, InspectionReportType,
  InspectionTemplate, InspectionTemplateSection,
} from "../../types/inspectionReports";

const TOKEN_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** 32-char random share token (used from Phase 6; minted now because the rules
 *  require it on create and it can never change afterwards). */
export function generateInspectionShareToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => TOKEN_CHARS[b % TOKEN_CHARS.length]).join("");
}

/** What a new report snapshots from the template. A diagnostic report carries
 *  only the quick-check section. */
export function snapshotForType(
  template: Pick<InspectionTemplate, "sections">,
  type: InspectionReportType,
): InspectionTemplateSection[] {
  const visible = visibleSections(template.sections);
  return type === "diagnostic"
    ? visible.filter((s) => s.id === DIAGNOSTIC_QUICK_CHECK_SECTION_ID)
    : visible;
}

export interface CreateDraftInput {
  centerId: string;
  type: InspectionReportType;
  vehicleId: string;
  customerId: string;
  header: InspectionReportHeader;
  mileage: number | null;
  template: Pick<InspectionTemplate, "sections" | "defaultsVersion">;
  createdBy: string;
  inspectorUid: string | null;
  inspectorName: string;
  assignedToUid: string | null;
  assignedToName: string;
}

export async function createDraftReport(input: CreateDraftInput): Promise<string> {
  const ref = doc(inspectionReportsCollection(input.centerId));
  const now = Timestamp.now();
  const report: Omit<InspectionReport, "id"> = {
    centerId: input.centerId,
    type: input.type,
    status: "draft",
    reportNumber: null,
    vehicleId: input.vehicleId,
    customerId: input.customerId,
    header: input.header,
    mileage: input.mileage,
    reportDate: now,
    title: "",
    findings: "",
    templateSnapshot: snapshotForType(input.template, input.type),
    templateDefaultsVersion: input.template.defaultsVersion,
    results: {},
    reportOnlyItems: [],
    media: {},
    attachmentIds: [],
    observations: "",
    recommendations: "",
    disclaimer: DEFAULT_REPORT_DISCLAIMER,
    inspectorUid: input.inspectorUid,
    inspectorName: input.inspectorName,
    signatureName: "",
    assignedToUid: input.assignedToUid,
    assignedToName: input.assignedToName,
    finalizedAt: null,
    pdfUrl: null,
    pdfPath: null,
    pdfGeneratedAt: null,
    nextMediaDeleteAt: null,
    shareToken: generateInspectionShareToken(),
    shareRevoked: false,
    viewedAt: null,
    lastViewedAt: null,
    viewCount: 0,
    visibleToCustomer: true,
    sharedAt: null,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
  await safeSetDoc(ref, report);
  return ref.id;
}

/** Apply a dotted-path patch to a draft. `updatedAt` rides along. */
export async function patchReport(
  centerId: string, reportId: string, patch: Record<string, unknown>,
): Promise<void> {
  await safeUpdateDoc(inspectionReportDoc(centerId, reportId), { ...patch, updatedAt: Timestamp.now() });
}

// ── Keys for dotted-path patches (ids are dot-free, see defaultItemId) ───────

export const resultKey = (itemId: string, field: "status" | "remark" | "photoIds") => `results.${itemId}.${field}`;
export const mediaKey = (mediaId: string) => `media.${mediaId}`;

// ── Lists ────────────────────────────────────────────────────────────────────

export type ReportListTab = "draft" | "finalized";

export interface ReportPage {
  reports: InspectionReport[];
  cursor: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
}

/**
 * One page (REPORT_PAGE_SIZE) of reports, newest first, resumable from `cursor`.
 * Never a listener: a staff list is read on demand, not kept live.
 *
 * A technician can only read reports assigned to them (rules), so their query
 * must carry the assignedToUid filter — a wider one is rejected outright.
 */
export async function fetchReportsPage(
  centerId: string,
  opts: { tab: ReportListTab; technicianUid?: string; cursor?: QueryDocumentSnapshot<DocumentData> | null },
): Promise<ReportPage> {
  const col = inspectionReportsCollection(centerId);
  const constraints = opts.technicianUid
    ? [where("assignedToUid", "==", opts.technicianUid), orderBy("updatedAt", "desc")]
    : opts.tab === "draft"
      ? [where("status", "==", "draft"), orderBy("updatedAt", "desc")]
      : [where("status", "==", "finalized"), orderBy("finalizedAt", "desc")];
  const q = query(
    col, ...constraints,
    ...(opts.cursor ? [startAfter(opts.cursor)] : []),
    limit(REPORT_PAGE_SIZE),
  );
  const snap = await boundedGetDocs(q);
  return {
    reports: snap.docs.map((d) => ({ id: d.id, ...d.data() } as InspectionReport)),
    cursor: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
    hasMore: snap.docs.length === REPORT_PAGE_SIZE,
  };
}

// ── Delete (Owner only, enforced by rules) ───────────────────────────────────

/** Removes the report's Storage objects (best effort), then the document. */
export async function deleteReportWithMedia(
  centerId: string, reportId: string, media: Record<string, InspectionMediaItem>,
): Promise<void> {
  await Promise.allSettled([
    ...Object.keys(media).map((id) => deleteObject(storageRef(storage, inspectionMediaStoragePath(centerId, reportId, id)))),
    deleteObject(storageRef(storage, inspectionPdfStoragePath(centerId, reportId))),
  ]);
  await safeDeleteDoc(inspectionReportDoc(centerId, reportId));
}

/** One page of a vehicle's reports, newest first (drafts and finalized), for the vehicle's history. */
export async function fetchVehicleReportsPage(
  centerId: string, vehicleId: string, cursor?: QueryDocumentSnapshot<DocumentData> | null,
): Promise<ReportPage> {
  const snap = await boundedGetDocs(query(
    inspectionReportsCollection(centerId),
    where("vehicleId", "==", vehicleId), orderBy("createdAt", "desc"),
    ...(cursor ? [startAfter(cursor)] : []),
    limit(REPORT_PAGE_SIZE),
  ));
  return {
    reports: snap.docs.map((d) => ({ id: d.id, ...d.data() } as InspectionReport)),
    cursor: snap.docs.length ? snap.docs[snap.docs.length - 1] : null,
    hasMore: snap.docs.length === REPORT_PAGE_SIZE,
  };
}
