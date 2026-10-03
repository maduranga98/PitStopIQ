// Run with: npm test   (node --test, TypeScript stripped natively by Node)
// Every query the module runs needs its index, and the emulator doesn't enforce
// indexes — so a missing one only shows up on staging, as a failed query. This
// lists each query's shape and checks firestore.indexes.json declares it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const cfg = JSON.parse(readFileSync(new URL("../../../firestore.indexes.json", import.meta.url), "utf8"));
type Field = { fieldPath: string; order: string };
const composites: { collectionGroup: string; queryScope: string; fields: Field[] }[] = cfg.indexes;

const hasComposite = (collectionGroup: string, fields: Array<[string, string]>) =>
  composites.some((i) =>
    i.collectionGroup === collectionGroup && i.queryScope === "COLLECTION" &&
    JSON.stringify(i.fields.map((f) => [f.fieldPath, f.order])) === JSON.stringify(fields));

const hasOverride = (collectionGroup: string, fieldPath: string, scope: string) =>
  cfg.fieldOverrides.some((o: { collectionGroup: string; fieldPath: string; indexes: { queryScope: string }[] }) =>
    o.collectionGroup === collectionGroup && o.fieldPath === fieldPath && o.indexes.some((x) => x.queryScope === scope));

const A = "ASCENDING", D = "DESCENDING";

test("composite indexes for every list query", () => {
  // reports.ts fetchReportsPage: drafts / finalized / technician
  assert.ok(hasComposite("inspectionReports", [["status", A], ["updatedAt", D]]), "staff list: drafts");
  assert.ok(hasComposite("inspectionReports", [["status", A], ["finalizedAt", D]]), "staff list: finalized");
  assert.ok(hasComposite("inspectionReports", [["assignedToUid", A], ["updatedAt", D]]), "technician list");
  // reports.ts fetchVehicleReportsPage
  assert.ok(hasComposite("inspectionReports", [["vehicleId", A], ["createdAt", D]]), "vehicle history");
  // functions getPortalInspectionReports
  assert.ok(hasComposite("inspectionReports", [["customerId", A], ["status", A], ["visibleToCustomer", A], ["finalizedAt", D]]), "customer portal");
});

test("collection-group lookups: share token and the retention scan", () => {
  assert.ok(hasOverride("inspectionReports", "shareToken", "COLLECTION_GROUP"), "getPublicInspectionReport / trackInspectionReportView");
  assert.ok(hasOverride("inspectionReports", "nextMediaDeleteAt", "COLLECTION_GROUP"), "dailyStandaloneInspectionCleanup");
});

