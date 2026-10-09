import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PERMISSIONS, LOCKED_OFF, mergeWithDefaults } from "./defaultPermissions.ts";
import type { RolePermissions } from "../types/permissions.ts";

const WRITES = ["create", "edit", "delete", "manageModels"] as const;

test("repairCatalog defaults: Manager has everything", () => {
  assert.deepEqual(DEFAULT_PERMISSIONS.manager.repairCatalog,
    { view: true, create: true, edit: true, delete: true, manageModels: true });
});

test("repairCatalog defaults: Technician, Cashier and Receptionist are view-only", () => {
  for (const role of ["technician", "cashier", "receptionist"] as const) {
    const p = DEFAULT_PERMISSIONS[role].repairCatalog;
    assert.equal(p.view, true, `${role} view`);
    for (const w of WRITES) assert.equal(p[w], false, `${role} ${w}`);
  }
});

test("repairCatalog: write permissions are locked off for the roles firestore.rules denies", () => {
  for (const role of ["technician", "cashier", "receptionist"] as const) {
    for (const w of WRITES) assert.ok(LOCKED_OFF[role].has(`repairCatalog.${w}`), `${role} ${w}`);
    assert.ok(!LOCKED_OFF[role].has("repairCatalog.view"));
  }
  assert.equal(LOCKED_OFF.manager.has("repairCatalog.create"), false);
});

test("a stored grid that predates the section still resolves from defaults", () => {
  const { repairCatalog: _omit, ...legacy } = DEFAULT_PERMISSIONS.receptionist;
  void _omit;
  const merged = mergeWithDefaults("receptionist", legacy as unknown as RolePermissions);
  assert.deepEqual(merged.repairCatalog, DEFAULT_PERMISSIONS.receptionist.repairCatalog);
  // ...and an owner's stored edit wins over the default.
  const edited = { ...legacy, repairCatalog: { view: false } } as unknown as RolePermissions;
  assert.equal(mergeWithDefaults("receptionist", edited).repairCatalog.view, false);
});
