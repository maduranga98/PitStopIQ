import type { Timestamp } from "firebase/firestore";

/**
 * The super admin's internal dev tracker: a to-do list and a feature/bug
 * board, both linkable back to a lead (service center) and a call. Separate
 * top-level collections — a todo can exist with no feature request behind it
 * (a plain reminder), and a feature request can exist with no todo yet (it
 * hasn't reached testing).
 */

// ── To-do list ───────────────────────────────────────────────────────────────

export const TODO_STATUSES = [
  { key: "open", label: "Open" },
  { key: "in_progress", label: "In progress" },
  { key: "done", label: "Done" },
] as const;

export type TodoStatus = (typeof TODO_STATUSES)[number]["key"];

/** Where a todo came from — decides what happens when it's marked done. */
export type TodoKind = "general" | "testing" | "bug_report";

export interface Todo {
  id: string;
  title: string;
  description?: string;
  status: TodoStatus;
  kind: TodoKind;
  dueAt?: Timestamp | null;
  leadId?: string | null;
  leadName?: string | null;
  callId?: string | null;
  /** Set on a `testing` todo — the feature/bug it was created to verify. */
  featureRequestId?: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy?: string;
  createdByName?: string;
  completedAt?: Timestamp | null;
}

export type TodoDraft = Pick<Todo, "title" | "description" | "leadId" | "leadName" | "callId"> & {
  dueDate?: string;
  dueTime?: string;
};

export function blankTodoDraft(leadId?: string, leadName?: string): TodoDraft {
  return { title: "", description: "", leadId: leadId ?? null, leadName: leadName ?? null, dueDate: "", dueTime: "" };
}

// ── Feature requests / bugs ─────────────────────────────────────────────────

export const FEATURE_TYPES = [
  { key: "feature", label: "Feature", chip: "bg-sky-500/15 text-sky-300 border border-sky-500/30" },
  { key: "bug", label: "Bug", chip: "bg-red-500/15 text-red-300 border border-red-500/30" },
] as const;

export type FeatureType = (typeof FEATURE_TYPES)[number]["key"];

export const FEATURE_STATUSES = [
  { key: "requested", label: "Requested", chip: "bg-gray-500/15 text-gray-300 border border-gray-500/30" },
  { key: "in_progress", label: "In progress", chip: "bg-amber-500/15 text-amber-300 border border-amber-500/30" },
  { key: "testing", label: "Testing", chip: "bg-violet-500/15 text-violet-300 border border-violet-500/30" },
  { key: "closed", label: "Closed", chip: "bg-green-500/15 text-green-300 border border-green-500/30" },
] as const;

export type FeatureStatus = (typeof FEATURE_STATUSES)[number]["key"];

export const FEATURE_STATUS_META: Record<FeatureStatus, (typeof FEATURE_STATUSES)[number]> =
  Object.fromEntries(FEATURE_STATUSES.map((s) => [s.key, s])) as Record<
    FeatureStatus,
    (typeof FEATURE_STATUSES)[number]
  >;

export const FEATURE_TYPE_META: Record<FeatureType, (typeof FEATURE_TYPES)[number]> =
  Object.fromEntries(FEATURE_TYPES.map((t) => [t.key, t])) as Record<
    FeatureType,
    (typeof FEATURE_TYPES)[number]
  >;

export interface FeatureRequest {
  id: string;
  type: FeatureType;
  title: string;
  description: string;
  status: FeatureStatus;
  leadId?: string | null;
  leadName?: string | null;
  /** Set when a customer reported this during a logged call. */
  callId?: string | null;
  /** Set when this bug was raised from a testing todo (QA found it). */
  sourceTodoId?: string | null;
  /** How to test it — set by the developer on close, not a link or file path. */
  featurePath?: string;
  /** The testing todo created when this moved to "testing". */
  testingTodoId?: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy?: string;
  createdByName?: string;
  startedAt?: Timestamp | null;
  closedAt?: Timestamp | null;
}

export type FeatureRequestDraft = Pick<
  FeatureRequest,
  "type" | "title" | "description" | "leadId" | "leadName" | "callId"
>;

export function blankFeatureDraft(
  type: FeatureType = "feature",
  leadId?: string,
  leadName?: string,
  callId?: string,
): FeatureRequestDraft {
  return {
    type, title: "", description: "",
    leadId: leadId ?? null, leadName: leadName ?? null, callId: callId ?? null,
  };
}
