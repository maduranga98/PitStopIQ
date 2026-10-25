// Standalone post-service checklists — filled in with no job card behind them,
// at servicecenters/{centerId}/postServiceChecklists/{id}. The data layer for
// the entry screen, the fill form and the history list.
//
// A record is created on its first save (the id is generated up front), so
// opening the form and walking away leaves nothing behind. The security rules
// (firestore.rules → postServiceChecklists) are the other half of every
// sign-off rule here: a signed-off record is frozen and the signer must be the
// person writing it.
import {
  collection, doc, limit, orderBy, query, serverTimestamp, Timestamp,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { boundedGetDoc, boundedGetDocs } from "./firestoreRead";
import { safeDeleteDoc, safeSetDoc, safeUpdateDoc } from "./firestoreWrite";
import type {
  FilledChecklistSection, PostServiceChecklistTemplate, StandalonePostServiceChecklist,
} from "../types/auth";
import { templateSections } from "./checklistSections";
import {
  allRated, buildFilledSections, cleanFilled, MAX_REMARKS, normalizeHeader,
  type StandaloneHeaderInput,
} from "./checklistFill";

export const HISTORY_LIMIT = 200;

export const standaloneCollection = (centerId: string) =>
  collection(db, "servicecenters", centerId, "postServiceChecklists");

export const standaloneDoc = (centerId: string, id: string) =>
  doc(db, "servicecenters", centerId, "postServiceChecklists", id);

/** An id for a record that does not exist yet (nothing is written). */
export const newStandaloneId = (centerId: string) => doc(standaloneCollection(centerId)).id;

/** The sections a brand-new record starts from, snapshotted off a template. */
export function startingSections(template: PostServiceChecklistTemplate): FilledChecklistSection[] {
  return buildFilledSections(templateSections(template));
}

interface Content {
  header: StandaloneHeaderInput;
  /** The day the work was done. */
  date: Date;
  sections: FilledChecklistSection[];
  remarks: string;
}

function contentFields(c: Content) {
  return {
    ...normalizeHeader(c.header),
    date: Timestamp.fromDate(c.date),
    sections: cleanFilled(c.sections),
    remarks: c.remarks.trim().slice(0, MAX_REMARKS) || null,
  };
}

/** First save: snapshots the template (name, roles, sections) and records who started it. */
export async function createStandalone(
  centerId: string,
  id: string,
  template: PostServiceChecklistTemplate,
  createdBy: string,
  content: Content,
): Promise<void> {
  await safeSetDoc(standaloneDoc(centerId, id), {
    templateId: template.id,
    templateName: template.name,
    allowedRoles: template.allowedRoles,
    assignedTo: template.defaultAssignee ?? null,
    ...contentFields(content),
    completedBy: null,
    completedAt: null,
    createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** Saves the work so far on an open record. */
export async function saveStandalone(centerId: string, id: string, content: Content): Promise<void> {
  await safeUpdateDoc(standaloneDoc(centerId, id), {
    ...contentFields(content),
    updatedAt: serverTimestamp(),
  });
}

/** Results and sign-off in one write; refuses a report with any line unrated. */
export async function completeStandalone(
  centerId: string, id: string, content: Content, completedBy: string,
): Promise<void> {
  if (!allRated(content.sections)) {
    throw new Error("Every check has to be rated before the checklist can be completed.");
  }
  await safeUpdateDoc(standaloneDoc(centerId, id), {
    ...contentFields(content),
    completedBy,
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** Hands an open record to someone else (Owner/Manager — enforced by the rules). */
export async function reassignStandalone(centerId: string, id: string, assignedTo: string | null): Promise<void> {
  await safeUpdateDoc(standaloneDoc(centerId, id), { assignedTo, updatedAt: serverTimestamp() });
}

/**
 * Records that the report was sent to the customer. Owner/Manager, on a
 * signed-off record, and once only — the rules refuse a second write, and a
 * sent record can never be deleted. Callers skip this for a record already sent.
 */
export async function markChecklistSent(centerId: string, id: string, uid: string): Promise<void> {
  await safeUpdateDoc(standaloneDoc(centerId, id), {
    sentToCustomer: true,
    sentAt: Timestamp.now(),
    sentBy: uid,
    updatedAt: serverTimestamp(),
  });
}

/** Owner only, and never once it has been sent to the customer (both enforced by the rules). */
export async function deleteStandalone(centerId: string, id: string): Promise<void> {
  await safeDeleteDoc(standaloneDoc(centerId, id));
}

export async function fetchStandalone(centerId: string, id: string): Promise<StandalonePostServiceChecklist | null> {
  const snap = await boundedGetDoc(standaloneDoc(centerId, id));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as StandalonePostServiceChecklist) : null;
}

/** Newest first, capped — the history list never reads the whole collection. */
export async function fetchRecentStandalone(centerId: string): Promise<StandalonePostServiceChecklist[]> {
  const snap = await boundedGetDocs(
    query(standaloneCollection(centerId), orderBy("createdAt", "desc"), limit(HISTORY_LIMIT)),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as StandalonePostServiceChecklist));
}

/**
 * What a record is about, for lists: the plate, and who it was for when known.
 * On-file vehicles and customers are looked up by id in what the caller already
 * loaded; typed-in ones are read straight off the record.
 */
export function checklistSubject(
  r: StandalonePostServiceChecklist,
  plateById: Map<string, string> = new Map(),
  nameById: Map<string, string> = new Map(),
): string {
  const plate = r.plateNumberManual || (r.vehicleId ? plateById.get(r.vehicleId) : "") || "Vehicle on file";
  const who = r.customerNameManual || (r.customerId ? nameById.get(r.customerId) : "") || "";
  return who ? `${plate} · ${who}` : plate;
}
