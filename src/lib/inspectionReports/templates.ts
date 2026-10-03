// ── Template storage ─────────────────────────────────────────────────────────
//
// One template per center at inspectionTemplates/default. The center's copy is
// theirs: it is seeded once from the shipped defaults and NEVER overwritten by
// a later product update (DEFAULTS_VERSION only records what it was seeded
// from).
//
// Offline: reads go through boundedGetDoc (cache fallback), writes through the
// safe* helpers, no transactions. The whole `sections` array is saved on each
// edit — a template is a few KB, and edits are made by one Owner/Manager at a
// time, so last-write-wins is acceptable.
import { Timestamp } from "firebase/firestore";
import { boundedGetDoc } from "../firestoreRead";
import { safeSetDoc, safeUpdateDoc } from "../firestoreWrite";
import { DEFAULTS_VERSION } from "../../constants/defaultInspectionChecklist";
import { inspectionTemplateDoc } from "./paths";
import { buildDefaultSections } from "./templateOps";
import type { InspectionTemplate, InspectionTemplateSection } from "../../types/inspectionReports";

export class TemplateUnavailableError extends Error {
  constructor() {
    super("Can't load your checklist while offline. Connect once and try again.");
    this.name = "TemplateUnavailableError";
  }
}

/** The center's template, or null when it has never been seeded. Throws
 *  TemplateUnavailableError when that can't be told apart from "offline". */
export async function fetchTemplate(centerId: string): Promise<InspectionTemplate | null> {
  const snap = await boundedGetDoc(inspectionTemplateDoc(centerId));
  if (snap.exists()) return { id: snap.id, ...snap.data() } as InspectionTemplate;
  // A missing doc served from the offline cache only means "not cached here" —
  // seeding on that basis could overwrite a template edited on another device.
  if (snap.metadata.fromCache) throw new TemplateUnavailableError();
  return null;
}

/** Copy the shipped defaults into the center's own template. Caller has
 *  already established there is none (see ensureTemplate). */
export async function seedTemplate(centerId: string): Promise<InspectionTemplate> {
  const now = Timestamp.now();
  const template: Omit<InspectionTemplate, "id"> = {
    name: "Inspection checklist",
    sections: buildDefaultSections(),
    defaultsVersion: DEFAULTS_VERSION,
    createdAt: now,
    updatedAt: now,
  };
  await safeSetDoc(inspectionTemplateDoc(centerId), template);
  return { id: inspectionTemplateDoc(centerId).id, ...template };
}

/** Seed on first use. Safe to call repeatedly; an existing template is returned as is. */
export async function ensureTemplate(centerId: string): Promise<InspectionTemplate> {
  return (await fetchTemplate(centerId)) ?? (await seedTemplate(centerId));
}

export async function saveTemplateSections(
  centerId: string, sections: InspectionTemplateSection[],
): Promise<void> {
  await safeUpdateDoc(inspectionTemplateDoc(centerId), { sections, updatedAt: Timestamp.now() });
}
