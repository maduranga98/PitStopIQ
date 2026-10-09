import { test } from "node:test";
import assert from "node:assert/strict";
import { modelIdForKey, normalizeModelKey, normalizeTypeKey } from "./keys.ts";
import {
  findDuplicateModel, groupsForModel, nextGroupPriority, reorderPriorities, searchModels, sortGroups,
} from "./models.ts";
import { suggestLinks } from "./linking.ts";
import type { VehicleGroup, VehicleModel } from "../../types/repairCatalog.ts";
import type { Vehicle } from "../../types/auth.ts";

const model = (id: string, make: string, name: string, type = "motor bike", isActive = true): VehicleModel =>
  ({ id, make, model: name, vehicleType: type, key: normalizeModelKey(make, name), isActive } as VehicleModel);
const group = (id: string, name: string, priority: number, over: Partial<VehicleGroup> = {}): VehicleGroup =>
  ({ id, name, priority, modelIds: [], types: [], isActive: true, ...over } as VehicleGroup);

test("model key: trims, lowercases and collapses whitespace", () => {
  assert.equal(normalizeModelKey("  Honda ", " Dio  "), "honda dio");
  assert.equal(normalizeModelKey("HONDA", "Dio\t 110"), "honda dio 110");
  assert.equal(normalizeModelKey("Honda", "Dio"), normalizeModelKey("honda  ", "  DIO"));
  assert.equal(normalizeModelKey("", ""), "");
  assert.equal(normalizeTypeKey(" Motor  Bike "), "motor bike");
});

test("model id is deterministic per key and differs between keys", () => {
  assert.equal(modelIdForKey("honda dio"), modelIdForKey("honda dio"));
  assert.notEqual(modelIdForKey("honda dio"), modelIdForKey("honda dio 110"));
  assert.match(modelIdForKey("honda dio"), /^m_[0-9a-z]+$/);
});

test("duplicates are found regardless of case, spacing, or active state", () => {
  const models = [model("a", "Honda", "Dio"), model("b", "Bajaj", "Pulsar 150", "motor bike", false)];
  assert.equal(findDuplicateModel(models, " HONDA", "dio ")?.id, "a");
  assert.equal(findDuplicateModel(models, "bajaj", "Pulsar  150")?.id, "b"); // inactive still offered
  assert.equal(findDuplicateModel(models, "Honda", "Activa"), undefined);
  // Editing a model must not collide with itself.
  assert.equal(findDuplicateModel(models, "Honda", "Dio", "a"), undefined);
  assert.equal(findDuplicateModel(models, "", ""), undefined);
});

test("search matches every word across make, model and type", () => {
  const models = [model("a", "Honda", "Dio"), model("b", "Bajaj", "Pulsar 150"), model("c", "Toyota", "Aqua", "car")];
  assert.deepEqual(searchModels(models, "pulsar 150").map((m) => m.id), ["b"]);
  assert.deepEqual(searchModels(models, "honda dio").map((m) => m.id), ["a"]);
  assert.deepEqual(searchModels(models, "car").map((m) => m.id), ["c"]);
  assert.equal(searchModels(models, "").length, 3);
});

test("groups: lower priority number sorts first; new groups go last", () => {
  const groups = [group("a", "Sports", 3), group("b", "Scooters", 1), group("c", "All bikes", 2)];
  assert.deepEqual(sortGroups(groups).map((g) => g.id), ["b", "c", "a"]);
  assert.equal(nextGroupPriority(groups), 4);
  assert.equal(nextGroupPriority([]), 1);
});

test("groupsForModel: by id or by whole type, active only, in priority order", () => {
  const m = model("m1", "Honda", "Dio", "Motor Bike");
  const groups = [
    group("g3", "By type", 3, { types: ["motor  bike"] }),
    group("g1", "Listed", 1, { modelIds: ["m1"] }),
    group("g2", "Other", 2, { modelIds: ["zzz"] }),
    group("g4", "Off", 0, { modelIds: ["m1"], isActive: false }),
  ];
  assert.deepEqual(groupsForModel(groups, m).map((g) => g.id), ["g1", "g3"]);
});

test("reorder renumbers 1..n and returns only what changed", () => {
  const ordered = [group("a", "A", 1), group("b", "B", 2), group("c", "C", 3)];
  assert.deepEqual(reorderPriorities(ordered, 2, 0), [
    { id: "c", priority: 1 }, { id: "a", priority: 2 }, { id: "b", priority: 3 },
  ]);
  assert.deepEqual(reorderPriorities(ordered, 1, 1), []);
  assert.deepEqual(reorderPriorities(ordered, 0, 9), []);
  // Gaps in stored priorities are closed up.
  assert.deepEqual(reorderPriorities([group("a", "A", 5), group("b", "B", 9)], 0, 1), [
    { id: "b", priority: 1 }, { id: "a", priority: 2 },
  ]);
});

const veh = (id: string, make: string | undefined, name: string | undefined, over: Partial<Vehicle> = {}): Vehicle =>
  ({ id, make, model: name, vehicleType: "motor bike", isDeleted: false, ...over } as Vehicle);

test("link suggestions: only unlinked vehicles that match an active model exactly", () => {
  const models = [model("m1", "Honda", "Dio"), model("m2", "Bajaj", "Pulsar 150", "motor bike", false)];
  const vehicles = [
    veh("v1", "honda ", " DIO"),                 // matches
    veh("v2", "Honda", "Dio", { modelId: "m1" }), // already linked
    veh("v3", "Honda", "Activa"),                 // no such model
    veh("v4", "Bajaj", "Pulsar 150"),             // model inactive
    veh("v5", "Honda", undefined),                // make only: nothing to match
    veh("v6", "Honda", "Dio", { isDeleted: true }),
    veh("v7", "Honda", "Dio", { vehicleType: "scooter" }), // type differs: flagged, not hidden
  ];
  const out = suggestLinks(vehicles, models);
  assert.deepEqual(out.map((s) => s.vehicle.id), ["v1", "v7"]);
  assert.equal(out[0].typeMismatch, false);
  assert.equal(out[1].typeMismatch, true);
});
