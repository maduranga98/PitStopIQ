import { collection, doc, serverTimestamp, Timestamp } from "firebase/firestore";
import { db } from "../config/firebase";
import { safeAddDoc, safeDeleteDoc, safeUpdateDoc } from "./firestoreWrite";
import type { AdminIdentity } from "./leads";
import type {
  FeatureRequest, FeatureRequestDraft, FeatureStatus, Todo, TodoDraft, TodoStatus,
} from "../types/devTracker";

/**
 * Writes for the super admin's to-do list and feature/bug tracker. Both are
 * flat top-level collections (super admin only — see firestore.rules), kept
 * here together because they call into each other on the two workflow
 * hand-offs: closing a feature request creates a testing todo, and finishing
 * that todo closes the feature request back.
 */

export const todosCollection = () => collection(db, "todos");
export const todoDoc = (id: string) => doc(db, "todos", id);
export const featureRequestsCollection = () => collection(db, "featureRequests");
export const featureRequestDoc = (id: string) => doc(db, "featureRequests", id);

function combineDateTime(date?: string, time?: string): Timestamp | null {
  const d = (date ?? "").trim();
  if (!d) return null;
  const t = (time ?? "").trim() || "00:00";
  const at = new Date(`${d}T${t}:00`);
  return Number.isNaN(at.getTime()) ? null : Timestamp.fromDate(at);
}

// ── To-do list ───────────────────────────────────────────────────────────────

export async function createTodo(draft: TodoDraft, admin: AdminIdentity): Promise<string> {
  const ref = await safeAddDoc(todosCollection(), {
    title: draft.title.trim(),
    description: (draft.description ?? "").trim(),
    status: "open" as TodoStatus,
    kind: "general" as const,
    dueAt: combineDateTime(draft.dueDate, draft.dueTime),
    leadId: draft.leadId ?? null,
    leadName: draft.leadName ?? null,
    callId: draft.callId ?? null,
    featureRequestId: null,
    completedAt: null,
    createdBy: admin.id,
    createdByName: admin.name,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  return ref.id;
}

export async function updateTodo(id: string, draft: TodoDraft): Promise<void> {
  await safeUpdateDoc(todoDoc(id), {
    title: draft.title.trim(),
    description: (draft.description ?? "").trim(),
    dueAt: combineDateTime(draft.dueDate, draft.dueTime),
    leadId: draft.leadId ?? null,
    leadName: draft.leadName ?? null,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Setting a todo to "done" is the QA hand-off: a `testing` todo finishing
 * closes the feature request it was created for. Every other status change
 * is just the status.
 */
export async function setTodoStatus(todo: Todo, status: TodoStatus): Promise<void> {
  await safeUpdateDoc(todoDoc(todo.id), {
    status,
    completedAt: status === "done" ? Timestamp.now() : null,
    updatedAt: serverTimestamp(),
  });
  if (status === "done" && todo.kind === "testing" && todo.featureRequestId) {
    await closeFeatureRequestAfterTesting(todo.featureRequestId);
  }
}

export async function deleteTodo(id: string): Promise<void> {
  await safeDeleteDoc(todoDoc(id));
}

// ── Feature requests / bugs ──────────────────────────────────────────────────

export async function createFeatureRequest(
  draft: FeatureRequestDraft,
  admin: AdminIdentity,
): Promise<string> {
  const ref = await safeAddDoc(featureRequestsCollection(), {
    type: draft.type,
    title: draft.title.trim(),
    description: (draft.description ?? "").trim(),
    status: "requested" as FeatureStatus,
    leadId: draft.leadId ?? null,
    leadName: draft.leadName ?? null,
    callId: draft.callId ?? null,
    sourceTodoId: null,
    featurePath: "",
    testingTodoId: null,
    startedAt: null,
    closedAt: null,
    createdBy: admin.id,
    createdByName: admin.name,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  return ref.id;
}

/** Developer picks it up. */
export async function startFeatureRequest(id: string): Promise<void> {
  await safeUpdateDoc(featureRequestDoc(id), {
    status: "in_progress" as FeatureStatus,
    startedAt: Timestamp.now(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * Developer is done building. This does not close the ticket outright — it
 * needs a feature path and moves to Testing, with a testing todo created
 * automatically so QA has something to work off.
 */
export async function closeFeatureRequestToTesting(
  feature: FeatureRequest,
  featurePath: string,
  admin: AdminIdentity,
): Promise<void> {
  const path = featurePath.trim();
  if (!path) throw new Error("Add where the feature lives before moving it to testing.");

  const todoRef = await safeAddDoc(todosCollection(), {
    title: `Test: ${feature.title}`,
    description: `${feature.description}\n\nBuilt at: ${path}`.trim(),
    status: "open" as TodoStatus,
    kind: "testing" as const,
    dueAt: null,
    leadId: feature.leadId ?? null,
    leadName: feature.leadName ?? null,
    callId: feature.callId ?? null,
    featureRequestId: feature.id,
    completedAt: null,
    createdBy: admin.id,
    createdByName: admin.name,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });

  await safeUpdateDoc(featureRequestDoc(feature.id), {
    status: "testing" as FeatureStatus,
    featurePath: path,
    testingTodoId: todoRef.id,
    updatedAt: serverTimestamp(),
  });
}

/** Called by setTodoStatus once its testing todo is marked done. */
async function closeFeatureRequestAfterTesting(featureId: string): Promise<void> {
  await safeUpdateDoc(featureRequestDoc(featureId), {
    status: "closed" as FeatureStatus,
    closedAt: Timestamp.now(),
    updatedAt: serverTimestamp(),
  });
}

/**
 * QA found a bug while testing. Raises a new bug ticket linked back to the
 * testing todo it came from, so the origin is never lost.
 */
export async function reportBugFromTodo(
  todo: Todo,
  description: string,
  admin: AdminIdentity,
): Promise<string> {
  const ref = await safeAddDoc(featureRequestsCollection(), {
    type: "bug" as const,
    title: `Bug found testing: ${todo.title.replace(/^Test:\s*/, "")}`,
    description: description.trim(),
    status: "requested" as FeatureStatus,
    leadId: todo.leadId ?? null,
    leadName: todo.leadName ?? null,
    callId: todo.callId ?? null,
    sourceTodoId: todo.id,
    featurePath: "",
    testingTodoId: null,
    startedAt: null,
    closedAt: null,
    createdBy: admin.id,
    createdByName: admin.name,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  return ref.id;
}

/** A customer reported a bug live on a call — logged straight to the tracker. */
export async function reportBugFromCall(
  leadId: string,
  leadName: string,
  callId: string,
  description: string,
  admin: AdminIdentity,
): Promise<string> {
  const ref = await safeAddDoc(featureRequestsCollection(), {
    type: "bug" as const,
    title: `Bug reported by ${leadName}`,
    description: description.trim(),
    status: "requested" as FeatureStatus,
    leadId,
    leadName,
    callId,
    sourceTodoId: null,
    featurePath: "",
    testingTodoId: null,
    startedAt: null,
    closedAt: null,
    createdBy: admin.id,
    createdByName: admin.name,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  return ref.id;
}
