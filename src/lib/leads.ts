import {
  collection, doc, serverTimestamp, Timestamp, type FieldValue,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { safeAddDoc, safeSetDoc, safeUpdateDoc, safeWriteBatch } from "./firestoreWrite";
import { normalizePhone } from "./utils";
import {
  MAX_TRACKED_CALLS, formatDemoSlot,
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
    location: text(draft.location),
    district: text(draft.district),
    source: text(draft.source),
    mainProblem: text(draft.mainProblem),
    stage: draft.stage,
    callCount: Math.min(MAX_TRACKED_CALLS, Math.max(0, Math.round(draft.callCount || 0))),
    tags: Array.from(new Set(draft.tags ?? [])),
    demoRequested: draft.demoRequested === true,
    demoDate: text(draft.demoDate) || null,
    demoTime: text(draft.demoTime) || null,
    // The readable form is derived whenever there is a booked date, so the
    // card, the CSV and the drawer can't drift from the slot the scheduler
    // holds. Without a date it stays whatever the sheet wrote — "7.30 pm".
    demoAt: draft.demoDate
      ? formatDemoSlot(text(draft.demoDate), text(draft.demoTime))
      : text(draft.demoAt),
    nextFollowUp: text(draft.nextFollowUp) || null,
    followUpNote: text(draft.followUpNote),
    priceNote: text(draft.priceNote),
    closedAmount: Math.max(0, Number(draft.closedAmount) || 0),
    leadDate: text(draft.leadDate) || null,
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
 * and a demo outcome both flags the lead and pulls it into the matching
 * column — that is the whole point of recording the outcome. `stageAfterCall`
 * below decides the move, and never drags a lead backwards.
 */
export async function logLeadCall(
  lead: Lead,
  entry: CallEntry,
  admin: AdminIdentity,
): Promise<void> {
  const callNumber = (lead.callCount ?? 0) + 1;
  const tags = Array.from(new Set([...(lead.tags ?? []), ...entry.tags]));
  const wantsDemo = entry.outcome === "demo_booked" || entry.outcome === "demo_done";

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

/**
 * Where a call's outcome leaves the lead.
 *
 * Each outcome names the stage it produces, so logging the call moves the
 * card too — the sheet's Status column and its call notes were always the
 * same act recorded twice. The one thing this will not do is move a lead
 * backwards out of a demo or a close: a "no answer" chasing a booked demo
 * leaves it Demo Booked rather than dropping it back to Not Answer.
 */
export function stageAfterCall(current: LeadStage, outcome: CallOutcome): LeadStage {
  // A closed lead stays closed. Won or Lost is a decision somebody made, and
  // a later call — even one that books a demo — does not undo it by itself;
  // reopening is a deliberate move with the Status dropdown.
  if (current === "won" || current === "lost") return current;

  if (outcome === "not_interested") return "lost";
  if (outcome === "demo_done") return "demo_done";
  if (outcome === "demo_booked") return current === "demo_done" ? current : "demo_booked";

  // Past a demo, an ordinary call is chasing — it doesn't move the card back.
  if (current === "demo_booked" || current === "demo_done") return current;

  if (outcome === "details_sent") return "details_sent";
  if (outcome === "no_answer") return current === "new" ? "no_answer" : current;
  if (outcome === "callback") return "follow_up";
  // "Spoke to them" with nothing else decided: Called the first time, and
  // Follow-up once there is already a conversation running.
  return current === "new" || current === "no_answer" ? "called" : "follow_up";
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
 * Books (or moves) a demo, with the note that confirms it.
 *
 * A demo is a date and a time here rather than the sheet's free text, because
 * the scheduler has to be able to show what else is booked that day and say
 * whether this slot clashes. The note is not optional: a booking nobody wrote
 * a line about is the one that gets missed, so the dialog asks for it and this
 * refuses without it.
 *
 * The confirmation lands in the same call log as everything else — as call 0,
 * the way a plain note does, so booking a demo never inflates the call count.
 */
export interface DemoBooking {
  /** yyyy-mm-dd */
  date: string;
  /** HH:mm, 24-hour */
  time: string;
  note: string;
}

export async function scheduleLeadDemo(
  lead: Lead,
  booking: DemoBooking,
  admin: AdminIdentity,
): Promise<void> {
  const date = booking.date.trim();
  const time = booking.time.trim();
  const note = booking.note.trim();
  if (!date || !time) throw new Error("A demo needs both a date and a time.");
  if (!note) throw new Error("Confirm the demo with a note.");

  const slot = formatDemoSlot(date, time);
  const moved = Boolean(lead.demoDate) && (lead.demoDate !== date || (lead.demoTime ?? "") !== time);

  const leadUpdate: Record<string, unknown | FieldValue> = {
    demoDate: date,
    demoTime: time,
    demoAt: slot,
    demoRequested: true,
    demoNote: note,
    demoConfirmedAt: Timestamp.now(),
    demoConfirmedByName: admin.name,
    updatedAt: serverTimestamp(),
  };
  // A demo already given, or a lead already closed, is not dragged back to
  // Demo Booked by scheduling another one — same rule as `stageAfterCall`.
  if (lead.stage !== "won" && lead.stage !== "lost" && lead.stage !== "demo_done") {
    leadUpdate.stage = "demo_booked";
  }

  await safeWriteBatch(`demo for ${lead.businessName}`, (batch) => {
    batch.set(doc(leadCalls(lead.id)), {
      callNumber: 0,
      outcome: "demo_scheduled",
      tags: [],
      note: `${moved ? "Demo moved to" : "Demo booked for"} ${slot} — ${note}`,
      createdBy: admin.id,
      createdByName: admin.name,
      createdAt: Timestamp.now(),
    });
    batch.update(leadDoc(lead.id), leadUpdate);
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

/** What they actually paid, recorded against a lead that has closed. */
export async function setLeadClosedAmount(leadId: string, amount: number): Promise<void> {
  await safeUpdateDoc(leadDoc(leadId), {
    closedAmount: Math.max(0, Number(amount) || 0),
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
