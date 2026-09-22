import { collection, doc, limit as fsLimit, orderBy, query, where, Timestamp } from "firebase/firestore";
import { db } from "../config/firebase";
import { safeAddDoc, safeDeleteDoc, safeUpdateDoc } from "./firestoreWrite";
import { getDocsWithRetry } from "./firestoreRetry";
import type { AuthUser, VehicleLogEntry } from "../types/auth";

// Writes one entry to a vehicle's activity log
// (servicecenters/{centerId}/vehicles/{vehicleId}/logs). Used both for
// automatically-recorded system events (edited, photo added, reminder
// sent…) and for staff notes about what to check or change next visit.
// Failures are swallowed — the log is a record of what happened, never a
// gate on the action it's describing.
export async function logVehicleEvent(
  centerId: string,
  vehicleId: string,
  entry: {
    type: "system" | "note";
    message: string;
    needsFollowUp?: boolean;
    customerVisible?: boolean;
    actor?: AuthUser | null;
  },
): Promise<void> {
  try {
    await safeAddDoc(
      collection(db, "servicecenters", centerId, "vehicles", vehicleId, "logs"),
      {
        type: entry.type,
        message: entry.message,
        ...(entry.needsFollowUp !== undefined ? { needsFollowUp: entry.needsFollowUp } : {}),
        // Only a flagged note can be shared — an unflagged one has no place to
        // show up in the portal, so the pair is normalised here rather than
        // trusting every caller to keep them in step.
        ...(entry.needsFollowUp
          ? { customerVisible: Boolean(entry.customerVisible) }
          : {}),
        authorName: entry.actor?.displayName || entry.actor?.email || null,
        authorRole: entry.actor?.customRoleName || entry.actor?.role || null,
        createdAt: Timestamp.now(),
      },
    );
  } catch {
    /* non-fatal — logging must never block the underlying action */
  }
}

function logRef(centerId: string, vehicleId: string, logId: string) {
  return doc(db, "servicecenters", centerId, "vehicles", vehicleId, "logs", logId);
}

/**
 * Correct a staff note — its wording, or whether it still needs following up.
 * Only notes are editable: system entries record what the app itself did, and
 * rewriting those would make the audit trail lie. The edit is stamped so a
 * reader can tell a corrected note from an original one.
 *
 * Unlike logVehicleEvent this rethrows: the caller is a person who asked for
 * the change and needs to know if it didn't take.
 */
export async function updateVehicleNote(
  centerId: string,
  vehicleId: string,
  logId: string,
  changes: { message: string; needsFollowUp: boolean; customerVisible?: boolean },
  actor?: AuthUser | null,
): Promise<void> {
  await safeUpdateDoc(logRef(centerId, vehicleId, logId), {
    message: changes.message,
    needsFollowUp: changes.needsFollowUp,
    // Un-flagging a note also withdraws it from the customer's portal: a note
    // left `customerVisible` without its flag would be published with nothing
    // in the staff UI still showing that it is.
    customerVisible: changes.needsFollowUp ? Boolean(changes.customerVisible) : false,
    editedAt: Timestamp.now(),
    editedByName: actor?.displayName || actor?.email || null,
  });
}

// The most recent shared follow-ups for one vehicle, newest first. Both
// filters are part of the query on purpose: the public share link is allowed
// to read exactly these entries and nothing else, so a wider query would be
// rejected outright by the security rules rather than quietly filtered.
const CUSTOMER_FOLLOW_UP_LIMIT = 20;

export async function fetchCustomerFollowUps(
  centerId: string,
  vehicleId: string,
): Promise<VehicleLogEntry[]> {
  const snap = await getDocsWithRetry(
    query(
      collection(db, "servicecenters", centerId, "vehicles", vehicleId, "logs"),
      where("needsFollowUp", "==", true),
      where("customerVisible", "==", true),
      orderBy("createdAt", "desc"),
      fsLimit(CUSTOMER_FOLLOW_UP_LIMIT),
    ),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as VehicleLogEntry));
}

/** Remove an entry outright — a note keyed against the wrong vehicle, say. */
export async function deleteVehicleLog(
  centerId: string,
  vehicleId: string,
  logId: string,
): Promise<void> {
  await safeDeleteDoc(logRef(centerId, vehicleId, logId));
}
