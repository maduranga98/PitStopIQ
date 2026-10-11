import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addRepair, attachPartIds, customRepair, jobRepairContext, overrideRepairPrice, parsePrice, pickRepair,
  priceSourceText, removeRepair, repairsForPicker, type JobVehicle,
} from "./jobRepairs.ts";
import { addPartSnapshot, shortOfStock, suggestedPartRows } from "./jobParts.ts";
import type { InventoryItem, PartUsed } from "../../types/auth.ts";
import type { RepairItem, VehicleGroup, VehicleModel } from "../../types/repairCatalog.ts";

const models = [
  { id: "dio", vehicleType: "Motor Bike" }, { id: "pulsar", vehicleType: "Motor Bike" }, { id: "alto", vehicleType: "Car" },
] as VehicleModel[];
const group = (id: string, priority: number, over: Partial<VehicleGroup> = {}) =>
  ({ id, name: id === "scooters" ? "Scooters" : id, priority, modelIds: [], types: [], isActive: true, ...over }) as VehicleGroup;
const groups = [group("scooters", 1, { modelIds: ["dio"] }), group("bikes", 5, { types: ["motor bike"] })];

const repair = (id: string, over: Partial<RepairItem> = {}): RepairItem => ({
  id, name: id, category: "Service", defaultPrice: 1000, priceOverrides: [], suggestedParts: [], isActive: true,
  appliesTo: { all: false, types: [], groupIds: [], modelIds: [] }, ...over,
} as RepairItem);
const applies = (a: Partial<RepairItem["appliesTo"]>) => ({ all: false, types: [], groupIds: [], modelIds: [], ...a });

const dio: JobVehicle = { vehicleType: "Motor Bike", modelId: "dio" };

test("pricing at pick time: model beats group beats type beats default, and says where it came from", () => {
  const r = repair("oil", {
    defaultPrice: 1000,
    priceOverrides: [
      { scope: "type", scopeId: "motor bike", price: 1100 },
      { scope: "group", scopeId: "bikes", price: 1200 },
      { scope: "group", scopeId: "scooters", price: 1300 },
      { scope: "model", scopeId: "dio", price: 1400 },
    ],
  });
  const model = pickRepair(r, dio, models, groups);
  assert.deepEqual([model.entry.price, model.entry.resolvedFrom, model.entry.custom], [1400, "model", false]);
  // No model: the group the TYPE puts the vehicle in, then the type.
  const grp = pickRepair(r, { vehicleType: "motor bike" }, models, groups);
  assert.deepEqual([grp.entry.price, grp.entry.resolvedFrom, grp.entry.resolvedSourceId], [1200, "group", "bikes"]);
  const noGroupOverride = repair("x", { priceOverrides: [{ scope: "type", scopeId: " Motor  Bike ", price: 1100 }] });
  assert.deepEqual([pickRepair(noGroupOverride, { vehicleType: "motor bike" }, models, groups).entry.price], [1100]);
  const def = pickRepair(r, { vehicleType: "van" }, models, groups);
  assert.deepEqual([def.entry.price, def.entry.resolvedFrom], [1000, "default"]);
});

test("a group override wins by lowest priority number, with the group named in the label", () => {
  const r = repair("oil", { priceOverrides: [
    { scope: "group", scopeId: "bikes", price: 900 }, { scope: "group", scopeId: "scooters", price: 1300 },
  ] });
  const p = pickRepair(r, dio, models, groups);
  assert.deepEqual([p.entry.price, p.entry.resolvedSourceId], [1300, "scooters"]);
  assert.equal(priceSourceText(p.entry, groups), "Group: Scooters");
  assert.equal(priceSourceText({ custom: false, resolvedFrom: "model" }, groups), "Model price");
  assert.equal(priceSourceText({ custom: false, resolvedFrom: "type" }, groups), "Type price");
  assert.equal(priceSourceText({ custom: false, resolvedFrom: "default" }, groups), "Default");
  assert.equal(priceSourceText({ custom: true, resolvedFrom: "default" }, groups), "Custom");
});

test("an override keeps resolvedFrom as picked and marks the edit; the price stays frozen", () => {
  const r = repair("oil", { priceOverrides: [{ scope: "model", scopeId: "dio", price: 1400 }] });
  const { entry } = pickRepair(r, dio, models, groups);
  const edited = overrideRepairPrice([entry], "oil", 1250);
  assert.deepEqual([edited[0].price, edited[0].resolvedFrom, edited[0].priceOverridden], [1250, "model", true]);
  assert.equal(priceSourceText(edited[0], groups), "Model price · edited");
  // The catalog changing later does not touch the stored entry.
  const later = { ...r, defaultPrice: 5, priceOverrides: [] };
  assert.equal(edited[0].price, 1250);
  assert.notEqual(pickRepair(later, dio, models, groups).entry.price, edited[0].price);
});

test("applicability for the picker: most specific first, inactive never, show-all lists the rest", () => {
  const all = [
    repair("everything", { appliesTo: applies({ all: true }) }),
    repair("typeOnly", { appliesTo: applies({ types: ["MOTOR BIKE"] }) }),
    repair("viaGroup", { appliesTo: applies({ groupIds: ["scooters"] }) }),
    repair("viaModel", { appliesTo: applies({ modelIds: ["dio"] }) }),
    repair("carOnly", { appliesTo: applies({ types: ["car"] }) }),
    repair("retired", { isActive: false, appliesTo: applies({ all: true }) }),
  ];
  assert.deepEqual(repairsForPicker(all, dio, models, groups).map((r) => r.id), ["viaModel", "viaGroup", "typeOnly", "everything"]);
  // Show all: every active repair, applicable ones still first. Inactive stays hidden.
  assert.deepEqual(repairsForPicker(all, dio, models, groups, true).map((r) => r.id),
    ["viaModel", "viaGroup", "typeOnly", "everything", "carOnly"]);
});

test("a vehicle with no model matches by type, type groups and all, never by model", () => {
  const all = [
    repair("viaModel", { appliesTo: applies({ modelIds: ["dio"] }) }),
    repair("viaScooterGroup", { appliesTo: applies({ groupIds: ["scooters"] }) }), // model-only group
    repair("viaBikeGroup", { appliesTo: applies({ groupIds: ["bikes"] }) }),        // type group
    repair("everything", { appliesTo: applies({ all: true }) }),
  ];
  assert.deepEqual(repairsForPicker(all, { vehicleType: "motor bike" }, models, groups).map((r) => r.id), ["viaBikeGroup", "everything"]);
});

test("walk-in: filtered by the typed vehicle type only, no model or group matching", () => {
  const all = [
    repair("viaModel", { appliesTo: applies({ modelIds: ["dio"] }) }),
    repair("viaBikeGroup", { appliesTo: applies({ groupIds: ["bikes"] }) }),
    repair("typeOnly", { appliesTo: applies({ types: ["Motor Bike"] }) }),
    repair("everything", { appliesTo: applies({ all: true }) }),
  ];
  // Even a stray modelId is ignored for a walk-in.
  const walkIn: JobVehicle = { vehicleType: " motor bike ", modelId: "dio", walkIn: true };
  assert.deepEqual(repairsForPicker(all, walkIn, models, groups).map((r) => r.id), ["typeOnly", "everything"]);
  assert.equal(jobRepairContext(walkIn, models).modelId, undefined);
  // Nothing typed: only "all" repairs.
  assert.deepEqual(repairsForPicker(all, { walkIn: true }, models, groups).map((r) => r.id), ["everything"]);
  // Pricing for a walk-in ignores model and group overrides too.
  const priced = repair("oil", { priceOverrides: [
    { scope: "model", scopeId: "dio", price: 1 }, { scope: "group", scopeId: "bikes", price: 2 }, { scope: "type", scopeId: "motor bike", price: 3 },
  ] });
  assert.equal(pickRepair(priced, walkIn, models, groups).entry.price, 3);
});

test("custom repairs, and removing one entry touches nothing else", () => {
  const a = pickRepair(repair("a"), dio, models, groups).entry;
  const b = pickRepair(repair("b"), dio, models, groups).entry;
  const c = customRepair("  Weld exhaust ", 2500);
  assert.deepEqual([c.name, c.price, c.custom, c.resolvedFrom], ["Weld exhaust", 2500, true, "default"]);
  const list = addRepair(addRepair(addRepair([], a), b), c);
  assert.equal(addRepair(list, a), list); // a catalog repair is not added twice
  const withParts = attachPartIds(list, "a", ["p1", "p2"]);
  const after = removeRepair(withParts, "a");
  assert.deepEqual(after.map((r) => r.repairItemId), ["b", c.repairItemId]);
  assert.deepEqual(after[0], b);
  assert.deepEqual(parsePrice("1,250.50"), 1250.5);
  assert.equal(parsePrice("-1"), null);
  assert.equal(parsePrice("abc"), null);
});

const item = (id: string, over: Partial<InventoryItem> = {}) =>
  ({ id, name: `Part ${id}`, currentQty: 10, unit: "pcs", serviceCenterPrice: 500, purchasePrice: 300, ...over }) as unknown as InventoryItem;

test("addPartSnapshot: same snapshot and merge-by-itemId as the Add Part button", () => {
  const filter = item("f1", { partNumber: "OF-1", brand: "Sakura", hasWarranty: true, warrantyPeriodValue: 6, warrantyPeriodUnit: "months" });
  const one = addPartSnapshot([], filter, 2);
  assert.deepEqual(one, [{
    itemId: "f1", itemName: "Part f1", partNumber: "OF-1", brand: "Sakura",
    warranty: { value: 6, unit: "months" },
    quantity: 2, unitPrice: 500, unitCost: 500, costPrice: 300,
  }]);
  // Same item again: quantity adds, the first snapshot is kept, order unchanged.
  const other = addPartSnapshot(one, item("o1"), 1);
  const merged = addPartSnapshot(other, filter, 3);
  assert.deepEqual(merged.map((p) => [p.itemId, p.quantity]), [["f1", 5], ["o1", 1]]);
  assert.equal(addPartSnapshot([], item("n"), 1)[0].partNumber, undefined);
  // Falls back like the existing code: no service-center price -> marked price.
  const noPrice = item("m", { serviceCenterPrice: undefined, markedPrice: 700 } as Partial<InventoryItem>);
  assert.equal(addPartSnapshot([], noPrice, 1)[0].unitPrice, 700);
});

test("a repair-selected part lands in partsUsed (what stock deduction reads at Mark Done)", () => {
  const onJob: PartUsed[] = addPartSnapshot([], item("p1"), 1);
  const after = addPartSnapshot(onJob, item("p2"), 2);
  assert.deepEqual(after.map((p) => p.itemId), ["p1", "p2"]);
  assert.equal(after.find((p) => p.itemId === "p2")?.quantity, 2);
  assert.equal(after.every((p) => typeof p.unitPrice === "number" && typeof p.quantity === "number"), true);
});

test("suggested parts use the per-model / group / type quantity overrides and live stock", () => {
  const r = repair("oil", { suggestedParts: [
    { inventoryItemId: "oilfilter", defaultQty: 1 },
    { inventoryItemId: "engineoil", defaultQty: 1, overrides: [
      { scope: "type", scopeId: "motor bike", qty: 2 }, { scope: "group", scopeId: "scooters", qty: 3 }, { scope: "model", scopeId: "dio", qty: 4 },
    ] },
    { inventoryItemId: "gone", defaultQty: 1 },
    { inventoryItemId: "archived", defaultQty: 1 },
  ] });
  const inv = new Map([
    ["oilfilter", item("oilfilter", { currentQty: 7 })],
    ["engineoil", item("engineoil", { currentQty: 2 })],
    ["archived", item("archived", { isArchived: true } as Partial<InventoryItem>)],
  ]);
  const rowsFor = (v: JobVehicle) => suggestedPartRows(r, jobRepairContext(v, models), v.walkIn ? [] : groups, inv);
  const dioRows = rowsFor(dio);
  assert.deepEqual(dioRows.map((x) => [x.itemId, x.qty, x.available]), [["oilfilter", 1, 7], ["engineoil", 4, 2]]);
  assert.equal(rowsFor({ vehicleType: "motor bike" }).find((x) => x.itemId === "engineoil")?.qty, 2);
  assert.equal(rowsFor({ vehicleType: "car" }).find((x) => x.itemId === "engineoil")?.qty, 1);
  // Group override applies for a pulsar? Not in the scooters group: falls to the type.
  assert.equal(rowsFor({ vehicleType: "Motor Bike", modelId: "pulsar" }).find((x) => x.itemId === "engineoil")?.qty, 2);
});

test("stock warning: judged on what the job would hold; a warning only", () => {
  assert.equal(shortOfStock(5, 5), false);
  assert.equal(shortOfStock(5, 6), true);
  assert.equal(shortOfStock(5, 3, 3), true); // 3 already on the job + 3 more > 5
  assert.equal(shortOfStock(5, 2, 3), false);
});
