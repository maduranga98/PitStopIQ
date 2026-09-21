import {
  collection, doc, serverTimestamp, Timestamp, type FieldValue,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { safeAddDoc, safeSetDoc, safeUpdateDoc, safeWriteBatch } from "./firestoreWrite";
import { normalizePhone } from "./utils";
import {
  MAX_TRACKED_CALLS,
  type CallOutcome, type Lead, type LeadDraft, type LeadStage, type LeadTag,
} from "../types/leads";

/**
 * Writes for the super-admin sales pipeline. Every one of these is a
 * top-level `leads` document (rules: super admin only), with the call log in
 * a `calls` sub-collection underneath it so a lead with a long history costs
 * nothing to list on the board.
 */

export const leadsCollection = () => collection(db, "leads");
export const leadDoc = (leadId: string) => doc(db, "leads", leadId);
export const leadCalls = (leadId: string) => collection(db, "leads", leadId, "calls");

export interface AdminIdentity {
  id: string;
  name: string;
}

/** Blank strings are dropped rather than stored, so a lead carries only what it has. */
function trimmedFields(draft: LeadDraft) {
  const text = (v?: string | null) => (v ?? "").trim();
  return {
    businessName: text(draft.businessName),
    contactName: text(draft.contactName),
    phone: text(draft.phone),
    // Kept alongside the typed number so a lookup or a duplicate check never
    // depends on how the number happened to be written down.
    phoneKey: draft.phone ? normalizePhone(draft.phone) : "",
    email: text(draft.email),
    city: text(draft.city),
    district: text(draft.district),
    source: text(draft.source),
    stage: draft.stage,
    callCount: Math.min(MAX_TRACKED_CALLS, Math.max(0, Math.round(draft.callCount || 0))),
    tags: Array.from(new Set(draft.tags ?? [])),
    demoRequested: draft.demoRequested === true,
    nextFollowUp: text(draft.nextFollowUp) || null,
    notes: text(draft.notes),
  };
}

export async function createLead(draft: LeadDraft, admin: AdminIdentity): Promise<string> {
  const ref = await safeAddDoc(leadsCollection(), {
    ...trimmedFields(draft),
    convertedCenterId: null,
    lastCallAt: null,
    createdBy: admin.id,
    createdByName: admin.name,
    // Client timestamps, like every other list in the app: a serverTimestamp
    // reads back as null until the server acks, and the board orders by this.
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  return ref.id;
}

/**
 * The spreadsheet import. One batch per chunk rather than one write per row:
 * a 300-row sheet is 300 round trips otherwise, and Firestore caps a batch at
 * 500 writes regardless.
 */
const IMPORT_CHUNK = 400;

export async function createLeads(drafts: LeadDraft[], admin: AdminIdentity): Promise<number> {
  for (let i = 0; i < drafts.length; i += IMPORT_CHUNK) {
    const chunk = drafts.slice(i, i + IMPORT_CHUNK);
    await safeWriteBatch(`${chunk.length} leads`, (batch) => {
      for (const draft of chunk) {
        batch.set(doc(leadsCollection()), {
          ...trimmedFields(draft),
          convertedCenterId: null,
          lastCallAt: null,
          importedAt: Timestamp.now(),
          createdBy: admin.id,
          createdByName: admin.name,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
      }
    });
  }
  return drafts.length;
}

export async function updateLead(leadId: string, draft: LeadDraft): Promise<void> {
  await safeUpdateDoc(leadDoc(leadId), {
    ...trimmedFields(draft),
    updatedAt: serverTimestamp(),
  });
}

/** Dragging a card between columns — the stage and nothing else. */
export async function setLeadStage(leadId: string, stage: LeadStage): Promise<void> {
  await safeUpdateDoc(leadDoc(leadId), { stage, updatedAt: serverTimestamp() });
}

/** The dropdown on the card: back-fills calls that were never logged one by one. */
export async function setLeadCallCount(leadId: string, callCount: number): Promise<void> {
  await safeUpdateDoc(leadDoc(leadId), {
    callCount: Math.min(MAX_TRACKED_CALLS, Math.max(0, Math.round(callCount || 0))),
    updatedAt: serverTimestamp(),
  });
}

export interface CallEntry {
  outcome: CallOutcome;
  tags: LeadTag[];
  note: string;
}

/**
 * Logs one call and moves the lead on with it.
 *
 * The lead's own counters are derived here rather than read back afterwards:
 * the call count goes up by one, the tags raised on the call join the lead's,
 * and a "wants a demo" outcome both flags the lead and pulls it into the Demo
 * column — that is the whole point of recording the outcome. A stage that is
 * already further along (negotiation, won) is never pulled backwards.
 */
export async function logLeadCall(
  lead: Lead,
  entry: CallEntry,
  admin: AdminIdentity,
): Promise<void> {
  const callNumber = (lead.callCount ?? 0) + 1;
  const tags = Array.from(new Set([...(lead.tags ?? []), ...entry.tags]));
  const wantsDemo = entry.outcome === "demo_requested";

  const leadUpdate: Record<string, unknown | FieldValue> = {
    callCount: Math.min(MAX_TRACKED_CALLS, callNumber),
    tags,
    lastCallAt: Timestamp.now(),
    updatedAt: serverTimestamp(),
  };
  if (wantsDemo) leadUpdate.demoRequested = true;

  const nextStage = stageAfterCall(lead.stage, entry.outcome);
  if (nextStage !== lead.stage) leadUpdate.stage = nextStage;

  // One batch: the log entry and the counters it moves land together, so the
  // board can never show four calls against a log that holds three.
  await safeWriteBatch(`call on ${lead.businessName}`, (batch) => {
    batch.set(doc(leadCalls(lead.id)), {
      callNumber,
      outcome: entry.outcome,
      tags: entry.tags,
      note: entry.note.trim(),
      createdBy: admin.id,
      createdByName: admin.name,
      createdAt: Timestamp.now(),
    });
    batch.update(leadDoc(lead.id), leadUpdate);
  });
}

/** Where a call's outcome leaves the lead, never moving it backwards. */
export function stageAfterCall(current: LeadStage, outcome: CallOutcome): LeadStage {
  if (outcome === "not_interested") return "lost";
  if (outcome === "demo_requested") return current === "won" ? current : "demo";
  if (current === "new") return "contacted";
  return current;
}

/** A note with no call behind it — recorded in the same log, as call 0. */
export async function addLeadNote(
  lead: Lead,
  note: string,
  tags: LeadTag[],
  admin: AdminIdentity,
): Promise<void> {
  const merged = Array.from(new Set([...(lead.tags ?? []), ...tags]));
  await safeWriteBatch(`note on ${lead.businessName}`, (batch) => {
    batch.set(doc(leadCalls(lead.id)), {
      callNumber: 0,
      outcome: "note",
      tags,
      note: note.trim(),
      createdBy: admin.id,
      createdByName: admin.name,
      createdAt: Timestamp.now(),
    });
    batch.update(leadDoc(lead.id), { tags: merged, updatedAt: serverTimestamp() });
  });
}

/**
 * Marks a lead as having become a real account. Called after the registration
 * form comes back with a center id, so the pipeline stops chasing someone who
 * is already a customer.
 */
export async function markLeadConverted(leadId: string, centerId: string): Promise<void> {
  await safeUpdateDoc(leadDoc(leadId), {
    stage: "won",
    convertedCenterId: centerId,
    convertedAt: Timestamp.now(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Soft delete — the row leaves the board but the call history it carries
 * stays, the same way a deleted job keeps its invoice. Nothing in this
 * section hard-deletes.
 */
export async function archiveLead(leadId: string): Promise<void> {
  await safeSetDoc(leadDoc(leadId), { isDeleted: true, updatedAt: serverTimestamp() }, { merge: true });
}
