// Run with: npm test   (node --test, TypeScript stripped natively by Node)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDefaultSections, visibleSections, sortedSections, renameItem, renameSection, setItemHidden,
  setSectionHidden, moveItem, moveSection, addItem, addSection, restoreRemovedDefaults,
  countRemovedDefaults, cleanLabel, type IdGenerator,
} from "./templateOps.ts";

let n = 0;
const gen: IdGenerator = (p) => `${p}_t${++n}`;
const find = (secs: ReturnType<typeof buildDefaultSections>, sid: string) => secs.find((s) => s.id === sid)!;

test("seed: 7 sections, 62 default items, only Hybrid hidden, ids stable", () => {
  const s = buildDefaultSections();
  assert.equal(s.length, 7);
  assert.equal(s.reduce((t, x) => t + x.items.length, 0), 62);
  assert.deepEqual(s.filter((x) => x.hidden).map((x) => x.id), ["hybrid"]);
  assert.ok(s.every((x) => x.isDefault && x.items.every((i) => i.isDefault && i.defaultKey === i.id && !i.hidden)));
  assert.equal(find(s, "operational").items[0].id, "operational__engine_noise");
  assert.deepEqual(s.map((x) => x.order), [0, 1, 2, 3, 4, 5, 6]);
});

test("visibleSections hides hidden sections and items, in order", () => {
  let s = buildDefaultSections();
  assert.equal(visibleSections(s).length, 6); // Hybrid hidden by default
  s = setItemHidden(s, "underhood", "underhood__battery", true);
  assert.equal(find(visibleSections(s), "underhood").items.length, 6);
  s = setSectionHidden(s, "hybrid", false);
  assert.equal(visibleSections(s).length, 7);
});

test("hiding never deletes: the item is still in the template", () => {
  const s = setItemHidden(buildDefaultSections(), "body", "body__glass", true);
  const item = find(s, "body").items.find((i) => i.id === "body__glass");
  assert.equal(item?.hidden, true);
  assert.equal(find(s, "body").items.length, 8);
});

test("rename keeps the id and defaultKey; empty names are rejected", () => {
  const s = renameItem(buildDefaultSections(), "functional", "functional__horn", "  Horn   and  siren ");
  const item = find(s, "functional").items.find((i) => i.id === "functional__horn")!;
  assert.equal(item.label, "Horn and siren");
  assert.equal(item.defaultKey, "functional__horn");
  const base = buildDefaultSections();
  assert.deepEqual(renameItem(base, "functional", "functional__horn", "   "), base);
  assert.deepEqual(renameSection(base, "body", ""), base);
  assert.equal(find(renameSection(base, "body", "Exterior"), "body").title, "Exterior");
  assert.equal(cleanLabel("a".repeat(500)).length, 200);
});

test("moveItem swaps neighbours, renumbers, and stops at the ends", () => {
  const s = moveItem(buildDefaultSections(), "underhood", "underhood__battery", -1);
  const ids = (x: typeof s) => sortedSections(x).find((y) => y.id === "underhood")!.items.map((i) => i.id);
  assert.deepEqual(ids(s).slice(0, 4), ["underhood__spark_plugs", "underhood__battery", "underhood__air_filter", "underhood__fluid_levels"]);
  assert.deepEqual(find(s, "underhood").items.map((i) => i.order), [0, 1, 2, 3, 4, 5, 6]);
  const first = moveItem(buildDefaultSections(), "underhood", "underhood__spark_plugs", -1);
  assert.deepEqual(ids(first), ids(buildDefaultSections()));
});

test("moveSection reorders sections", () => {
  const s = moveSection(buildDefaultSections(), "body", -1);
  assert.deepEqual(sortedSections(s).map((x) => x.id).slice(0, 4), ["operational", "underbody", "body", "underhood"]);
  assert.deepEqual(sortedSections(s).map((x) => x.order), [0, 1, 2, 3, 4, 5, 6]);
});

test("addSection / addItem append custom, non-default entries with fresh ids", () => {
  const a = addSection(buildDefaultSections(), " Trailer ", gen);
  assert.ok(a.id);
  const sec = find(a.sections, a.id!);
  assert.deepEqual([sec.title, sec.isDefault, sec.hidden, sec.order, sec.items.length], ["Trailer", false, false, 7, 0]);
  const b = addItem(a.sections, a.id!, "Hitch ball", gen);
  const item = find(b.sections, a.id!).items[0];
  assert.deepEqual([item.label, item.isDefault, item.defaultKey, item.order], ["Hitch ball", false, null, 0]);
  assert.equal(addItem(a.sections, "nope", "x", gen).id, null);
  assert.equal(addItem(a.sections, a.id!, "  ", gen).id, null);
  assert.equal(addSection(a.sections, "", gen).id, null);
  const c = addItem(buildDefaultSections(), "body", "Roof rack", gen);
  assert.equal(find(c.sections, "body").items.at(-1)!.order, 8);
});

test("restore un-hides default items only and leaves custom items alone", () => {
  let s = buildDefaultSections();
  s = setItemHidden(s, "body", "body__glass", true);
  s = setItemHidden(s, "scan", "scan__abs", true);
  const withCustom = addItem(s, "body", "Roof rack", gen);
  s = setItemHidden(withCustom.sections, "body", withCustom.id!, true); // hidden custom item
  s = renameItem(s, "body", "body__glass", "Windscreen only");
  assert.equal(countRemovedDefaults(s), 2);
  const { sections, restored } = restoreRemovedDefaults(s);
  assert.equal(restored, 2);
  const body = find(sections, "body");
  assert.equal(body.items.find((i) => i.id === "body__glass")!.hidden, false);
  assert.equal(body.items.find((i) => i.id === "body__glass")!.label, "Windscreen only"); // label kept
  assert.equal(body.items.find((i) => i.id === withCustom.id)!.hidden, true); // custom untouched
  assert.equal(countRemovedDefaults(sections), 0);
});

test("restore un-hides a hidden default section but not Hybrid (ships hidden)", () => {
  let s = setSectionHidden(buildDefaultSections(), "underhood", true);
  const r = restoreRemovedDefaults(s);
  assert.equal(find(r.sections, "underhood").hidden, false);
  assert.equal(find(r.sections, "hybrid").hidden, true);
  assert.equal(r.restored, 1);
  // A hidden item inside Hybrid stays hidden too.
  s = setItemHidden(buildDefaultSections(), "hybrid", "hybrid__hv_ecu", true);
  assert.equal(restoreRemovedDefaults(s).restored, 0);
  // A custom hidden section is never restored.
  const custom = addSection(buildDefaultSections(), "Mine", gen);
  const hiddenCustom = setSectionHidden(custom.sections, custom.id!, true);
  assert.equal(find(restoreRemovedDefaults(hiddenCustom).sections, custom.id!).hidden, true);
});

test("operations do not mutate their input", () => {
  const base = buildDefaultSections();
  const snapshot = JSON.stringify(base);
  setItemHidden(base, "body", "body__glass", true);
  moveItem(base, "body", "body__glass", 1);
  addItem(base, "body", "x", gen);
  restoreRemovedDefaults(base);
  assert.equal(JSON.stringify(base), snapshot);
});
