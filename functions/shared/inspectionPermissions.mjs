// ── Inspection Reports permissions, server side ──────────────────────────────
// The same decision firestore.rules and the app (src/lib/defaultPermissions.ts +
// PermissionsContext) make, for the callables. Kept as a pure function so it is
// unit-tested, and checked against the app's own defaults by
// src/lib/inspectionReports/permissionsParity.test.ts so the copies can't drift.
//
// How a permission resolves (identical in all three places):
//  1. Owner: always true.
//  2. A role's CEILING is what its rules-level access allows at most: Manager
//     everything but delete; Technician view + edit; Cashier / Receptionist view.
//     The Owner can switch a permission off below the ceiling, never above it.
//  3. On a Pro centre the Owner's choices apply — the custom role's grid when the
//     staff member has one, else the base role's entry in settings/rolePermissions.
//     A key the stored grid doesn't mention keeps the role default (= the ceiling).
//     On Basic there is no grid: the defaults apply.

export const INSPECTION_PERMISSION_KEYS = ["view", "create", "edit", "finalize", "send", "delete", "manageTemplate"];

/** Mirrors DEFAULT_PERMISSIONS[role].inspectionReports in src/lib/defaultPermissions.ts. */
export const INSPECTION_DEFAULTS = {
  manager: { view: true, create: true, edit: true, finalize: true, send: true, delete: false, manageTemplate: true },
  technician: { view: true, create: false, edit: true, finalize: false, send: false, delete: false, manageTemplate: false },
  cashier: { view: true, create: false, edit: false, finalize: false, send: false, delete: false, manageTemplate: false },
  receptionist: { view: true, create: false, edit: false, finalize: false, send: false, delete: false, manageTemplate: false },
};

/**
 * @param {object} ctx
 * @param {string} ctx.role                  staff.role ("Owner", "Manager", …)
 * @param {boolean} ctx.isPro                centre plan is Pro
 * @param {object|null} [ctx.customRole]     the staff member's customRoles doc data, if any
 * @param {object|null} [ctx.rolePermissions] settings/rolePermissions doc data, if any
 * @param {string} key                       one of INSPECTION_PERMISSION_KEYS
 */
export function inspectionPermission({ role, isPro, customRole = null, rolePermissions = null }, key) {
  if (role === "Owner") return true;
  const roleKey = String(role || "").toLowerCase();
  const ceiling = INSPECTION_DEFAULTS[roleKey];
  if (!ceiling || ceiling[key] !== true) return false;
  if (!isPro) return true;
  const grid = customRole ? customRole.permissions : rolePermissions ? rolePermissions[roleKey] : null;
  const stored = grid && grid.inspectionReports ? grid.inspectionReports[key] : undefined;
  return typeof stored === "boolean" ? stored : true;
}
