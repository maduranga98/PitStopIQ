import { CALL_OUTCOMES, LEAD_STAGES, type LeadStage } from "../types/leads.ts";

/**
 * The columns a caller works. "Video & details" is an admin-side step: callers
 * don't see it, and any lead already sitting there is shown under Follow-up
 * (`columnFor`) so nothing disappears from their board.
 */
export const CALLER_STAGES = LEAD_STAGES.filter((s) => s.key !== "details_sent");

export function columnFor(stage: LeadStage): LeadStage {
  return stage === "details_sent" ? "follow_up" : stage;
}

/** Call outcomes a caller can log — "Sent video & details" is not one of them. */
export const CALLER_OUTCOMES = CALL_OUTCOMES.filter((o) => o.key !== "details_sent");

/** "just now", "5m ago", "3h ago", "2d ago", "3w ago". */
export function timeAgo(thenMs: number, nowMs: number = Date.now()): string {
  const mins = Math.max(0, Math.floor((nowMs - thenMs) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

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
