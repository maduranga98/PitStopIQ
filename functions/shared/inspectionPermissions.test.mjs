import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectionPermission as perm, INSPECTION_PERMISSION_KEYS as KEYS } from "./inspectionPermissions.mjs";

const pro = (extra = {}) => ({ isPro: true, ...extra });

test("Owner always has everything, whatever the stored grid says", () => {
  for (const k of KEYS) assert.equal(perm({ role: "Owner", isPro: true, rolePermissions: { owner: { inspectionReports: { [k]: false } } } }, k), true);
});

test("Basic plan: the role defaults", () => {
  assert.deepEqual(KEYS.map((k) => perm({ role: "Manager", isPro: false }, k)), [true, true, true, true, true, false, true]);
  assert.deepEqual(KEYS.map((k) => perm({ role: "Technician", isPro: false }, k)), [true, false, true, false, false, false, false]);
  assert.deepEqual(KEYS.map((k) => perm({ role: "Cashier", isPro: false }, k)), [true, false, false, false, false, false, false]);
  assert.deepEqual(KEYS.map((k) => perm({ role: "Receptionist", isPro: false }, k)), [true, false, false, false, false, false, false]);
  assert.equal(perm({ role: "Mystery", isPro: false }, "view"), false);
});

test("Pro: the Owner can switch a permission off below the ceiling", () => {
  const rolePermissions = { manager: { inspectionReports: { finalize: false } }, technician: { inspectionReports: { edit: false } } };
  assert.equal(perm(pro({ role: "Manager", rolePermissions }), "finalize"), false);
  assert.equal(perm(pro({ role: "Manager", rolePermissions }), "send"), true); // unmentioned key keeps its default
  assert.equal(perm(pro({ role: "Technician", rolePermissions }), "edit"), false);
});

test("…but can never grant above the ceiling", () => {
  const all = Object.fromEntries(KEYS.map((k) => [k, true]));
  const rolePermissions = { manager: { inspectionReports: all }, technician: { inspectionReports: all }, cashier: { inspectionReports: all } };
  assert.equal(perm(pro({ role: "Manager", rolePermissions }), "delete"), false);
  for (const k of ["create", "finalize", "send", "delete", "manageTemplate"]) assert.equal(perm(pro({ role: "Technician", rolePermissions }), k), false, k);
  for (const k of KEYS.slice(1)) assert.equal(perm(pro({ role: "Cashier", rolePermissions }), k), false, k);
});

test("a custom role's own grid replaces the base role's entry", () => {
  const rolePermissions = { manager: { inspectionReports: { send: false } } };
  const customRole = { permissions: { inspectionReports: { send: true, finalize: false } } };
  assert.equal(perm(pro({ role: "Manager", rolePermissions, customRole }), "send"), true);
  assert.equal(perm(pro({ role: "Manager", rolePermissions, customRole }), "finalize"), false);
  assert.equal(perm(pro({ role: "Manager", rolePermissions, customRole }), "create"), true);
});

test("Basic ignores any stored grid (none is loaded for Basic centres)", () => {
  assert.equal(perm({ role: "Manager", isPro: false, rolePermissions: { manager: { inspectionReports: { finalize: false } } } }, "finalize"), true);
});
