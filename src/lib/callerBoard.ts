import type { LeadStage } from "../types/leads";

/**
 * What a caller may do when a card is dropped on a column. Mirrors the
 * firestore.rules for `leads` — the rules are the authority, this only decides
 * what the board offers before a write is attempted.
 *
 *  - "won" is set by registration, never by a caller, and a won lead is final
 *    for them (it carries commission).
 *  - Moving to "lost" needs a reason.
 */
export type CallerMove =
  | { kind: "same" }
  | { kind: "ok" }
  | { kind: "needs-reason" }
  | { kind: "blocked"; reason: string };

export function callerMove(from: LeadStage, to: LeadStage): CallerMove {
  if (from === to) return { kind: "same" };
  if (from === "won") return { kind: "blocked", reason: "A won lead is final — it can't be moved." };
  if (to === "won") {
    return { kind: "blocked", reason: "Won is set automatically when the customer is registered." };
  }
  if (to === "lost") return { kind: "needs-reason" };
  return { kind: "ok" };
}

/** Newest activity first; leads never touched sort by creation. */
export function sortLeadsForBoard<T extends {
  updatedAt?: { toMillis: () => number } | null;
  createdAt?: { toMillis: () => number } | null;
}>(leads: T[]): T[] {
  const at = (l: T) => l.updatedAt?.toMillis() ?? l.createdAt?.toMillis() ?? 0;
  return [...leads].sort((a, b) => at(b) - at(a));
}
