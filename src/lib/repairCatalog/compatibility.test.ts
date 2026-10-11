import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyToolFilter, buildCompatibility, compatibilityEquals, compatibilityPayload, hasNoSellingPrice, isCompatibleWithTarget,
  isPartCompatible, isUnclassified, sortPartsForVehicle, NO_TOOL_FILTER,
  type CompatContext, type CompatItem,
} from "./compatibility.ts";
import { addPartLink, buildPartIndex, linkedRepairsFor, parseQty, removePartLink } from "./partLinks.ts";
import { MAX_BULK_ITEMS, WRITE_CHUNK, capSelection, chunk, planLinkToRepair, planSetCompatibility, runChunked } from "./bulk.ts";
import type { InventoryCompatibility, RepairItem, VehicleGroup, VehicleModel } from "../../types/repairCatalog.ts";

const model = (id: string, type = "motor bike") => ({ id, vehicleType: type } as VehicleModel);
const group = (id: string, over: Partial<VehicleGroup> = {}): VehicleGroup =>
  ({ id, name: id, priority: 0, modelIds: [], types: [], isActive: true, ...over } as VehicleGroup);
const compat = (over: Partial<InventoryCompatibility> = {}): InventoryCompatibility =>
  ({ universal: false, types: [], groupIds: [], modelIds: [], ...over });
const part = (id: string, c?: InventoryCompatibility, serviceCenterPrice?: number) =>
  ({ id, compatibility: c, serviceCenterPrice }) as CompatItem & { id: string };

const ctx: CompatContext = {
  models: [model("dio"), model("pulsar"), model("alto", "car")],
  groups: [
    group("scooters", { modelIds: ["dio"] }),
    group("allBikes", { types: ["Motor Bike"] }),
    group("retired", { modelIds: ["dio"], isActive: false }),
  ],
};

test("an item with no compatibility field is universal", () => {
  const item = part("a");
  assert.ok(isUnclassified(item));
  assert.ok(isPartCompatible(item, { vehicleType: "car", modelId: "alto" }, ctx));
  assert.ok(isPartCompatible(item, {}, ctx));
  // Explicit universal fits everything but is no longer unclassified.
  const explicit = part("b", compat({ universal: true }));
  assert.ok(!isUnclassified(explicit));
  assert.ok(isPartCompatible(explicit, { vehicleType: "van" }, ctx));
  // A stored object missing its arrays is read, not crashed on.
  assert.ok(isPartCompatible(part("c", { universal: true } as InventoryCompatibility), {}, ctx));
});

test("types match after trim + lowercase", () => {
  const item = part("a", compat({ types: ["Motor Bike"] }));
  assert.ok(isPartCompatible(item, { vehicleType: "  motor   bike " }, ctx));
  assert.ok(!isPartCompatible(item, { vehicleType: "car" }, ctx));
});

test("a model matches by id; its type is not enough on its own", () => {
  const item = part("a", compat({ modelIds: ["dio"] }));
  assert.ok(isPartCompatible(item, { vehicleType: "motor bike", modelId: "dio" }, ctx));
  assert.ok(!isPartCompatible(item, { vehicleType: "motor bike", modelId: "pulsar" }, ctx));
});

test("a group matches through the vehicle's model or its type; inactive groups never do", () => {
  const viaModel = part("a", compat({ groupIds: ["scooters"] }));
  assert.ok(isPartCompatible(viaModel, { vehicleType: "motor bike", modelId: "dio" }, ctx));
  assert.ok(!isPartCompatible(viaModel, { vehicleType: "motor bike", modelId: "pulsar" }, ctx));
  const viaType = part("b", compat({ groupIds: ["allBikes"] }));
  assert.ok(isPartCompatible(viaType, { vehicleType: "Motor Bike", modelId: "pulsar" }, ctx));
  const retired = part("c", compat({ groupIds: ["retired"] }));
  assert.ok(!isPartCompatible(retired, { vehicleType: "motor bike", modelId: "dio" }, ctx));
});

test("a vehicle without modelId matches only universal, its type, or a group's types[]", () => {
  const v = { vehicleType: "motor bike" };
  assert.ok(isPartCompatible(part("u"), v, ctx));
  assert.ok(isPartCompatible(part("t", compat({ types: ["motor bike"] })), v, ctx));
  assert.ok(isPartCompatible(part("g", compat({ groupIds: ["allBikes"] })), v, ctx));
  assert.ok(!isPartCompatible(part("m", compat({ modelIds: ["dio"] })), v, ctx));
  assert.ok(!isPartCompatible(part("g2", compat({ groupIds: ["scooters"] })), v, ctx)); // model-only group
  // No type either: only universal items fit.
  assert.ok(!isPartCompatible(part("t2", compat({ types: ["motor bike"] })), {}, ctx));
});

test("the vehicle's type falls back to its model's when the vehicle has none", () => {
  const item = part("a", compat({ types: ["motor bike"] }));
  assert.ok(isPartCompatible(item, { modelId: "dio" }, ctx));
});

test("specific compatibility with nothing picked fits no vehicle", () => {
  assert.ok(!isPartCompatible(part("a", compat()), { vehicleType: "car", modelId: "alto" }, ctx));
});

test("sortPartsForVehicle: compatible first, then the rest, both in the original order", () => {
  const items = [
    part("1", compat({ modelIds: ["pulsar"] })),
    part("2"),
    part("3", compat({ types: ["car"] })),
    part("4", compat({ modelIds: ["dio"] })),
    part("5", compat({ groupIds: ["scooters"] })),
    part("6", compat({ universal: true })),
  ];
  const snapshot = items.map((i) => i.id);
  const sorted = sortPartsForVehicle(items, { vehicleType: "motor bike", modelId: "dio" }, ctx);
  assert.deepEqual(sorted.map((i) => i.id), ["2", "4", "5", "6", "1", "3"]);
  assert.deepEqual(items.map((i) => i.id), snapshot); // input untouched
  // Nothing compatible: unchanged order.
  const none = [part("a", compat({ types: ["van"] })), part("b", compat({ types: ["lorry"] }))];
  assert.deepEqual(sortPartsForVehicle(none, { vehicleType: "car" }, ctx).map((i) => i.id), ["a", "b"]);
});

test("buildCompatibility / compatibilityEquals", () => {
  assert.deepEqual(buildCompatibility({ universal: true, types: ["car"] }), compat({ universal: true }));
  assert.deepEqual(buildCompatibility({ universal: false, types: ["Car", " car ", "Van"], modelIds: ["a", "a"] }),
    compat({ types: ["Car", "Van"], modelIds: ["a"] }));
  assert.ok(compatibilityEquals(compat({ modelIds: ["a", "b"] }), compat({ modelIds: ["b", "a"] })));
  assert.ok(compatibilityEquals(compat({ types: ["Car"] }), compat({ types: [" car"] })));
  assert.ok(!compatibilityEquals(compat({ modelIds: ["a"] }), compat({ modelIds: ["a", "b"] })));
  assert.ok(!compatibilityEquals(undefined, compat({ universal: true })));
  assert.ok(compatibilityEquals(undefined, undefined));
});

// ── Filters ──────────────────────────────────────────────────────────────────

test("Unclassified: only items with no compatibility set", () => {
  const items = [part("a"), part("b", compat({ universal: true })), part("c", compat({ types: ["car"] }))];
  const out = applyToolFilter(items, { ...NO_TOOL_FILTER, unclassified: true }, ctx);
  assert.deepEqual(out.map((i) => i.id), ["a"]);
});

test("No selling price: serviceCenterPrice AND markedPrice both missing, 0 or invalid", () => {
  const priced = (id: string, serviceCenterPrice?: number | null, markedPrice?: number | null) =>
    ({ id, serviceCenterPrice, markedPrice }) as CompatItem & { id: string };
  assert.ok(hasNoSellingPrice(priced("a")));
  assert.ok(hasNoSellingPrice(priced("a", 0, 0)));
  assert.ok(hasNoSellingPrice(priced("a", null, null)));
  assert.ok(hasNoSellingPrice(priced("a", -1, Number.NaN)));
  // Either price alone is a selling price (serviceCenterPriceOf would use it).
  assert.ok(!hasNoSellingPrice(priced("b", 250)));
  assert.ok(!hasNoSellingPrice(priced("c", undefined, 300)));
  assert.ok(!hasNoSellingPrice(priced("d", 0, 300)));
  const items = [priced("a", 0), priced("b", 100), priced("c"), priced("d", undefined, 80)];
  const out = applyToolFilter(items, { ...NO_TOOL_FILTER, noSellingPrice: true }, ctx);
  assert.deepEqual(out.map((i) => i.id), ["a", "c"]);
});

test("flag off or section untouched: the item payload gains no compatibility key at all", () => {
  const value = buildCompatibility({ universal: false, types: ["car"] });
  // Module off, whatever the form holds: exactly the pre-Phase-5 payload.
  const base = { name: "Oil filter", currentQty: 3 };
  const off = { ...base, ...compatibilityPayload(false, true, value) };
  assert.deepEqual(off, base);
  assert.ok(!("compatibility" in off));
  assert.equal(JSON.stringify(off), JSON.stringify(base));
  // Module on, owner never touched the section (editing an unclassified item).
  const untouched = { ...base, ...compatibilityPayload(true, false, buildCompatibility({ universal: true })) };
  assert.ok(!("compatibility" in untouched));
  assert.equal(JSON.stringify(untouched), JSON.stringify(base));
  // Module on and changed: the only case that writes it.
  assert.deepEqual(compatibilityPayload(true, true, value), { compatibility: value });
});

test("vehicle in several groups: a part listing any one of them fits", () => {
  const multi: CompatContext = {
    models: [model("dio")],
    groups: [group("g1", { modelIds: ["dio"] }), group("g2", { modelIds: ["dio"] }), group("g3", { modelIds: ["pulsar"] })],
  };
  const v = { vehicleType: "motor bike", modelId: "dio" };
  assert.ok(isPartCompatible(part("a", compat({ groupIds: ["g2"] })), v, multi));
  assert.ok(isPartCompatible(part("b", compat({ groupIds: ["g3", "g1"] })), v, multi));
  assert.ok(!isPartCompatible(part("c", compat({ groupIds: ["g3"] })), v, multi));
});

test("type case and spacing differ on either side", () => {
  const upper = part("a", compat({ types: ["  CAR "] }));
  assert.ok(isPartCompatible(upper, { vehicleType: "car" }, ctx));
  assert.ok(isPartCompatible(upper, { vehicleType: " Car" }, ctx));
  // A group's types[] is compared the same way.
  const g = part("b", compat({ groupIds: ["allBikes"] }));
  assert.ok(isPartCompatible(g, { vehicleType: " MOTOR   bike " }, ctx));
  assert.ok(!isPartCompatible(g, { vehicleType: "car" }, ctx));
});

test("a vehicle whose model is not in the catalog behaves as a vehicle with no model", () => {
  const v = { vehicleType: "car", modelId: "deleted-model" };
  assert.ok(isPartCompatible(part("u"), v, ctx));
  assert.ok(isPartCompatible(part("t", compat({ types: ["car"] })), v, ctx));
  assert.ok(!isPartCompatible(part("m", compat({ modelIds: ["alto"] })), v, ctx));
});

test("partsIndex: one map for the whole catalog, an item in several repairs, none for an unlinked item", () => {
  const repairs = [
    repair("r1", "A", [{ inventoryItemId: "i1", defaultQty: 1 }, { inventoryItemId: "i2", defaultQty: 2 }]),
    repair("r2", "B", [{ inventoryItemId: "i1", defaultQty: 3 }]),
    repair("r3", "C", []),
  ];
  const idx = buildPartIndex(repairs);
  assert.deepEqual([...idx.keys()].sort(), ["i1", "i2"]);
  assert.deepEqual(idx.get("i1")?.map((l) => [l.repair.id, l.defaultQty]), [["r1", 1], ["r2", 3]]);
  assert.equal(idx.get("i9"), undefined);
});

test("capSelection: a single bulk run is capped at 500 and says it was cut", () => {
  assert.equal(MAX_BULK_ITEMS, 500);
  const ids = Array.from({ length: 1200 }, (_, i) => `i${i}`);
  const c = capSelection(ids);
  assert.equal(c.ids.length, 500);
  assert.deepEqual([c.total, c.capped], [1200, true]);
  assert.equal(c.ids[0], "i0");
  const exact = capSelection(ids.slice(0, 500));
  assert.deepEqual([exact.ids.length, exact.capped], [500, false]);
  // 500 items still fit in two batches under Firestore's 500-write limit.
  assert.equal(chunk(c.ids).length, 2);
});

test("filters combine with AND, and no active filter returns the same list", () => {
  const items = [part("a", undefined, 0), part("b", undefined, 50), part("c", compat({ types: ["car"] }), 0)];
  assert.equal(applyToolFilter(items, NO_TOOL_FILTER, ctx), items);
  const both = applyToolFilter(items, { ...NO_TOOL_FILTER, unclassified: true, noSellingPrice: true }, ctx);
  assert.deepEqual(both.map((i) => i.id), ["a"]);
});

test("Compatible with: type, group and model targets", () => {
  const items = [
    part("uni"),
    part("dio", compat({ modelIds: ["dio"] })),
    part("bike", compat({ types: ["motor bike"] })),
    part("car", compat({ types: ["car"] })),
    part("grp", compat({ groupIds: ["scooters"] })),
  ];
  const ids = (target: Parameters<typeof isCompatibleWithTarget>[1]) =>
    items.filter((i) => isCompatibleWithTarget(i, target, ctx)).map((i) => i.id);
  assert.deepEqual(ids({ kind: "type", id: "Motor Bike" }), ["uni", "bike"]);
  assert.deepEqual(ids({ kind: "type", id: "car" }), ["uni", "car"]);
  assert.deepEqual(ids({ kind: "model", id: "dio" }), ["uni", "dio", "bike", "grp"]);
  assert.deepEqual(ids({ kind: "group", id: "scooters" }), ["uni", "grp"]);
  const filtered = applyToolFilter(items, { ...NO_TOOL_FILTER, compatibleWith: { kind: "model", id: "pulsar" } }, ctx);
  assert.deepEqual(filtered.map((i) => i.id), ["uni", "bike"]);
});

// ── Links ────────────────────────────────────────────────────────────────────

const repair = (id: string, name: string, parts: { inventoryItemId: string; defaultQty: number }[], isActive = true) =>
  ({ id, name, suggestedParts: parts, isActive }) as unknown as RepairItem;

test("the used-for-repairs view is derived from suggestedParts alone", () => {
  const repairs = [
    repair("r1", "Oil change", [{ inventoryItemId: "i1", defaultQty: 1 }, { inventoryItemId: "i2", defaultQty: 2 }]),
    repair("r2", "Brake job", [{ inventoryItemId: "i1", defaultQty: 4 }]),
    repair("r3", "Retired", [{ inventoryItemId: "i1", defaultQty: 1 }], false),
  ];
  const linked = linkedRepairsFor("i1", repairs);
  assert.deepEqual(linked.map((l) => [l.repair.name, l.defaultQty]), [["Brake job", 4], ["Oil change", 1], ["Retired", 1]]);
  assert.equal(linkedRepairsFor("nope", repairs).length, 0);
  assert.equal(buildPartIndex(repairs).get("i2")?.length, 1);
});

test("addPartLink is idempotent and keeps an existing entry untouched", () => {
  const existing = [{ inventoryItemId: "i1", defaultQty: 2, overrides: [{ scope: "model" as const, scopeId: "dio", qty: 1 }] }];
  assert.equal(addPartLink(existing, "i1", 9), existing);
  const added = addPartLink(existing, "i2", 3);
  assert.deepEqual(added, [...existing, { inventoryItemId: "i2", defaultQty: 3 }]);
  assert.equal(existing.length, 1);
});

test("removePartLink removes only that part's entry", () => {
  const parts = [{ inventoryItemId: "i1", defaultQty: 1 }, { inventoryItemId: "i2", defaultQty: 2, overrides: [] }];
  assert.deepEqual(removePartLink(parts, "i1"), [parts[1]]);
  assert.equal(removePartLink(parts, "zzz"), parts);
  assert.equal(parts.length, 2);
});

test("parseQty accepts positive numbers only", () => {
  assert.equal(parseQty("2.5"), 2.5);
  assert.equal(parseQty(" 1 "), 1);
  for (const bad of ["", "0", "-1", "abc", NaN]) assert.equal(parseQty(bad as string), null);
});

// ── Bulk ─────────────────────────────────────────────────────────────────────

test("planSetCompatibility: previews changes, skips items already holding the value", () => {
  const target = compat({ modelIds: ["dio"] });
  const items = [
    part("a"), // unclassified
    part("b", compat({ modelIds: ["dio"] })), // already
    part("c", compat({ universal: true })),
    part("d", compat({ modelIds: ["dio"] })),
  ];
  const plan = planSetCompatibility(items, target);
  assert.deepEqual(plan.toChange.map((i) => i.id), ["a", "c"]);
  assert.deepEqual(plan.unchanged.map((i) => i.id), ["b", "d"]);
  assert.equal(plan.fromUnclassified, 1);
  // Setting "all vehicles" on an unclassified item is a real change (it becomes classified).
  assert.equal(planSetCompatibility([part("a")], compat({ universal: true })).toChange.length, 1);
});

test("planLinkToRepair: adds missing parts at the default qty, leaves linked ones alone", () => {
  const r = repair("r1", "Oil change", [{ inventoryItemId: "i1", defaultQty: 2 }]);
  const plan = planLinkToRepair([{ id: "i1" }, { id: "i2" }, { id: "i3" }, { id: "i2" }], r, 1);
  assert.deepEqual(plan.toAdd.map((i) => i.id), ["i2", "i3"]);
  assert.deepEqual(plan.alreadyLinked.map((i) => i.id), ["i1", "i2"]); // the repeated i2 counts once as added
  assert.deepEqual(plan.nextParts, [
    { inventoryItemId: "i1", defaultQty: 2 },
    { inventoryItemId: "i2", defaultQty: 1 },
    { inventoryItemId: "i3", defaultQty: 1 },
  ]);
  assert.equal(r.suggestedParts.length, 1); // the repair itself is not mutated
  // Re-planning against the result adds nothing: a retry is a no-op.
  const again = planLinkToRepair([{ id: "i2" }, { id: "i3" }], { suggestedParts: plan.nextParts }, 1);
  assert.equal(again.toAdd.length, 0);
});

test("chunk splits at the limit and never exceeds a Firestore batch", () => {
  assert.ok(WRITE_CHUNK < 500);
  const ids = Array.from({ length: 1000 }, (_, i) => i);
  const parts = chunk(ids);
  assert.deepEqual(parts.map((p) => p.length), [400, 400, 200]);
  assert.deepEqual(parts.flat(), ids);
  assert.deepEqual(chunk([], 10), []);
  assert.deepEqual(chunk([1, 2, 3], 2), [[1, 2], [3]]);
  assert.throws(() => chunk([1], 0));
});

test("runChunked reports progress after each chunk", async () => {
  const seen: number[] = [];
  const progress: Array<[number, number]> = [];
  const res = await runChunked(chunk([1, 2, 3, 4, 5], 2), async (c) => { seen.push(...c); }, {
    onProgress: (p) => progress.push([p.done, p.total]),
  });
  assert.deepEqual(seen, [1, 2, 3, 4, 5]);
  assert.deepEqual(res, { done: 5, total: 5, failedAt: null });
  assert.deepEqual(progress, [[0, 5], [2, 5], [4, 5], [5, 5]]);
});

test("runChunked stops at the first failure and can resume from there; reruns are idempotent", async () => {
  const store = new Map<string, string>();
  let failOnce = true;
  const write = async (c: string[], index: number) => {
    if (index === 1 && failOnce) { failOnce = false; throw new Error("offline"); }
    for (const id of c) store.set(id, "compat"); // a fixed value: writing twice is the same as once
  };
  const chunks = chunk(["a", "b", "c", "d", "e"], 2);
  const first = await runChunked(chunks, write);
  assert.equal(first.failedAt, 1);
  assert.equal(first.done, 2);
  assert.deepEqual([...store.keys()], ["a", "b"]);
  // Resume where it stopped.
  const resumed = await runChunked(chunks, write, { startAt: first.failedAt! });
  assert.deepEqual(resumed, { done: 5, total: 5, failedAt: null });
  // Re-running everything from the start leaves the same final state.
  const before = JSON.stringify([...store]);
  await runChunked(chunks, write);
  assert.equal(JSON.stringify([...store]), before);
  assert.equal(store.size, 5);
});

test("runChunked with nothing to write completes immediately", async () => {
  assert.deepEqual(await runChunked([], async () => { throw new Error("never"); }), { done: 0, total: 0, failedAt: null });
});
