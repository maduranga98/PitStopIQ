// Post-service QC checklist — the gate a job clears between "done" and
// "delivered" (Pro plan, `postServiceChecklistEnabled` on the center).
//
// This module owns the data layer and the pure gate decision so the settings
// screens, the delivery action and the runner UI all read the same rules.
// Nothing here touches the pre-service inspection module: that one lives at
// jobs/{jobId}/inspection/main and is unrelated.
//
// Note on paths: the product doc calls the job collection `services`; in this
// codebase job documents live under `servicecenters/{centerId}/jobs/{jobId}`
// (the `services` sub-collection is legacy), so the instance sits at
// jobs/{jobId}/postServiceChecklist/main.
import {
  collection, doc, query, runTransaction, serverTimestamp, where,
  type DocumentData, type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { boundedGetDoc, boundedGetDocs } from "./firestoreRead";
import { safeSetDoc, safeUpdateDoc } from "./firestoreWrite";
import type {
  PostServiceChecklist, PostServiceChecklistItem, PostServiceChecklistRole,
  PostServiceChecklistTemplate, PostServiceChecklistTemplateItem, UserRole,
} from "../types/auth";
import { POST_SERVICE_CHECKLIST_ROLES } from "../types/auth";

/** Every instance lives under a fixed doc id, same as the inspection record. */
export const CHECKLIST_DOC_ID = "main";

// ── Paths ───────────────────────────────────────────────────────────────────

export const templatesCollection = (centerId: string) =>
  collection(db, "servicecenters", centerId, "postServiceChecklistTemplates");

export const templateDoc = (centerId: string, templateId: string) =>
  doc(db, "servicecenters", centerId, "postServiceChecklistTemplates", templateId);

export const checklistDoc = (centerId: string, jobId: string) =>
  doc(db, "servicecenters", centerId, "jobs", jobId, "postServiceChecklist", CHECKLIST_DOC_ID);

// ── Feature gating ──────────────────────────────────────────────────────────

/**
 * Whether the checklist module is live for this center. Plan is checked
 * first and independently of the toggle: a center that downgrades to Basic
 * keeps the stored flag but must stop seeing the feature entirely.
 */
export function checklistModuleEnabled(center: {
  plan?: string; postServiceChecklistEnabled?: boolean;
}): boolean {
  return center.plan === "pro" && center.postServiceChecklistEnabled === true;
}

/** Only these three roles are offered as `allowedRoles` — the checklist is an
 *  operational QC sign-off, so Cashier/Receptionist are not selectable. */
export function isChecklistRole(role: UserRole | string | undefined): role is PostServiceChecklistRole {
  return POST_SERVICE_CHECKLIST_ROLES.includes(role as PostServiceChecklistRole);
}

/** Templates this user's role is allowed to complete. */
export function eligibleTemplates(
  templates: PostServiceChecklistTemplate[],
  role: UserRole | string | undefined,
): PostServiceChecklistTemplate[] {
  return templates.filter((t) => t.isActive && isChecklistRole(role) && t.allowedRoles.includes(role));
}

/** Whether this user may tick and complete an existing instance. */
export function canCompleteChecklist(
  checklist: Pick<PostServiceChecklist, "allowedRoles" | "assignedTo">,
  user: { uid?: string; role?: UserRole | string },
): boolean {
  if (checklist.assignedTo) return checklist.assignedTo === user.uid;
  return isChecklistRole(user.role) && checklist.allowedRoles.includes(user.role);
}

/** Owner/Manager may hand an unfinished checklist to someone else. */
export function canReassignChecklist(role: UserRole | string | undefined): boolean {
  return role === "Owner" || role === "Manager";
}

/** A checklist is only satisfied once every line is ticked and it is signed
 *  off — partial completion is deliberately not accepted. */
export function isChecklistComplete(
  checklist: Pick<PostServiceChecklist, "completedAt"> | null | undefined,
): boolean {
  return !!checklist?.completedAt;
}

export function allItemsChecked(items: PostServiceChecklistItem[]): boolean {
  return items.length > 0 && items.every((i) => i.checked);
}

// ── The delivery gate decision ──────────────────────────────────────────────

export type ChecklistGate =
  /** Module off, or plan is not Pro — deliver exactly as before. */
  | { kind: "allow" }
  /** An instance exists and is signed off — deliver, no re-prompt. */
  | { kind: "allow"; completed: true }
  /** Nothing is configured. A configuration fault, surfaced loudly. */
  | { kind: "blocked-no-templates" }
  /** Templates exist but none names this user's role. */
  | { kind: "blocked-wrong-role"; waitingOn: PostServiceChecklistRole[] }
  /** Exactly one eligible template — open the runner straight away. */
  | { kind: "run"; template: PostServiceChecklistTemplate }
  /** Several eligible templates — let the user pick first. */
  | { kind: "select"; templates: PostServiceChecklistTemplate[] }
  /** An unfinished instance already exists — resume it. */
  | { kind: "resume"; checklist: PostServiceChecklist };

/**
 * Pure gate decision, so it can be unit-reasoned without Firestore. Callers
 * pass what they already loaded; `resolveChecklistGate` below does the reads.
 */
export function decideChecklistGate(input: {
  center: { plan?: string; postServiceChecklistEnabled?: boolean };
  templates: PostServiceChecklistTemplate[];
  existing: PostServiceChecklist | null;
  user: { uid?: string; role?: UserRole | string };
}): ChecklistGate {
  const { center, templates, existing, user } = input;
  if (!checklistModuleEnabled(center)) return { kind: "allow" };
  if (existing) {
    if (isChecklistComplete(existing)) return { kind: "allow", completed: true };
    // An Owner or Manager who cannot complete it themselves is still shown
    // the checklist — read-only, but with the reassignment control — so the
    // person holding up the delivery can be changed from where the problem
    // surfaces rather than from a dead end.
    if (!canCompleteChecklist(existing, user) && !canReassignChecklist(user.role)) {
      return { kind: "blocked-wrong-role", waitingOn: existing.allowedRoles };
    }
    return { kind: "resume", checklist: existing };
  }
  const active = templates.filter((t) => t.isActive);
  if (active.length === 0) return { kind: "blocked-no-templates" };
  const mine = eligibleTemplates(active, user.role);
  if (mine.length === 0) {
    const waitingOn = [...new Set(active.flatMap((t) => t.allowedRoles))];
    return { kind: "blocked-wrong-role", waitingOn };
  }
  if (mine.length === 1) return { kind: "run", template: mine[0] };
  // The default template wins when several are eligible, so a center that
  // marked one still gets a single-tap path.
  const preferred = mine.find((t) => t.isDefault);
  return preferred ? { kind: "run", template: preferred } : { kind: "select", templates: mine };
}

// ── Reads ───────────────────────────────────────────────────────────────────

function templateFromSnap(
  snap: QueryDocumentSnapshot<DocumentData>,
): PostServiceChecklistTemplate {
  const d = snap.data();
  return {
    id: snap.id,
    name: d.name ?? "",
    items: sortItems((d.items ?? []) as PostServiceChecklistTemplateItem[]),
    allowedRoles: ((d.allowedRoles ?? []) as string[]).filter(isChecklistRole),
    defaultAssignee: d.defaultAssignee ?? null,
    isActive: d.isActive !== false,
    isDefault: d.isDefault === true,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export function sortItems<T extends { order: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order);
}

/** All templates, newest-configured last. Used by the management screen. */
export async function fetchTemplates(centerId: string): Promise<PostServiceChecklistTemplate[]> {
  const snap = await boundedGetDocs(templatesCollection(centerId));
  return snap.docs.map(templateFromSnap).sort((a, b) => a.name.localeCompare(b.name));
}

/** Only the active ones — what the delivery gate reads. */
export async function fetchActiveTemplates(centerId: string): Promise<PostServiceChecklistTemplate[]> {
  const snap = await boundedGetDocs(query(templatesCollection(centerId), where("isActive", "==", true)));
  return snap.docs.map(templateFromSnap).sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchChecklist(
  centerId: string, jobId: string,
): Promise<PostServiceChecklist | null> {
  const snap = await boundedGetDoc(checklistDoc(centerId, jobId));
  return snap.exists() ? (snap.data() as PostServiceChecklist) : null;
}

// ── Writes ──────────────────────────────────────────────────────────────────

/** Fresh, blank line for the template editor. */
export function blankTemplateItem(order: number): PostServiceChecklistTemplateItem {
  return { id: newItemId(), label: "", order };
}

export function newItemId(): string {
  return `i_${Math.random().toString(36).slice(2, 10)}`;
}

/** Renumbers `order` to match array position — call before every save. */
export function renumber(items: PostServiceChecklistTemplateItem[]): PostServiceChecklistTemplateItem[] {
  return items.map((item, order) => ({ ...item, order }));
}

/**
 * Saves a template and, when it is being marked default, clears the flag off
 * every other one in the same transaction — "only one default" has to hold
 * even when two owners save from two devices.
 */
export async function saveTemplate(
  centerId: string,
  templateId: string | null,
  data: Pick<PostServiceChecklistTemplate,
    "name" | "items" | "allowedRoles" | "defaultAssignee" | "isActive" | "isDefault">,
): Promise<string> {
  const ref = templateId ? templateDoc(centerId, templateId) : doc(templatesCollection(centerId));
  const payload = {
    name: data.name.trim(),
    items: renumber(data.items).map((i) => ({ ...i, label: i.label.trim() })),
    allowedRoles: data.allowedRoles.filter(isChecklistRole),
    defaultAssignee: data.defaultAssignee ?? null,
    isActive: data.isActive,
    // An inactive template is never the default — it would leave the center
    // pointing its one-tap path at a checklist nobody can be given.
    isDefault: data.isActive && data.isDefault,
    updatedAt: serverTimestamp(),
  };

  if (!payload.isDefault) {
    await safeSetDoc(ref, templateId ? payload : { ...payload, createdAt: serverTimestamp() }, { merge: true });
    return ref.id;
  }

  // "Only one default" is the one invariant worth a real transaction: two
  // owners saving from two devices would otherwise both end up default, and
  // the delivery gate would then pick one of them arbitrarily. Unlike the
  // safe* helpers this has no offline path — a template save while offline
  // fails loudly rather than silently leaving two defaults behind.
  const others = await boundedGetDocs(query(templatesCollection(centerId), where("isDefault", "==", true)));
  await runTransaction(db, async (tx) => {
    for (const other of others.docs) {
      if (other.id === ref.id) continue;
      tx.update(other.ref, { isDefault: false, updatedAt: serverTimestamp() });
    }
    tx.set(ref, templateId ? payload : { ...payload, createdAt: serverTimestamp() }, { merge: true });
  });
  return ref.id;
}

/**
 * Soft-delete only. Instances snapshot their template's name and items, but
 * `templateId` still points here — hard-deleting would strand that reference
 * and erase the record of which QC checklist a delivered job was passed on.
 */
export async function deactivateTemplate(centerId: string, templateId: string): Promise<void> {
  await safeUpdateDoc(templateDoc(centerId, templateId), {
    isActive: false, isDefault: false, updatedAt: serverTimestamp(),
  });
}

/** Brings a soft-deleted template back. Never restores the default flag —
 *  that is a separate, deliberate choice in the editor. */
export async function reactivateTemplate(centerId: string, templateId: string): Promise<void> {
  await safeUpdateDoc(templateDoc(centerId, templateId), {
    isActive: true, updatedAt: serverTimestamp(),
  });
}

// ── Instance writes ─────────────────────────────────────────────────────────

/**
 * Snapshots a template onto a job. Name, roles and item labels are copied
 * rather than referenced, so editing the template afterwards never rewrites a
 * checklist someone has already been handed.
 *
 * Created unfinished and unticked: the runner writes the ticks and the
 * sign-off together when it is submitted, so an abandoned checklist costs one
 * document and no half-truth about what was checked.
 */
export async function createChecklistInstance(
  centerId: string,
  jobId: string,
  template: PostServiceChecklistTemplate,
): Promise<PostServiceChecklist> {
  const instance = {
    templateId: template.id,
    templateName: template.name,
    allowedRoles: template.allowedRoles,
    assignedTo: template.defaultAssignee ?? null,
    items: sortItems(template.items).map((i) => ({ id: i.id, label: i.label, checked: false })),
    completedBy: null,
    completedAt: null,
    createdAt: serverTimestamp(),
  };
  await safeSetDoc(checklistDoc(centerId, jobId), instance);
  // serverTimestamp() is a sentinel until the server acks; the caller only
  // needs the shape, and `createdAt` is never read back in the same session.
  return instance as unknown as PostServiceChecklist;
}

/**
 * Ticks and sign-off in one write. Refuses anything short of every item
 * checked — the gate is all-or-nothing by design, so a partially ticked
 * checklist must never reach the document.
 */
export async function completeChecklist(
  centerId: string,
  jobId: string,
  items: PostServiceChecklistItem[],
  completedBy: string,
): Promise<void> {
  if (!allItemsChecked(items)) {
    throw new Error("Every check has to be ticked before the checklist can be completed.");
  }
  await safeUpdateDoc(checklistDoc(centerId, jobId), {
    items, completedBy, completedAt: serverTimestamp(),
  });
}

/** Hands an unfinished checklist to someone else (Owner/Manager only — the
 *  security rules allow this one field and nothing else). */
export async function reassignChecklist(
  centerId: string,
  jobId: string,
  assignedTo: string | null,
): Promise<void> {
  await safeUpdateDoc(checklistDoc(centerId, jobId), { assignedTo });
}

/**
 * Everything the delivery gate needs, read in one go. Returns `{ kind:
 * "allow" }` without touching Firestore when the module is off, so an
 * ordinary center's delivery costs exactly what it always did.
 */
export async function resolveChecklistGate(
  centerId: string,
  jobId: string,
  center: { plan?: string; postServiceChecklistEnabled?: boolean },
  user: { uid?: string; role?: UserRole | string },
): Promise<ChecklistGate> {
  if (!checklistModuleEnabled(center)) return { kind: "allow" };
  const existing = await fetchChecklist(centerId, jobId);
  // A checklist already on the job answers the question on its own — the
  // template library never needs reading.
  const templates = existing ? [] : await fetchActiveTemplates(centerId);
  return decideChecklistGate({ center, templates, existing, user });
}
