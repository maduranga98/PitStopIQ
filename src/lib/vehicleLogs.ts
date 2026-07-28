import { collection, Timestamp } from "firebase/firestore";
import { db } from "../config/firebase";
import { safeAddDoc } from "./firestoreWrite";
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
