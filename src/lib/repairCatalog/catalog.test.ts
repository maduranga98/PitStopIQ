import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addCategory, categoryList, changedFieldNames, copyName, detectEditConflict, filterRepairs,
  findDuplicateRepair, moveInList, renameCategory, repairsInCategory, stampMillis,
} from "./catalog.ts";
import { emptyForm, formFromRepair, toRepairData, validateForm } from "./form.ts";
import { canReadInventory } from "./access.ts";
import type { RepairItem } from "../../types/repairCatalog.ts";

const r = (id: string, name: string, category?: string, over: Partial<RepairItem> = {}): RepairItem =>
  ({ id, name, category, defaultPrice: 100, priceOverrides: [], suggestedParts: [], isActive: true,
     appliesTo: { all: true, types: [], groupIds: [], modelIds: [] }, ...over } as RepairItem);

test("categories: defaults when unset, owner order when set, used-but-unlisted appended", () => {
  assert.equal(categoryList(undefined, [])[0], "Engine");
  assert.deepEqual(categoryList(["Brakes", "Engine"], [r("1", "a", "engine"), r("2", "b", "Wiring")]), ["Brakes", "Engine", "Wiring"]);
});

test("categories: add and rename reject blanks and collisions", () => {
  assert.deepEqual(addCategory(["Engine"], "  Brakes "), { list: ["Engine", "Brakes"] });
  assert.ok("error" in addCategory(["Engine"], "engine"));
  assert.ok("error" in addCategory(["Engine"], "  "));
  assert.deepEqual(renameCategory(["Engine", "Brakes"], "Brakes", "Braking"), { list: ["Engine", "Braking"] });
  assert.ok("error" in renameCategory(["Engine", "Brakes"], "Brakes", "ENGINE"));
  // Changing only the case of itself is fine.
  assert.deepEqual(renameCategory(["Engine"], "Engine", "ENGINE"), { list: ["ENGINE"] });
  assert.deepEqual(moveInList(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
  assert.deepEqual(moveInList(["a", "b"], 0, 5), ["a", "b"]);
  assert.equal(repairsInCategory([r("1", "a", "Engine"), r("2", "b", "Brakes")], "engine").length, 1);
});

test("filter: words across name/description/category, category, inactive", () => {
  const list = [r("1", "Brake pad change", "Brakes"), r("2", "Oil change", "Engine", { description: "with filter" }), r("3", "Old", "Engine", { isActive: false })];
  assert.deepEqual(filterRepairs(list, { q: "change" }).map((x) => x.id), ["1", "2"]);
  assert.deepEqual(filterRepairs(list, { q: "engine filter" }).map((x) => x.id), ["2"]);
  assert.deepEqual(filterRepairs(list, { category: "ENGINE" }).map((x) => x.id), ["2"]);
  assert.deepEqual(filterRepairs(list, { showInactive: true, category: "Engine" }).map((x) => x.id), ["2", "3"]);
});

test("duplicate name: exact within a category only, ignoring case/spacing and the edited item", () => {
  const list = [r("1", "Oil change", "Engine")];
  assert.equal(findDuplicateRepair(list, "  OIL   change", "engine")?.id, "1");
  assert.equal(findDuplicateRepair(list, "Oil change", "Brakes"), undefined);
  assert.equal(findDuplicateRepair(list, "Oil change", "Engine", "1"), undefined);
  assert.equal(findDuplicateRepair(list, "", "Engine"), undefined);
});

test("copy name is unique within the category", () => {
  const list = [r("1", "Oil change", "Engine"), r("2", "Oil change (copy)", "Engine")];
  assert.equal(copyName(list, "Oil change", "Engine"), "Oil change (copy 2)");
  assert.equal(copyName(list, "Oil change", "Brakes"), "Oil change (copy)");
});

test("edit conflict: unchanged stamp is fine, a different one is a conflict", () => {
  const t = (ms: number) => ({ toMillis: () => ms });
  assert.equal(detectEditConflict(t(5), t(5)), false);
  assert.equal(detectEditConflict(t(5), t(6)), true);
  assert.equal(detectEditConflict(undefined, undefined), false); // legacy doc, never stamped
  assert.equal(detectEditConflict(undefined, t(6)), true);       // stamped since it opened
  assert.equal(stampMillis({ seconds: 2, nanoseconds: 5_000_000 }), 2005);
  assert.equal(stampMillis(null), null);
});

test("changed fields are named for the conflict warning", () => {
  const a = r("1", "Oil change", "Engine");
  const b = { ...a, suggestedParts: [{ inventoryItemId: "x", defaultQty: 1 }], defaultPrice: 150 };
  assert.deepEqual(changedFieldNames(a, b), ["default price", "suggested parts"]);
  assert.deepEqual(changedFieldNames(a, a), []);
});

test("form: validation blocks bad input and only warns on duplicate names", () => {
  const f = emptyForm("Engine");
  assert.ok(validateForm(f, []).errors.name);
  assert.ok(validateForm(f, []).errors.defaultPrice);
  const ok = { ...f, name: "Oil change", defaultPrice: "2500" };
  assert.deepEqual(validateForm(ok, []).errors, {});
  const dup = validateForm(ok, [{ id: "9", name: "oil change", category: "Engine" }]);
  assert.deepEqual(dup.errors, {});
  assert.equal(dup.warnings.length, 1);
  assert.equal(validateForm(ok, [{ id: "9", name: "oil change", category: "Engine" }], "9").warnings.length, 0);

  const scoped = { ...ok, appliesTo: { all: false, types: [], groupIds: [], modelIds: [] } };
  assert.ok(validateForm(scoped, []).errors.appliesTo);
  const mins = { ...ok, estimatedMinutes: "1.5" };
  assert.ok(validateForm(mins, []).errors.estimatedMinutes);

  const overrides = { ...ok, priceOverrides: [
    { scope: "model" as const, scopeId: "m1", price: "100" },
    { scope: "model" as const, scopeId: "M1", price: "200" },
    { scope: "type" as const, scopeId: "", price: "1" },
    { scope: "type" as const, scopeId: "car", price: "-5" },
  ] };
  const e = validateForm(overrides, []).errors;
  assert.ok(!e["override.0"] && e["override.1"] && e["override.2"] && e["override.3"]);

  const parts = { ...ok, suggestedParts: [
    { inventoryItemId: "i1", name: "Pad", defaultQty: "0", overrides: [] },
    { inventoryItemId: "i1", name: "Pad", defaultQty: "2", overrides: [] },
    { inventoryItemId: "i2", name: "Oil", defaultQty: "1", overrides: [{ scope: "model" as const, scopeId: "m1", qty: "x" }] },
  ] };
  const pe = validateForm(parts, []).errors;
  assert.ok(pe["part.0"] && pe["part.1"] && pe["part.2.0"]);
});

test("form: round trip through the stored shape", () => {
  const stored = r("1", "Brake pads", "Brakes", {
    description: "front", unit: "per item", estimatedMinutes: 45, defaultPrice: 1999.999,
    priceOverrides: [{ scope: "type", scopeId: "car", price: 2500 }],
    appliesTo: { all: false, types: ["car"], groupIds: ["g1"], modelIds: [] },
    suggestedParts: [{ inventoryItemId: "i1", defaultQty: 2, overrides: [{ scope: "model", scopeId: "m1", qty: 4 }] }, { inventoryItemId: "i2", defaultQty: 1 }],
  });
  const data = toRepairData(formFromRepair(stored, new Map([["i1", "Pad"]])));
  assert.equal(data.defaultPrice, 2000);
  assert.equal(data.estimatedMinutes, 45);
  assert.deepEqual(data.appliesTo, stored.appliesTo);
  assert.deepEqual(data.suggestedParts, stored.suggestedParts);
  // "All vehicles" drops any leftover scoped lists; blanks become undefined.
  const all = toRepairData({ ...formFromRepair(stored), appliesTo: { all: true, types: ["car"], groupIds: ["g1"], modelIds: ["m"] }, description: " ", estimatedMinutes: "" });
  assert.deepEqual(all.appliesTo, { all: true, types: [], groupIds: [], modelIds: [] });
  assert.equal(all.description, undefined);
  assert.equal(all.estimatedMinutes, undefined);
});

test("inventory access mirrors firestore.rules (Receptionist cannot read it)", () => {
  assert.equal(canReadInventory("Receptionist"), false);
  for (const role of ["Owner", "Manager", "Cashier", "Technician"] as const) assert.equal(canReadInventory(role), true);
  assert.equal(canReadInventory(undefined), false);
});
