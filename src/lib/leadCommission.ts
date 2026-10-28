import { Timestamp } from "firebase/firestore";
import type { Lead, LeadPackage, LeadStage, StageHistoryEntry } from "../types/leads";

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

/**
 * Why "Confirm payment" can't be used on this lead, or null when it can.
 * Shown to the super admin in place of the button — a lead that can't earn
 * commission should say why, not silently skip it.
 */
export function paymentConfirmBlocker(
  lead: Pick<Lead, "stage" | "packageId" | "assignedTo" | "paymentConfirmed">,
): string | null {
  if (lead.paymentConfirmed) return null; // already done: nothing to block
  if (lead.stage !== "won") return "Payment can be confirmed once the lead is registered as a customer.";
  if (!lead.packageId) {
    return "This lead was won without going through registration, so its package is unknown and no commission can be worked out. Register the service center from this lead, or set the package in the Console.";
  }
  if (!lead.assignedTo) return "No caller is assigned to this lead, so there is no commission to pay. Assign a caller first.";
  return null;
}
