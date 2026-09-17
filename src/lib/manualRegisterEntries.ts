import { collection, deleteField, doc, Timestamp } from "firebase/firestore";
import { db } from "../config/firebase";
import { safeAddDoc, safeUpdateDoc } from "./firestoreWrite";
import type { ManualRegisterEntry, PaymentClearance } from "../types/auth";

// Cheques and credit that belong to nothing else.
//
// The rest of the register is derived: a payment inside an invoice, an order
// or a delivery. But plenty of paper in a workshop drawer has no document
// behind it — the landlord's post-dated rent cheque, money lent to a mechanic,
// an insurer's settlement, a bill the owner agreed to pay next month. Before
// this those were simply absent from the calendar, which made the calendar a
// half-answer. These entries own their own document, and read out into the
// same RegisterEntry shape as everything else (see chequeRegister.ts).

export const MANUAL_ENTRIES = "manualRegisterEntries";

export function manualEntriesRef(centerId: string) {
  return collection(db, "servicecenters", centerId, MANUAL_ENTRIES);
}

function manualEntryRef(centerId: string, id: string) {
  return doc(db, "servicecenters", centerId, MANUAL_ENTRIES, id);
}

/** What the form collects — everything else is stamped on by this module. */
export interface ManualEntryInput {
  kind: ManualRegisterEntry["kind"];
  direction: ManualRegisterEntry["direction"];
  amount: number;
  partyName: string;
  partySubtitle?: string;
  partyPhone?: string;
  reference?: string;
  date: Date;
  chequeDate?: Date;
  chequeNumber?: string;
  bank?: string;
  branch?: string;
  note?: string;
}

/** The first thing a mis-keyed entry would break is a total, so guard early. */
export function validateManualEntry(input: ManualEntryInput): string | null {
  if (!input.partyName.trim()) return "Who is this with?";
  if (!Number.isFinite(input.amount) || input.amount <= 0) return "Enter an amount greater than zero.";
  if (!input.date || Number.isNaN(input.date.getTime())) return "Pick the date it was taken or agreed.";
  if (input.kind === "cheque") {
    if (!input.chequeNumber?.trim()) return "A cheque needs its number.";
    if (!input.bank?.trim()) return "A cheque needs the bank.";
    if (!input.chequeDate || Number.isNaN(input.chequeDate.getTime())) {
      return "A cheque needs the date written on it.";
    }
  }
  return null;
}

function trimmed(value: string | undefined): string | undefined {
  const out = value?.trim();
  return out ? out : undefined;
}

/** Firestore rejects `undefined`, so optional fields are dropped, not blanked. */
function optional(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
}

function payloadFrom(input: ManualEntryInput): Record<string, unknown> {
  const cheque = input.kind === "cheque";
  return {
    kind: input.kind,
    direction: input.direction,
    amount: parseFloat(input.amount.toFixed(2)),
    partyName: input.partyName.trim(),
    reference: trimmed(input.reference) ?? (cheque ? `CHQ ${input.chequeNumber?.trim()}` : "Manual entry"),
    date: Timestamp.fromDate(input.date),
    ...optional({
      partySubtitle: trimmed(input.partySubtitle),
      partyPhone: trimmed(input.partyPhone),
      note: trimmed(input.note),
      // Bank details belong to a cheque; switching an entry to credit clears them.
      chequeNumber: cheque ? trimmed(input.chequeNumber) : undefined,
      bank: cheque ? trimmed(input.bank) : undefined,
      branch: cheque ? trimmed(input.branch) : undefined,
      chequeDate: cheque && input.chequeDate ? Timestamp.fromDate(input.chequeDate) : undefined,
    }),
  };
}

export async function createManualEntry(
  centerId: string,
  input: ManualEntryInput,
  actor: { uid: string; name: string },
): Promise<string> {
  const now = Timestamp.now();
  const ref = await safeAddDoc(manualEntriesRef(centerId), {
    ...payloadFrom(input),
    clearance: "pending" as PaymentClearance,
    recordedBy: actor.uid,
    recordedByName: actor.name,
    recordedAt: now,
    updatedAt: now,
    isDeleted: false,
  });
  return ref.id;
}

/**
 * Edit an entry's own details. Its clearance is not touched here — that moves
 * through the register like every other entry, so a cheque can't be quietly
 * un-bounced by editing the amount.
 */
export async function updateManualEntry(
  centerId: string,
  id: string,
  input: ManualEntryInput,
): Promise<void> {
  const cheque = input.kind === "cheque";
  // A field the new shape doesn't use has to be erased explicitly: an update
  // merges, so a leftover cheque number would survive the switch to credit.
  await safeUpdateDoc(manualEntryRef(centerId, id), {
    ...payloadFrom(input),
    ...(cheque ? {} : {
      chequeNumber: deleteField(), bank: deleteField(),
      branch: deleteField(), chequeDate: deleteField(),
    }),
    ...(input.partySubtitle?.trim() ? {} : { partySubtitle: deleteField() }),
    ...(input.partyPhone?.trim() ? {} : { partyPhone: deleteField() }),
    ...(input.note?.trim() ? {} : { note: deleteField() }),
    updatedAt: Timestamp.now(),
  });
}

/** Soft delete: a cheque that was in the drawer once stays in the trail. */
export async function deleteManualEntry(
  centerId: string,
  id: string,
  actor: { uid: string; name: string },
): Promise<void> {
  await safeUpdateDoc(manualEntryRef(centerId, id), {
    isDeleted: true,
    deletedAt: Timestamp.now(),
    deletedBy: actor.uid,
    deletedByName: actor.name,
    updatedAt: Timestamp.now(),
  });
}

/** Cleared / returned / back to pending — the same three states as the rest. */
export async function setManualEntryClearance(
  centerId: string,
  id: string,
  state: PaymentClearance,
  actor: { uid: string; name: string },
  reason?: string,
): Promise<void> {
  const now = Timestamp.now();
  // Whatever the previous state left behind is cleared, so a reopened cheque
  // doesn't still carry who cleared it.
  const base = {
    clearance: state,
    clearedAt: deleteField(), clearedBy: deleteField(), clearedByName: deleteField(),
    returnedAt: deleteField(), returnedBy: deleteField(), returnedByName: deleteField(),
    returnReason: deleteField(),
    updatedAt: now,
  };
  if (state === "cleared") {
    await safeUpdateDoc(manualEntryRef(centerId, id), {
      ...base, clearedAt: now, clearedBy: actor.uid, clearedByName: actor.name,
    });
    return;
  }
  if (state === "returned") {
    await safeUpdateDoc(manualEntryRef(centerId, id), {
      ...base,
      returnedAt: now, returnedBy: actor.uid, returnedByName: actor.name,
      ...(reason?.trim() ? { returnReason: reason.trim() } : {}),
    });
    return;
  }
  await safeUpdateDoc(manualEntryRef(centerId, id), base);
}
