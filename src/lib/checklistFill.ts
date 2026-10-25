// Pure helpers for filling in a sectioned post-service checklist — no Firebase,
// shared by the job-tied runner, the standalone form and the read-only report.
import type {
  ChecklistResult, ChecklistSection, FilledChecklistItem, FilledChecklistSection,
  PostServiceChecklistItem,
} from "../types/auth";

export const MAX_TECHNICIAN_NAME = 60;
export const MAX_REMARKS = 1000;

/** A fresh, unrated copy of a template's sections — the snapshot an instance starts as. */
export function buildFilledSections(sections: ChecklistSection[]): FilledChecklistSection[] {
  return sections.map((s) => ({
    ...s,
    items: s.items.map((i) => ({ ...i, status: null, value: null, technicianName: null })),
  }));
}

/**
 * The filled sections of any instance. Instances written before sections
 * existed only have flat ticks; they read as one section where a ticked line is
 * "ok" and an unticked one is unrated, so old completed checklists still render.
 */
export function filledSectionsOf(doc: {
  sections?: FilledChecklistSection[]; items?: PostServiceChecklistItem[];
}): FilledChecklistSection[] {
  if (doc.sections && doc.sections.length > 0) return doc.sections;
  const flat = doc.items ?? [];
  if (flat.length === 0) return [];
  return [{
    id: "legacy", title: "Checks", order: 0, hasTechnician: false,
    items: flat.map((i, order) => ({
      id: i.id, label: i.label, order, type: "status" as const,
      status: i.checked ? ("ok" as const) : null, value: null, technicianName: null,
    })),
  }];
}

export function ratedProgress(sections: FilledChecklistSection[]): { done: number; total: number } {
  const items = sections.flatMap((s) => s.items);
  return { done: items.filter((i) => i.status !== null).length, total: items.length };
}

/** Sign-off needs every line rated — a blank row on a report is ambiguous. */
export function allRated(sections: FilledChecklistSection[]): boolean {
  const { done, total } = ratedProgress(sections);
  return total > 0 && done === total;
}

export function patchFilledItem(
  sections: FilledChecklistSection[], sectionId: string, itemId: string,
  patch: Partial<Pick<FilledChecklistItem, "status" | "value" | "technicianName">>,
): FilledChecklistSection[] {
  return sections.map((s) => (s.id !== sectionId ? s : {
    ...s, items: s.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)),
  }));
}

/** Rates every still-blank line "ok" in one go; anything already rated is left alone. */
export function markRemainingOk(
  sections: FilledChecklistSection[], sectionId?: string,
): FilledChecklistSection[] {
  return sections.map((s) => (sectionId && s.id !== sectionId ? s : {
    ...s, items: s.items.map((i) => (i.status === null ? { ...i, status: "ok" as const } : i)),
  }));
}

/** "13.5" → 13.5, "" → null, anything not a finite number → undefined (reject). */
export function parseReading(raw: string): number | null | undefined {
  const t = raw.trim();
  if (t === "") return null;
  if (!/^-?\d*\.?\d+$/.test(t) && !/^-?\d+\.$/.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * What is actually written: a reading only on numeric lines, a name only in
 * sections that ask for one, names trimmed and capped.
 */
export function cleanFilled(sections: FilledChecklistSection[]): FilledChecklistSection[] {
  return sections.map((s) => ({
    ...s,
    items: s.items.map((i) => {
      const name = s.hasTechnician ? (i.technicianName ?? "").trim().slice(0, MAX_TECHNICIAN_NAME) : "";
      return {
        ...i,
        status: i.status ?? null,
        value: i.type === "status_numeric" && typeof i.value === "number" && Number.isFinite(i.value) ? i.value : null,
        technicianName: name || null,
      };
    }),
  }));
}

export function resultCounts(sections: FilledChecklistSection[]): Record<ChecklistResult, number> {
  const counts: Record<ChecklistResult, number> = { ok: 0, attention: 0, immediate: 0 };
  for (const i of sections.flatMap((s) => s.items)) if (i.status) counts[i.status] += 1;
  return counts;
}

// ── Standalone header ───────────────────────────────────────────────────────

/** What a standalone checklist was done on: on file, or typed in by hand. */
export interface StandaloneHeaderInput {
  customerId: string | null;
  customerNameManual: string;
  vehicleId: string | null;
  plateNumberManual: string;
  /** Raw text from the mileage box; blank = not recorded. */
  mileage: string;
}

export const MAX_CUSTOMER_NAME = 120;
export const MAX_PLATE = 20;

/**
 * The header as stored. An on-file customer / vehicle wins over typed text, so
 * a record never carries both; blanks become null. Mileage is kept as typed
 * (a whole number) and is never compared with the vehicle's history.
 */
export function normalizeHeader(h: StandaloneHeaderInput): {
  customerId: string | null; customerNameManual: string | null;
  vehicleId: string | null; plateNumberManual: string | null; mileage: number | null;
} {
  const name = h.customerNameManual.trim().slice(0, MAX_CUSTOMER_NAME);
  const plate = h.plateNumberManual.trim().toUpperCase().slice(0, MAX_PLATE);
  const km = h.mileage.trim() === "" ? null : Number(h.mileage.trim());
  return {
    customerId: h.customerId || null,
    customerNameManual: h.customerId ? null : (name || null),
    vehicleId: h.vehicleId || null,
    plateNumberManual: h.vehicleId ? null : (plate || null),
    mileage: km !== null && Number.isFinite(km) ? Math.round(km) : null,
  };
}

/** The first problem with a header, or null. A report must say which vehicle it is about. */
export function headerError(h: StandaloneHeaderInput): string | null {
  if (!h.vehicleId && h.plateNumberManual.trim() === "") return "Pick the vehicle, or type its plate number.";
  const km = h.mileage.trim();
  if (km !== "" && !(/^\d+$/.test(km) && Number(km) <= 9_999_999)) return "Mileage must be a whole number of km.";
  return null;
}
