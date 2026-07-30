import { addDoc, collection, Timestamp } from "firebase/firestore";
import { db } from "../config/firebase";
import type { AuditLogAction, AuditLogEntityType } from "../types/auth";

// One row per sensitive mutation — a price change, a role change, an
// invoice/quotation edit, or any record deletion. Callers make the real
// write first (it's the thing that matters), then log it here —
// best-effort, so a dropped write to the audit trail never blocks or
// rolls back a change that already committed.

export interface LogAuditEventInput {
  centerId: string;
  action: AuditLogAction;
  entityType: AuditLogEntityType;
  entityId: string;
  entityLabel: string;
  changes?: Array<{ field: string; before?: string | number | null; after?: string | number | null }>;
  note?: string;
  performedBy: string;
  performedByName: string;
}

export async function logAuditEvent(input: LogAuditEventInput): Promise<void> {
  const { centerId, ...rest } = input;
  await addDoc(collection(db, "servicecenters", centerId, "auditLog"), {
    ...rest,
    centerId,
    createdAt: Timestamp.now(),
  });
}
