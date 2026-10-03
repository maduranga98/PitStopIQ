// Run with: npm test   (node --test, TypeScript stripped natively by Node)
// The server (functions/shared/inspectionPermissions.mjs) and firestore.rules keep
// their own copy of the Inspection Reports defaults/ceilings. This fails if the
// app's defaults and the server's copy ever differ.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_PERMISSIONS, LOCKED_OFF } from "../defaultPermissions.ts";
import { INSPECTION_DEFAULTS, INSPECTION_PERMISSION_KEYS } from "../../../functions/shared/inspectionPermissions.mjs";

const ROLES = ["manager", "technician", "cashier", "receptionist"] as const;

test("server defaults equal the app's defaults", () => {
  for (const r of ROLES) assert.deepEqual(INSPECTION_DEFAULTS[r], DEFAULT_PERMISSIONS[r].inspectionReports, r);
});

test("every key the app can grant above a role's ceiling is locked off", () => {
  // ceiling == default (see the shared file), so a key that is false by default is locked off.
  for (const r of ROLES) {
    for (const k of INSPECTION_PERMISSION_KEYS) {
      const allowed = INSPECTION_DEFAULTS[r][k];
      assert.equal(LOCKED_OFF[r].has(`inspectionReports.${k}`), !allowed, `${r}.${k}`);
    }
  }
});

test("firestore.rules uses the same ceilings", () => {
  const rules = readFileSync(new URL("../../../firestore.rules", import.meta.url), "utf8");
  const fn = rules.slice(rules.indexOf("function inspCeiling("), rules.indexOf("function inspPermGranted("));
  assert.ok(fn.includes("role == 'Manager' && key != 'delete'"));
  assert.ok(fn.includes("role == 'Technician' && key in ['view', 'edit']"));
  assert.ok(fn.includes("(role == 'Cashier' || role == 'Receptionist') && key == 'view'"));
});
