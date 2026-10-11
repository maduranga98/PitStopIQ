// Audit tests for the Phase 6 job screens: edge cases around frozen repairs,
// the hourly-line carryover, and tripwires that keep the Repair Catalog
// switched OFF meaning "nothing changes" in the job and invoice code.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { addRepair, customRepair, overrideRepairPrice, pickRepair, removeRepair, attachPartIds } from "./jobRepairs.ts";
import { addPartSnapshot } from "./jobParts.ts";
import { repairLineItems } from "./invoiceLines.ts";
import { invoiceTotals } from "../invoiceTotals.ts";
import type { InventoryItem, InvoiceLineItem, ServiceJob } from "../../types/auth.ts";
import type { RepairItem, RepairPerformed } from "../../types/repairCatalog.ts";

let carryHourlyLine: typeof import("../workingHours.ts").carryHourlyLine;
before(async () => {
  register("data:text/javascript," + encodeURIComponent(`
    export async function resolve(spec, ctx, next) {
      try { return await next(spec, ctx); }
      catch (e) { if (spec.startsWith(".") && !/\\.\\w+$/.test(spec)) return next(spec + ".ts", ctx); throw e; }
    }`));
  ({ carryHourlyLine } = await import("../workingHours.ts"));
});

const cat = (id: string, over: Partial<RepairItem> = {}): RepairItem => ({
  id, name: id, category: "Service", defaultPrice: 1000, priceOverrides: [], suggestedParts: [], isActive: true,
  appliesTo: { all: true, types: [], groupIds: [], modelIds: [] }, ...over,
} as RepairItem);
const job = (r: RepairPerformed[]) => ({ repairsPerformed: r }) as Pick<ServiceJob, "repairsPerformed">;
const car = { vehicleType: "Car" };
const part = (id: string) => ({ id, name: `Part ${id}`, currentQty: 10, unit: "pcs", serviceCenterPrice: 500, purchasePrice: 300 }) as unknown as InventoryItem;

test("a job with only repairs bills only the repairs; a price of 0 bills as 0", () => {
  const free = pickRepair(cat("free", { defaultPrice: 0 }), car, [], []).entry;
  const paid = pickRepair(cat("paid", { defaultPrice: 3500 }), car, [], []).entry;
  const lines = repairLineItems(job([free, paid]));
  assert.deepEqual(lines.map((l) => l.lineTotal), [0, 3500]);
  const t = invoiceTotals(lines, 0, "amount", 0);
  assert.deepEqual([t.subtotal, t.grandTotal], [3500, 3500]);
});

test("an override to a LOWER price bills the lower price and keeps the picked source", () => {
  const e = pickRepair(cat("r", { defaultPrice: 3000, priceOverrides: [{ scope: "type", scopeId: "car", price: 2800 }] }), car, [], []).entry;
  const lowered = overrideRepairPrice([e], "r", 1500);
  assert.deepEqual([lowered[0].price, lowered[0].resolvedFrom, lowered[0].priceOverridden], [1500, "type", true]);
  assert.equal(repairLineItems(job(lowered))[0].unitPrice, 1500);
});

test("removing the last repair leaves an empty list that adds no invoice line", () => {
  const e = pickRepair(cat("r"), car, [], []).entry;
  const none = removeRepair([e], "r");
  assert.deepEqual(none, []);
  assert.deepEqual(repairLineItems(job(none)), []);
});

test("two repairs sharing a part: one partsUsed entry with the summed quantity, deducted once; partItemIds is display only", () => {
  const filter = part("f1");
  let parts = addPartSnapshot([], filter, 1);   // repair A suggests 1
  parts = addPartSnapshot(parts, filter, 2);    // repair B suggests 2
  assert.equal(parts.length, 1);
  assert.equal(parts[0].quantity, 3);
  const a = pickRepair(cat("a"), car, [], []).entry;
  const b = pickRepair(cat("b"), car, [], []).entry;
  let list = attachPartIds(addRepair([], a), "a", ["f1"]);
  list = attachPartIds(addRepair(list, b), "b", ["f1"]);
  assert.deepEqual(list.map((r) => r.partItemIds), [["f1"], ["f1"]]);
  // Deduction walks partsUsed; the part rows carry no repair link at all.
  assert.ok(!("partItemIds" in parts[0]));
  // Removing a repair leaves the part where it is.
  const after = removeRepair(list, "a");
  assert.equal(parts.length, 1);
  assert.deepEqual(after.map((r) => r.repairItemId), ["b"]);
});

test("a repair whose catalog item is later deactivated or deleted still shows and bills from the job's snapshot", () => {
  const entry = pickRepair(cat("gone", { defaultPrice: 4200 }), car, [], []).entry;
  // The catalog is not consulted at all: the invoice lines come from the job alone.
  const lines = repairLineItems(job([entry]));
  assert.deepEqual(lines, [{ description: "gone", qty: 1, unitPrice: 4200, lineTotal: 4200, type: "repair", repairItemId: "gone" }]);
});

test("a custom repair bills with no repairItemId and a stored local id", () => {
  const c = customRepair("Weld", 900);
  assert.equal(c.custom, true);
  const [l] = repairLineItems(job([c]));
  assert.deepEqual([l.type, l.lineTotal, "repairItemId" in l], ["repair", 900, false]);
});

test("carryHourlyLine never turns a repair into the hourly line, even if it shares the hourly line's name", () => {
  const previous: InvoiceLineItem[] = [
    { description: "Wash", qty: 1, unitPrice: 750, lineTotal: 750, type: "service", billingType: "hourly", hourlyRate: 1500, workingHours: 0.5 },
  ];
  // The service is gone from the rebuilt bill; a repair with the same name is not it.
  const fresh: InvoiceLineItem[] = [{ description: "Wash", qty: 1, unitPrice: 300, lineTotal: 300, type: "repair" }];
  const synced = carryHourlyLine(fresh, previous, { workingHoursEnabled: true, totalWorkingMinutes: 60, hourlyRate: 1500 });
  assert.deepEqual(synced, fresh);
});

// ── Flag-off tripwires ───────────────────────────────────────────────────────
// The two pages and createServiceJob are not importable under node (Firestore),
// so these pin the lines that keep the module off = no change.
const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const newJob = src("../../pages/services/NewServicePage.tsx");
const detail = src("../../pages/services/ServiceDetailPage.tsx");
const creation = src("../jobCreation.ts");

test("flag off: the picker is rendered only behind repairCatalogEnabled, and only those two pages mount it", () => {
  assert.match(newJob, /\{repairCatalogEnabled && canViewRepairs && currentUser\?\.role !== "Cashier" && currentUser\?\.centerId && \(\s*<RepairPicker/);
  assert.match(detail, /\{repairCatalogEnabled && canEditServices && canViewRepairs && currentUser\?\.role !== "Cashier" && \(\s*<RepairPicker/);
  assert.match(detail, /\{repairCatalogEnabled && !\(canEditServices[^)]*\) && \(\s*<JobRepairsList/);
  assert.equal((newJob.match(/<RepairPicker/g) ?? []).length, 1);
  assert.equal((detail.match(/<RepairPicker/g) ?? []).length, 1);
});

test("flag off: nothing new is written at creation or on the card", () => {
  // The job card's only write is inside applyRepairChange, reachable only from the picker.
  assert.match(newJob, /\.\.\.\(repairCatalogEnabled && repairsPerformed\.length > 0 \? \{ repairsPerformed \} : \{\}\)/);
  assert.match(creation, /\.\.\.\(repairsPerformed && repairsPerformed\.length > 0 \? \{ repairsPerformed \} : \{\}\)/);
  assert.match(creation, /\.\.\.\(vehicle\.modelId \? \{ modelId: vehicle\.modelId \} : \{\}\)/);
  assert.equal((detail.match(/applyRepairChange/g) ?? []).length, 2); // definition + the picker's onChange
});

test("both invoice paths compose repairs between services and parts, and the Labour fallback ignores them only when there are none", () => {
  assert.match(creation, /customServices\.map[^\n]*\n[^\n]*\n\s*\.\.\.repairLineItems\(\{ repairsPerformed \}\),\n[\s\S]*?\.\.\.\(partsUsed \?\? \[\]\)/);
  assert.match(detail, /\.\.\.serviceLineItems,\n\s*\.\.\.repairLines,\n\s*\.\.\.partLineItems,/);
  assert.match(detail, /serviceLineItems\.length === 0 && partLineItems\.length === 0 && repairLines\.length === 0/);
});

test("the stock, completion and commission code does not read repairs", () => {
  const body = (name: string) => {
    const start = detail.indexOf(`const ${name} = async`);
    assert.ok(start >= 0, name);
    return detail.slice(start, detail.indexOf("\n  };\n", start));
  };
  assert.ok(!/repairsPerformed|partItemIds/.test(body("deductParts")));
  assert.ok(!/repairsPerformed|partItemIds/.test(body("handleMarkDone")));
});
