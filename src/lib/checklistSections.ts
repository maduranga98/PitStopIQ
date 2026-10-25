// Pure helpers for sectioned post-service checklists — no Firebase, so they are
// unit-testable and shared by the settings editor, the save path and (later)
// the fill form. See PostServiceChecklistTemplate.sections in types/auth.ts.
import type {
  ChecklistSection, ChecklistSectionItem, ChecklistItemType, PostServiceChecklistTemplate,
} from "../types/auth";

export const MAX_SECTIONS = 30;
export const MAX_ITEMS_PER_SECTION = 60;

let seq = 0;
function newId(prefix: string): string {
  seq += 1;
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${seq.toString(36)}`;
}

export function blankSectionItem(order: number, type: ChecklistItemType = "status"): ChecklistSectionItem {
  return { id: newId("i"), label: "", order, type };
}

export function blankSection(order: number): ChecklistSection {
  return { id: newId("s"), title: "", order, hasTechnician: false, items: [blankSectionItem(0)] };
}

/** Renumbers `order` to match array position. */
export function renumberAll<T extends { order: number }>(list: T[]): T[] {
  return list.map((x, order) => ({ ...x, order }));
}

/**
 * The sections a template should be edited / filled as. A template saved from
 * the sectioned editor returns its own; a legacy one (flat `items` only) is
 * shown as a single status-only section, so nothing needs migrating.
 */
export function templateSections(
  template: Pick<PostServiceChecklistTemplate, "sections" | "items">,
): ChecklistSection[] {
  if (template.sections && template.sections.length > 0) {
    return [...template.sections]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({ ...s, items: [...s.items].sort((a, b) => a.order - b.order) }));
  }
  const flat = [...(template.items ?? [])].sort((a, b) => a.order - b.order);
  if (flat.length === 0) return [];
  return [{
    id: "legacy",
    title: "Checks",
    order: 0,
    hasTechnician: false,
    items: flat.map((i, order) => ({ id: i.id, label: i.label, order, type: "status" as const })),
  }];
}

/** Drops blank rows and trims text, returning what is actually saved. */
export function cleanSections(sections: ChecklistSection[]): ChecklistSection[] {
  return renumberAll(
    sections
      .map((s) => ({
        ...s,
        title: s.title.trim(),
        hasTechnician: s.hasTechnician === true,
        items: renumberAll(
          s.items
            .filter((i) => i.label.trim().length > 0)
            .map((i) => {
              const base = { id: i.id, label: i.label.trim(), order: 0, type: i.type };
              const unit = (i.unit ?? "").trim();
              // A unit only means something next to a number.
              return i.type === "status_numeric" && unit ? { ...base, unit } : base;
            }),
        ),
      }))
      .filter((s) => s.title.length > 0 || s.items.length > 0),
  );
}

/** The first thing wrong with a set of sections, or null when it can be saved. */
export function sectionsError(sections: ChecklistSection[]): string | null {
  const cleaned = cleanSections(sections);
  if (cleaned.length === 0) return "Add at least one section with a check in it.";
  if (cleaned.length > MAX_SECTIONS) return `A checklist can have at most ${MAX_SECTIONS} sections.`;
  for (const s of cleaned) {
    if (!s.title) return "Every section needs a title.";
    if (s.items.length === 0) return `"${s.title}" has no checks — add one or remove the section.`;
    if (s.items.length > MAX_ITEMS_PER_SECTION) {
      return `"${s.title}" has more than ${MAX_ITEMS_PER_SECTION} checks.`;
    }
  }
  return null;
}

const status = (label: string, order: number): ChecklistSectionItem =>
  ({ id: `seed_${order}_${label.toLowerCase().replace(/[^a-z0-9]+/g, "")}`, label, order, type: "status" });
const numeric = (label: string, order: number, unit: string): ChecklistSectionItem =>
  ({ ...status(label, order), type: "status_numeric", unit });

function section(id: string, title: string, order: number, hasTechnician: boolean, items: ChecklistSectionItem[]): ChecklistSection {
  return { id, title, order, hasTechnician, items: items.map((i, n) => ({ ...i, order: n })) };
}

/**
 * What a center starts with when it first switches the module on: the layout
 * of a General Inspection Report sheet — Interior / Exterior, Under Hood,
 * 12V Battery (with the three voltage readings) and Brake Service (a technician
 * name per line). The owner edits it freely afterwards.
 */
export function defaultChecklistSections(): ChecklistSection[] {
  const s = status;
  return [
    section("interior_exterior", "Interior / Exterior", 0, false, [
      s("Windshield / Glass", 0), s("Wiper Washer Tank", 0), s("Wiper Nipple", 0), s("Wiper Arm", 0),
      s("Wiper Blade", 0), s("Rear Glass", 0), s("Rear Wiper", 0), s("Rear Wiper Blade", 0),
      s("Side Mirrors & Operation", 0), s("Head Lights", 0), s("Dim Lights", 0), s("Fog Lights Front", 0),
      s("Turning Lights Front", 0), s("Turning Lights Rear", 0), s("Parking Light Front", 0),
      s("Parking Lights Rear", 0), s("Brake Lights", 0), s("Reverse Lights", 0), s("Number Plate Light", 0),
      s("Spare Wheel", 0), s("Horn", 0),
    ]),
    section("under_hood", "Under Hood", 1, false, [
      s("Engine Oil Cap", 0), s("Engine Oil Dipstick", 0), s("Engine Oil Level", 0), s("ATF Dipstick", 0),
      s("ATF Level", 0), s("Coolant Reservoir", 0), s("Coolant Level", 0), s("Radiator Cap", 0),
      s("Power Steering Oil Level", 0), s("Brake Oil Level", 0), s("Inverter Coolant Level", 0),
      s("Differential Oil Level", 0), s("A/C Blower Fan Cleaning", 0), s("EV Blower Fan Cleaning", 0),
      s("Coolant Top-Up", 0), s("Power Steering Oil Top-Up", 0), s("Brake Oil Top-Up", 0),
      s("Inverter Coolant Top-Up", 0), s("Differential Oil Top-Up", 0), s("Dual Clutch", 0),
    ]),
    section("battery_12v", "12V Battery", 2, false, [
      numeric("Battery Charge", 0, "V"), numeric("Battery Discharge", 0, "V"),
      s("Battery Water Top-Up", 0), s("Battery Water Level", 0), numeric("Battery Indicator", 0, "V"),
      s("Battery Load", 0), s("Condition Report", 0), s("Battery Bracket", 0), s("Battery Terminal Loose", 0),
    ]),
    section("brake_service", "Brake Service", 3, true, [
      s("Front Caliper Pin Greasing", 0), s("Rear Caliper Pin Greasing", 0), s("Rear Brake Service", 0),
      s("BDC", 0), s("BDCCA", 0),
    ]),
  ].map((sec) => ({
    ...sec,
    // Stable, unique ids within the template regardless of how items were built.
    items: sec.items.map((i, n) => ({ ...i, id: `${sec.id}_${n}`, order: n })),
  }));
}
