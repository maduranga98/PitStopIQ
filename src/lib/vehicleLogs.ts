import { collection, doc, Timestamp } from "firebase/firestore";
import { db } from "../config/firebase";
import { safeAddDoc, safeDeleteDoc, safeUpdateDoc } from "./firestoreWrite";
import type { AuthUser } from "../types/auth";

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
  changes: { message: string; needsFollowUp: boolean },
  actor?: AuthUser | null,
): Promise<void> {
  await safeUpdateDoc(logRef(centerId, vehicleId, logId), {
    message: changes.message,
    needsFollowUp: changes.needsFollowUp,
    editedAt: Timestamp.now(),
    editedByName: actor?.displayName || actor?.email || null,
  });
}

/** Remove an entry outright — a note keyed against the wrong vehicle, say. */
export async function deleteVehicleLog(
  centerId: string,
  vehicleId: string,
  logId: string,
): Promise<void> {
  await safeDeleteDoc(logRef(centerId, vehicleId, logId));
}
