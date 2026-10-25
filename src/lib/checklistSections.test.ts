import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanSections, defaultChecklistSections, flattenSections, sectionsError, templateSections,
} from "./checklistSections.ts";
import type { ChecklistSection } from "../types/auth";

test("the seed has the four Halford-style sections, battery numerics and a technician section", () => {
  const sections = defaultChecklistSections();
  assert.deepEqual(sections.map((s) => s.title), ["Interior / Exterior", "Under Hood", "12V Battery", "Brake Service"]);
  assert.deepEqual(sections.map((s) => s.hasTechnician), [false, false, false, true]);
  const battery = sections[2].items.filter((i) => i.type === "status_numeric");
  assert.deepEqual(battery.map((i) => [i.label, i.unit]), [["Battery Charge", "V"], ["Battery Discharge", "V"], ["Battery Indicator", "V"]]);
  assert.equal(sections.flatMap((s) => s.items).filter((i) => i.type === "status_numeric").length, 3);
  assert.equal(sectionsError(sections), null);
});

test("seed ids are unique and orders run 0..n-1", () => {
  const items = defaultChecklistSections().flatMap((s) => s.items);
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
  for (const s of defaultChecklistSections()) assert.deepEqual(s.items.map((i) => i.order), s.items.map((_, n) => n));
});

test("a legacy template (flat items) reads as one status-only section", () => {
  const sections = templateSections({ items: [{ id: "b", label: "Second", order: 1 }, { id: "a", label: "First", order: 0 }] });
  assert.equal(sections.length, 1);
  assert.deepEqual(sections[0].items.map((i) => [i.id, i.label, i.type]), [["a", "First", "status"], ["b", "Second", "status"]]);
  assert.deepEqual(templateSections({ items: [] }), []);
});

test("a sectioned template wins over its flat items and comes back ordered", () => {
  const sections: ChecklistSection[] = [
    { id: "s2", title: "B", order: 1, hasTechnician: false, items: [] },
    { id: "s1", title: "A", order: 0, hasTechnician: true, items: [
      { id: "y", label: "Y", order: 1, type: "status" }, { id: "x", label: "X", order: 0, type: "status" }] },
  ];
  const out = templateSections({ items: [{ id: "old", label: "Old", order: 0 }], sections });
  assert.deepEqual(out.map((s) => s.id), ["s1", "s2"]);
  assert.deepEqual(out[0].items.map((i) => i.id), ["x", "y"]);
});

test("flattenSections mirrors every line, in order, renumbered", () => {
  const flat = flattenSections(defaultChecklistSections());
  assert.equal(flat.length, defaultChecklistSections().flatMap((s) => s.items).length);
  assert.deepEqual(flat.map((i) => i.order), flat.map((_, n) => n));
  assert.equal(flat[0].label, "Windshield / Glass");
});

test("cleanSections trims, drops blank rows and keeps a unit only on numeric items", () => {
  const dirty: ChecklistSection[] = [{
    id: "s", title: "  Battery ", order: 5, hasTechnician: true, items: [
      { id: "1", label: " Charge ", order: 9, type: "status_numeric", unit: " V " },
      { id: "2", label: "  ", order: 1, type: "status" },
      { id: "3", label: "Bracket", order: 2, type: "status", unit: "mm" },
      { id: "4", label: "Water", order: 3, type: "status_numeric", unit: "  " },
    ],
  }, { id: "blank", title: "", order: 6, hasTechnician: false, items: [{ id: "z", label: "", order: 0, type: "status" }] }];
  const out = cleanSections(dirty);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "Battery");
  assert.deepEqual(out[0].items, [
    { id: "1", label: "Charge", order: 0, type: "status_numeric", unit: "V" },
    { id: "3", label: "Bracket", order: 1, type: "status" },
    { id: "4", label: "Water", order: 2, type: "status_numeric" },
  ]);
});

test("sectionsError names what is wrong", () => {
  assert.match(sectionsError([]) ?? "", /at least one section/);
  const noTitle: ChecklistSection[] = [{ id: "s", title: "", order: 0, hasTechnician: false, items: [{ id: "i", label: "x", order: 0, type: "status" }] }];
  assert.match(sectionsError(noTitle) ?? "", /needs a title/);
  const noItems: ChecklistSection[] = [{ id: "s", title: "Hood", order: 0, hasTechnician: false, items: [] }];
  assert.match(sectionsError(noItems) ?? "", /no checks/);
});
