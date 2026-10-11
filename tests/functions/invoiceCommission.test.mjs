// Repair Catalog lines are never commissionable. Pure: no emulator, no
// firebase-admin. It loads the REAL invoiceCommissionLines / invoiceCommissionHash
// source out of functions/index.js (so it tests what is deployed, and needs no
// change to the functions), runs in `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../../functions/index.js", import.meta.url), "utf8");

/** The text of a top-level `function name(...) { ... }`, up to its closing brace at column 0. */
function fn(name) {
  const start = SRC.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `function ${name} not found in functions/index.js`);
  const end = SRC.indexOf("\n}\n", start);
  return SRC.slice(start + 1, end + 3);
}

const { invoiceCommissionLines, invoiceCommissionHash } = new Function(
  [fn("round2"), fn("invoiceLineBase"), fn("invoiceCommissionLines"), fn("invoiceCommissionHash"),
   "return { invoiceCommissionLines, invoiceCommissionHash };"].join("\n"),
)();

const repairLine = { description: "Brake job", qty: 1, unitPrice: 3500, lineTotal: 3500, type: "repair", repairItemId: "r1" };
const serviceLine = { description: "Oil change", qty: 1, unitPrice: 2500, lineTotal: 2500, type: "service", technicianId: "t1" };

test("a type \"repair\" line pays no commission, even with a technicianId on it", () => {
  const invoice = { lineItems: [{ ...repairLine, technicianId: "t1" }, { ...repairLine, description: "Other", technicianId: "t2" }] };
  assert.deepEqual(invoiceCommissionLines(invoice), []);
  assert.equal(invoiceCommissionHash(invoice), "");
});

test("a bill mixing repair and service lines pays only the service line (control)", () => {
  const invoice = { lineItems: [repairLine, serviceLine, { ...repairLine, technicianId: "t9" }] };
  const lines = invoiceCommissionLines(invoice);
  assert.deepEqual(lines.map((l) => [l.index, l.line.description]), [[1, "Oil change"]]);
  assert.equal(invoiceCommissionHash(invoice), "1|Oil change|t1|2500");
});

test("a job's own bill is still left to onJobCompleted, and repairs never enter serviceLines", () => {
  // The invoice trigger bails on any bill that belongs to a job card...
  assert.match(SRC, /if \(invoice\.serviceId\) return;/);
  // ...and the job-side settlement reads only job.serviceLines, never repairsPerformed.
  assert.ok(!/repairsPerformed/.test(SRC), "functions/index.js must not read repairsPerformed");
});
