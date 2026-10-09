import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePartQty, resolveRepairPrice, sourceLabel } from "./pricing.ts";
import { applicableRepairs, groupsForContext, repairApplies, vehicleContext } from "./applicability.ts";
import type { RepairItem, VehicleGroup, VehicleModel } from "../../types/repairCatalog.ts";

const group = (id: string, name: string, priority: number, over: Partial<VehicleGroup> = {}): VehicleGroup =>
  ({ id, name, priority, modelIds: [], types: [], isActive: true, ...over } as VehicleGroup);
const model = (id: string, make: string, name: string, type = "motor bike"): VehicleModel =>
  ({ id, make, model: name, vehicleType: type, key: "", isActive: true } as VehicleModel);
const repair = (over: Partial<RepairItem> = {}): RepairItem => ({
  id: "r1", name: "Brake pads", defaultPrice: 1000, priceOverrides: [], isActive: true,
  appliesTo: { all: false, types: [], groupIds: [], modelIds: [] }, suggestedParts: [], ...over,
} as RepairItem);

const dio = model("m_dio", "Honda", "Dio");
const groups = [
  group("g_sport", "Sports", 2, { modelIds: ["m_dio"] }),
  group("g_scoot", "Scooters", 1, { modelIds: ["m_dio"] }),
  group("g_bikes", "All bikes", 3, { types: ["Motor Bike"] }),
  group("g_off", "Off", 0, { modelIds: ["m_dio"], isActive: false }),
];
const ctx = vehicleContext({ vehicleType: "motor bike", modelId: "m_dio" }, [dio]);

test("price: model beats group beats type beats default, and the source is reported", () => {
  const overrides = [
    { scope: "type" as const, scopeId: "motor bike", price: 1200 },
    { scope: "group" as const, scopeId: "g_scoot", price: 1100 },
    { scope: "model" as const, scopeId: "m_dio", price: 900 },
  ];
  const r = repair({ priceOverrides: overrides });
  assert.deepEqual(resolveRepairPrice(r, ctx, groups), { value: 900, from: "model", sourceId: "m_dio" });
  assert.deepEqual(resolveRepairPrice(repair({ priceOverrides: overrides.slice(0, 2) }), ctx, groups),
    { value: 1100, from: "group", sourceId: "g_scoot" });
  assert.deepEqual(resolveRepairPrice(repair({ priceOverrides: overrides.slice(0, 1) }), ctx, groups),
    { value: 1200, from: "type", sourceId: "motor bike" });
  assert.deepEqual(resolveRepairPrice(repair(), ctx, groups), { value: 1000, from: "default" });
});

test("price: among groups the LOWER priority number wins, never the lowest price", () => {
  const r = repair({
    priceOverrides: [
      { scope: "group", scopeId: "g_sport", price: 500 },   // cheapest, priority 2
      { scope: "group", scopeId: "g_scoot", price: 1500 },  // dearest, priority 1
    ],
  });
  const res = resolveRepairPrice(r, ctx, groups);
  assert.equal(res.value, 1500);
  assert.equal(res.sourceId, "g_scoot");
  assert.equal(res.ambiguous, undefined);
});

test("price: equal priorities with different prices are flagged ambiguous, not silently cheapest", () => {
  const tied = [group("a", "Alpha", 1, { modelIds: ["m_dio"] }), group("b", "Beta", 1, { modelIds: ["m_dio"] })];
  const r = repair({ priceOverrides: [{ scope: "group", scopeId: "a", price: 900 }, { scope: "group", scopeId: "b", price: 700 }] });
  const res = resolveRepairPrice(r, ctx, tied);
  assert.equal(res.value, 900); // decided by name order (Alpha), not by price
  assert.equal(res.ambiguous, true);
  const same = repair({ priceOverrides: [{ scope: "group", scopeId: "a", price: 900 }, { scope: "group", scopeId: "b", price: 900 }] });
  assert.equal(resolveRepairPrice(same, ctx, tied).ambiguous, undefined);
});

test("price: inactive groups and groups the vehicle isn't in are ignored; type group membership counts", () => {
  const r = repair({ priceOverrides: [{ scope: "group", scopeId: "g_off", price: 1 }, { scope: "group", scopeId: "g_bikes", price: 1300 }] });
  assert.deepEqual(resolveRepairPrice(r, ctx, groups), { value: 1300, from: "group", sourceId: "g_bikes" });
  const other = vehicleContext({ vehicleType: "car" }, []);
  assert.equal(resolveRepairPrice(r, other, groups).from, "default");
});

test("price: type match is trim + lowercase; a vehicle with no model skips model and model-only groups", () => {
  const r = repair({ priceOverrides: [
    { scope: "type", scopeId: "  Motor   BIKE ", price: 1250 },
    { scope: "model", scopeId: "m_dio", price: 1 },
    { scope: "group", scopeId: "g_scoot", price: 2 },
  ] });
  const noModel = vehicleContext({ vehicleType: "motor bike" }, []);
  assert.deepEqual(resolveRepairPrice(r, noModel, groups).from, "type");
  assert.equal(resolveRepairPrice(r, noModel, groups).value, 1250);
});

test("price: a bad override is skipped rather than used", () => {
  const r = repair({ priceOverrides: [{ scope: "model", scopeId: "m_dio", price: Number.NaN }] });
  assert.deepEqual(resolveRepairPrice(r, ctx, groups), { value: 1000, from: "default" });
});

test("part quantity resolves the same way", () => {
  const part = { defaultQty: 1, overrides: [
    { scope: "group" as const, scopeId: "g_scoot", qty: 2 },
    { scope: "model" as const, scopeId: "m_dio", qty: 3 },
  ] };
  assert.deepEqual(resolvePartQty(part, ctx, groups), { value: 3, from: "model", sourceId: "m_dio" });
  assert.equal(resolvePartQty({ defaultQty: 1, overrides: [part.overrides[0]] }, ctx, groups).value, 2);
  assert.deepEqual(resolvePartQty({ defaultQty: 4 }, ctx, groups), { value: 4, from: "default" });
});

test("source labels read well", () => {
  assert.equal(sourceLabel({ from: "model", sourceId: "m_dio" }, groups, [dio]), "Model price (Honda Dio)");
  assert.equal(sourceLabel({ from: "group", sourceId: "g_scoot" }, groups, [dio]), "Group price (Scooters)");
  assert.equal(sourceLabel({ from: "type", sourceId: "motor bike" }, groups, [dio]), "Type price (motor bike)");
  assert.equal(sourceLabel({ from: "default" }, groups, [dio]), "Default price");
  assert.equal(sourceLabel({ from: "group", sourceId: "g_scoot" }, groups, [dio], "quantity"), "Group quantity (Scooters)");
});

// ── applicability ────────────────────────────────────────────────────────────
test("applies: all, type, model, or any group", () => {
  assert.equal(repairApplies({ all: true, types: [], groupIds: [], modelIds: [] }, ctx, groups), true);
  assert.equal(repairApplies({ all: false, types: [" MOTOR bike "], groupIds: [], modelIds: [] }, ctx, groups), true);
  assert.equal(repairApplies({ all: false, types: ["car"], groupIds: [], modelIds: [] }, ctx, groups), false);
  assert.equal(repairApplies({ all: false, types: [], groupIds: [], modelIds: ["m_dio"] }, ctx, groups), true);
  assert.equal(repairApplies({ all: false, types: [], groupIds: ["g_scoot"], modelIds: [] }, ctx, groups), true);
  // Through a group that covers the whole type.
  assert.equal(repairApplies({ all: false, types: [], groupIds: ["g_bikes"], modelIds: [] }, ctx, groups), true);
  assert.equal(repairApplies({ all: false, types: [], groupIds: ["unrelated"], modelIds: [] }, ctx, groups), false);
  // Nothing listed and not "all" applies to nothing.
  assert.equal(repairApplies({ all: false, types: [], groupIds: [], modelIds: [] }, ctx, groups), false);
  assert.equal(repairApplies(undefined, ctx, groups), false);
});

test("applies: an inactive group no longer makes a repair apply", () => {
  assert.equal(repairApplies({ all: false, types: [], groupIds: ["g_off"], modelIds: [] }, ctx, groups), false);
});

test("applies: a vehicle with no model never matches a model, nor a model-only group", () => {
  const noModel = vehicleContext({ vehicleType: "motor bike" }, []);
  assert.equal(repairApplies({ all: false, types: [], groupIds: [], modelIds: ["m_dio"] }, noModel, groups), false);
  assert.equal(repairApplies({ all: false, types: [], groupIds: ["g_scoot"], modelIds: [] }, noModel, groups), false);
  assert.equal(repairApplies({ all: false, types: [], groupIds: ["g_bikes"], modelIds: [] }, noModel, groups), true);
  assert.equal(repairApplies({ all: true, types: [], groupIds: [], modelIds: [] }, vehicleContext({}, []), groups), true);
});

test("context: the vehicle's own type wins; a bare model supplies its type", () => {
  assert.equal(vehicleContext({ vehicleType: "scooter", modelId: "m_dio" }, [dio]).type, "scooter");
  assert.equal(vehicleContext({ modelId: "m_dio" }, [dio]).type, "motor bike");
  assert.equal(vehicleContext({ vehicleType: "  " }, []).type, undefined);
});

test("groupsForContext is in priority order, active only", () => {
  assert.deepEqual(groupsForContext(ctx, groups).map((g) => g.id), ["g_scoot", "g_sport", "g_bikes"]);
});

test("applicableRepairs never offers inactive repairs", () => {
  const a = repair({ id: "a", appliesTo: { all: true, types: [], groupIds: [], modelIds: [] } });
  const b = repair({ id: "b", isActive: false, appliesTo: { all: true, types: [], groupIds: [], modelIds: [] } });
  const c = repair({ id: "c" });
  assert.deepEqual(applicableRepairs([a, b, c], ctx, groups).map((r) => r.id), ["a"]);
});
