// ── Template operations (pure) ───────────────────────────────────────────────
//
// Every edit a center can make to its checklist template, as a function from
// sections to sections. No Firebase here, so it is unit-tested directly
// (templateOps.test.ts) and the page just applies the result and saves it.
//
// Rules the operations keep:
//  - Nothing is ever hard-deleted: "remove" = hidden:true, so old report
//    snapshots and "restore removed defaults" stay valid.
//  - Custom items/sections are never touched by restoreRemovedDefaults.
//  - `order` is always renumbered 0..n-1 after any move or add.
//  - Ids of shipped defaults come from the constants file and never change.
import {
  DEFAULT_CHECKLIST, defaultItemId,
} from "../../constants/defaultInspectionChecklist.ts";
import { MAX_TEMPLATE_LABEL_LENGTH } from "../../constants/inspectionReports.ts";
import type {
  InspectionTemplateItem, InspectionTemplateSection,
} from "../../types/inspectionReports.ts";

export type IdGenerator = (prefix: "s" | "i") => string;

/** `s_k3j9x0ab` / `i_k3j9x0ab` — never collides with a default id (those have a dot). */
export const randomId: IdGenerator = (prefix) =>
  `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;

/** Trim, collapse whitespace, cap length. Empty string means "reject". */
export function cleanLabel(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_TEMPLATE_LABEL_LENGTH);
}

// ── Seed ─────────────────────────────────────────────────────────────────────

/** A center's fresh copy of the shipped defaults. */
export function buildDefaultSections(): InspectionTemplateSection[] {
  return DEFAULT_CHECKLIST.map((s, si) => ({
    id: s.id,
    title: s.title,
    hidden: s.hiddenByDefault === true,
    order: si,
    isDefault: true,
    items: s.items.map(([slug, label], ii): InspectionTemplateItem => {
      const id = defaultItemId(s.id, slug);
      return { id, label, hidden: false, order: ii, isDefault: true, defaultKey: id };
    }),
  }));
}

// ── Read helpers ─────────────────────────────────────────────────────────────

const byOrder = <T extends { order: number }>(a: T, b: T) => a.order - b.order;

/** All sections/items in display order (hidden ones included — the editor shows them). */
export function sortedSections(sections: InspectionTemplateSection[]): InspectionTemplateSection[] {
  return [...sections].sort(byOrder).map((s) => ({ ...s, items: [...s.items].sort(byOrder) }));
}

/** What a new report snapshots and a technician sees: visible sections with visible items. */
export function visibleSections(sections: InspectionTemplateSection[]): InspectionTemplateSection[] {
  return sortedSections(sections)
    .filter((s) => !s.hidden)
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.hidden) }));
}

/** Default items the center has hidden (restore would bring these back). */
export function countRemovedDefaults(sections: InspectionTemplateSection[]): number {
  return restoreRemovedDefaults(sections).restored;
}

// ── Edits ────────────────────────────────────────────────────────────────────

/** Positional: the array's current order becomes the `order` values. */
function renumber(sections: InspectionTemplateSection[]): InspectionTemplateSection[] {
  return sections.map((s, si) => ({
    ...s,
    order: si,
    items: s.items.map((i, ii) => ({ ...i, order: ii })),
  }));
}

function mapSection(
  sections: InspectionTemplateSection[], sectionId: string,
  fn: (s: InspectionTemplateSection) => InspectionTemplateSection,
): InspectionTemplateSection[] {
  return sections.map((s) => (s.id === sectionId ? fn(s) : s));
}

export function renameSection(sections: InspectionTemplateSection[], sectionId: string, title: string) {
  const t = cleanLabel(title);
  return t ? mapSection(sections, sectionId, (s) => ({ ...s, title: t })) : sections;
}

export function renameItem(
  sections: InspectionTemplateSection[], sectionId: string, itemId: string, label: string,
) {
  const l = cleanLabel(label);
  if (!l) return sections;
  return mapSection(sections, sectionId, (s) => ({
    ...s, items: s.items.map((i) => (i.id === itemId ? { ...i, label: l } : i)),
  }));
}

export function setSectionHidden(sections: InspectionTemplateSection[], sectionId: string, hidden: boolean) {
  return mapSection(sections, sectionId, (s) => ({ ...s, hidden }));
}

export function setItemHidden(
  sections: InspectionTemplateSection[], sectionId: string, itemId: string, hidden: boolean,
) {
  return mapSection(sections, sectionId, (s) => ({
    ...s, items: s.items.map((i) => (i.id === itemId ? { ...i, hidden } : i)),
  }));
}

function swap<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

export function moveSection(sections: InspectionTemplateSection[], sectionId: string, dir: -1 | 1) {
  const sorted = sortedSections(sections);
  const from = sorted.findIndex((s) => s.id === sectionId);
  if (from < 0) return sections;
  return renumber(swap(sorted, from, from + dir));
}

export function moveItem(
  sections: InspectionTemplateSection[], sectionId: string, itemId: string, dir: -1 | 1,
) {
  return renumber(mapSection(sortedSections(sections), sectionId, (s) => {
    const from = s.items.findIndex((i) => i.id === itemId);
    return from < 0 ? s : { ...s, items: swap(s.items, from, from + dir) };
  }));
}

export function addSection(
  sections: InspectionTemplateSection[], title: string, genId: IdGenerator = randomId,
): { sections: InspectionTemplateSection[]; id: string | null } {
  const t = cleanLabel(title);
  if (!t) return { sections, id: null };
  const id = genId("s");
  const order = sections.reduce((m, s) => Math.max(m, s.order), -1) + 1;
  return {
    id,
    sections: [...sections, { id, title: t, hidden: false, order, isDefault: false, items: [] }],
  };
}

export function addItem(
  sections: InspectionTemplateSection[], sectionId: string, label: string, genId: IdGenerator = randomId,
): { sections: InspectionTemplateSection[]; id: string | null } {
  const l = cleanLabel(label);
  const target = sections.find((s) => s.id === sectionId);
  if (!l || !target) return { sections, id: null };
  const id = genId("i");
  const order = target.items.reduce((m, i) => Math.max(m, i.order), -1) + 1;
  return {
    id,
    sections: mapSection(sections, sectionId, (s) => ({
      ...s,
      items: [...s.items, { id, label: l, hidden: false, order, isDefault: false, defaultKey: null }],
    })),
  };
}

/**
 * "Restore removed defaults": un-hide default ITEMS (a hidden default section
 * is un-hidden too, otherwise its restored items would stay invisible — except
 * a section that ships hidden, i.e. Hybrid Components, which the center has to
 * switch on deliberately). Custom items and sections are never touched, and
 * labels / order the center chose are kept.
 */
export function restoreRemovedDefaults(
  sections: InspectionTemplateSection[],
): { sections: InspectionTemplateSection[]; restored: number } {
  const shipsHidden = new Set(DEFAULT_CHECKLIST.filter((s) => s.hiddenByDefault).map((s) => s.id));
  let restored = 0;
  const next = sections.map((s) => {
    const items = s.items.map((i) => {
      if (i.isDefault && i.hidden && !(s.isDefault && shipsHidden.has(s.id))) {
        restored += 1;
        return { ...i, hidden: false };
      }
      return i;
    });
    const unhideSection = s.isDefault && s.hidden && !shipsHidden.has(s.id);
    if (unhideSection) restored += 1;
    return { ...s, hidden: unhideSection ? false : s.hidden, items };
  });
  return { sections: next, restored };
}
