import { Timestamp } from "firebase/firestore";
import type { LeadPackage, LeadStage, StageHistoryEntry } from "../types/leads";

/**
 * Pure helpers for the commission and stage-history writes. Kept apart from
 * lib/leads.ts (which initialises Firebase) so they can be unit-tested.
 */

/**
 * Commission on one sale, in whole rupees: 4,999 × 0.20 is 999.80, which pays
 * out as 1,000. firestore.rules recomputes this with math.round() and rejects
 * any commissionAmount that differs, so the two must stay the same formula.
 */
export function calcCommission(pkg: Pick<LeadPackage, "price" | "commissionRate">): number {
  return Math.round(pkg.price * pkg.commissionRate);
}

/** Who made a change — an admin or a caller; both are { id, name }. */
export interface Actor {
  id: string;
  name: string;
}

export function stageEntry(
  from: LeadStage,
  to: LeadStage,
  by: Actor,
  at: Timestamp = Timestamp.now(),
): StageHistoryEntry {
  return { from, to, byUid: by.id, byName: by.name, at };
}
