// Inventory-item commission: the calculation, the job fingerprint and the log
// shape. Pure: loads the REAL function source out of functions/index.js (so it
// tests what is deployed) — no emulator, no firebase-admin. Runs in `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../../functions/index.js", import.meta.url), "utf8");

function fn(name) {
  const start = SRC.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `function ${name} not found in functions/index.js`);
  const end = SRC.indexOf("\n}\n", start);
  return SRC.slice(start + 1, end + 3);
}

const stamp = Symbol("serverTimestamp");
const { computeItemCommission, partUnitPrice, partsCommissionHash, buildItemLogEntry, commissionInputHash } = new Function(
  "admin",
  [fn("round2"), fn("computeItemCommission"), fn("partUnitPrice"), fn("partsCommissionHash"),
   fn("buildItemLogEntry"), fn("commissionInputHash"),
   "return { computeItemCommission, partUnitPrice, partsCommissionHash, buildItemLogEntry, commissionInputHash };"].join("\n"),
)({ firestore: { FieldValue: { serverTimestamp: () => stamp } } });

const pct = (v) => ({ commissionEnabled: true, commissionType: "percentage", commissionValue: v });
const flat = (v) => ({ commissionEnabled: true, commissionType: "flat", commissionValue: v });

test("percentage is a share of the billed price x quantity, rounded to cents", () => {
  assert.deepEqual(computeItemCommission(pct(5), 3, 1250), { type: "percentage", rate: 5, base: 3750, amount: 187.5 });
  assert.equal(computeItemCommission(pct(7.5), 1, 333.33).amount, 25); // 24.99975 -> 25
});

test("flat is the value per unit used, mapped to the ledger's \"fixed\"", () => {
  assert.deepEqual(computeItemCommission(flat(150), 4, 900), { type: "fixed", rate: 150, base: 3600, amount: 600 });
  assert.equal(computeItemCommission(flat(12.5), 3, 0).amount, 37.5); // no billed price needed for flat
});

test("disabled, missing or malformed config earns nothing — no error", () => {
  assert.equal(computeItemCommission(undefined, 1, 100), null);
  assert.equal(computeItemCommission({}, 1, 100), null);
  assert.equal(computeItemCommission({ ...pct(5), commissionEnabled: false }, 1, 100), null);
  assert.equal(computeItemCommission({ commissionEnabled: true, commissionType: null, commissionValue: null }, 1, 100), null);
  assert.equal(computeItemCommission(pct(0), 1, 100), null);
  assert.equal(computeItemCommission(pct(101), 1, 100), null);
  assert.equal(computeItemCommission({ ...flat(10), commissionType: "other" }, 1, 100), null);
  assert.equal(computeItemCommission(flat(10), 0, 100), null);
});

test("a percentage on an unpriced part is 0, which the trigger skips", () => {
  assert.equal(computeItemCommission(pct(10), 2, 0).amount, 0);
});

test("the billed price is the part's unitPrice, falling back to the legacy unitCost", () => {
  assert.equal(partUnitPrice({ unitPrice: 200, unitCost: 50 }), 200);
  assert.equal(partUnitPrice({ unitPrice: 0, unitCost: 50 }), 0);
  assert.equal(partUnitPrice({ unitCost: 50 }), 50);
  assert.equal(partUnitPrice({}), 0);
});

test("a job without parts keeps exactly its pre-existing fingerprint", () => {
  const lines = [{ libraryItemId: "Oil change", technicianId: "t1", price: 2500 }];
  assert.equal(partsCommissionHash({ partsUsed: [] }), "");
  assert.equal(partsCommissionHash({}), "");
  assert.equal(commissionInputHash(lines) + partsCommissionHash({ technicianId: "t1" }), "Oil change|t1|2500");
});

test("the fingerprint moves with the parts, their price and the technician", () => {
  const base = { technicianId: "t1", partsUsed: [{ itemId: "i1", quantity: 2, unitPrice: 100 }] };
  const h = partsCommissionHash(base);
  assert.notEqual(h, "");
  assert.notEqual(h, partsCommissionHash({ ...base, technicianId: "t2" }));
  assert.notEqual(h, partsCommissionHash({ ...base, partsUsed: [{ itemId: "i1", quantity: 3, unitPrice: 100 }] }));
  assert.notEqual(h, partsCommissionHash({ ...base, partsUsed: [{ itemId: "i1", quantity: 2, unitPrice: 120 }] }));
  assert.equal(h, partsCommissionHash({ ...base }));
});

test("the log entry is tagged inventory_item and carries the part, not a service", () => {
  const calc = computeItemCommission(pct(5), 3, 1250);
  const entry = buildItemLogEntry({
    job: { jobNumber: "J-1", vehicleId: "v1" }, jobId: "j1", centerId: "c1", invoiceId: "inv1", vehicleType: "car",
    part: { itemId: "i1", itemName: "Oil filter", quantity: 3 }, staffId: "t1",
    staff: { fullName: "Tech", commission: { role: "technician" } }, calc,
  });
  assert.equal(entry.source, "inventory_item");
  assert.equal(entry.serviceId, "j1");
  assert.equal(entry.libraryItemId, "i1");
  assert.equal(entry.serviceName, "Oil filter");
  assert.equal(entry.quantity, 3);
  assert.equal(entry.baseAmount, 3750);
  assert.equal(entry.commissionType, "percentage");
  assert.equal(entry.commissionRate, 5);
  assert.equal(entry.commissionAmount, 187.5);
  assert.equal(entry.isOverride, false);
  assert.equal(entry.reversed, false);
  assert.equal(entry.staffId, "t1");
  assert.equal(entry.createdAt, stamp);
});
