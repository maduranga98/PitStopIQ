import { test } from "node:test";
import assert from "node:assert/strict";
import * as P from "./portalProjections.mjs";

const ts = (ms) => ({ toMillis: () => ms });

// Every internal field the app writes onto these documents, each carrying a
// recognisable value. Anything that survives a projection is a leak.
const SECRET = "SECRET-VALUE";
const secrets = {
  costPrice: 111, unitCost: 222, purchasePrice: 333, laborCost: 444, commissionTotal: 555,
  commissionRunHash: SECRET, internalNotes: SECRET, serviceLines: [{ technicianName: SECRET }],
  technicianId: SECRET, technicianName: SECRET, technicianIds: [SECRET], technicianNames: [SECRET],
  inspectorName: SECRET, commissionSnapshot: { rate: 9, amount: 999 }, partsUsed: [{ costPrice: 777 }],
  numberConflict: true, numberConflictWith: [SECRET], pdfUrl: SECRET, smsSent: true, ownerUid: SECRET,
  ownerPhone: SECRET, billingStatus: SECRET, paymentCode: SECRET, smsQuota: 1234, repairsPerformed: [SECRET],
  serviceDiscounts: { x: 1 }, departmentName: SECRET, qrCodeUrl: SECRET, photoUrls: [SECRET], reminderSent: true,
  nic: SECRET, shortCode: SECRET, createdByName: SECRET, authorName: SECRET, authorRole: SECRET,
  recordedByName: SECRET, clearedByName: SECRET, returnedByName: SECRET, returnReason: SECRET, note: SECRET,
  reviewedByName: SECRET, assignedTechnicianName: SECRET, customerPhoneSecret: SECRET,
};

const FORBIDDEN_KEYS = Object.keys(secrets);

function keysDeep(v, out = new Set()) {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.add(k); keysDeep(x, out); }
  return out;
}
function assertClean(name, payload) {
  const json = JSON.stringify(payload);
  assert.ok(!json.includes(SECRET), `${name}: leaked a secret string`);
  for (const n of ["111", "222", "333", "444", "555", "777", "999", "1234"]) {
    assert.ok(!new RegExp(`:${n}[,}\\]]`).test(json), `${name}: leaked the secret number ${n}`);
  }
  const keys = keysDeep(payload);
  for (const k of FORBIDDEN_KEYS) assert.ok(!keys.has(k), `${name}: payload has forbidden key "${k}"`);
}

const line = { description: "Oil filter", qty: 1, unitPrice: 2500, lineTotal: 2500, type: "part", brand: "Bosch", partNumber: "OF-1",
  warranty: { value: 6, unit: "months", notes: "defects", internal: SECRET }, ...secrets };
const payment = { id: "p1", method: "cheque", amount: 5000, date: ts(1), chequeNumber: "00123", bank: "BOC", branch: "Galle",
  chequeDate: ts(2), clearance: "pending", ...secrets };
const invoice = { invoiceNumber: "INV-1", serviceDate: ts(10), createdAt: ts(11), customerName: "A", customerPhone: "0771234567",
  plateNumber: "CAB-1", mileageIn: 100, nextServiceMileageKm: 5100, lineItems: [line], discount: 0, discountType: "amount", tax: 0,
  grandTotal: 2500, status: "partial", paidAmount: 1000, balanceDue: 1500,
  payments: [payment, { id: "p2", method: "cash", amount: 1000, ...secrets }], finalized: true, ...secrets };

test("no projector lets an internal field through", () => {
  assertClean("center", P.projectPortalCenter({ name: "C", phone: "0112", logoUrl: "u", weeklyHours: { mon: { open: true } }, slotDurationMinutes: 30, ...secrets }));
  assertClean("invoiceCenter", P.projectInvoiceCenter({ name: "C", address: "a", phone: "1", phone2: "2", email: "e", logoUrl: "u", invoicePaper: { size: "A4", ...secrets }, ...secrets }));
  assertClean("customer", P.projectPortalCustomer("c1", { name: "N", phone: "077", createdAt: ts(1), ...secrets }));
  assertClean("vehicle", P.projectPortalVehicle("v1", { plateNumber: "CAB-1", make: "T", model: "A", vehicleType: "Car", currentMileageKm: 1, ...secrets }));
  assertClean("job", P.projectPortalJob("j1", { plateNumber: "CAB-1", createdAt: ts(1), services: ["Oil change"], customServices: ["x"], mileageOut: 5, ...secrets }));
  assertClean("note", P.projectSharedNote("n1", { message: "m", needsFollowUp: true, createdAt: ts(1), ...secrets }, "CAB-1"));
  assertClean("line", P.projectInvoiceLine(line));
  assertClean("payment", P.projectPayment(payment));
  assertClean("invoiceSummary", P.projectInvoiceSummary("i1", invoice));
  assertClean("publicInvoice", P.projectPublicInvoice("i1", invoice));
  assertClean("booking", P.projectPortalBooking("b1", { plateNumber: "CAB-1", requestedDate: "2027-01-01", requestedSlot: "09:00", status: "rejected", rejectionReason: "full", ...secrets }));
  assertClean("feedback", P.projectPortalFeedback("f1", { type: "complaint", message: "m", status: "new", createdAt: ts(1), ...secrets }));
});

test("customer-record fields that are staff-only stay out (nic, notes, shortCode)", () => {
  // `notes` is legitimately a field of warranty, so it is not in the shared secrets list.
  const out = P.projectPortalCustomer("c1", { name: "N", phone: "077", nic: SECRET, notes: SECRET, shortCode: SECRET, smsLanguage: "sinhala" });
  assert.deepEqual(Object.keys(out).sort(), ["createdAtMillis", "id", "name", "phone"]);
  assert.ok(!JSON.stringify(out).includes(SECRET));
});

test("the whitelist is exact: each projector returns only its named keys", () => {
  const keys = (o) => Object.keys(o).sort();
  assert.deepEqual(keys(P.projectPortalJob("j", {})), ["createdAtMillis", "customServices", "id", "mileageOut", "plateNumber", "services"]);
  assert.deepEqual(keys(P.projectInvoiceSummary("i", {})), ["createdAtMillis", "grandTotal", "id", "invoiceNumber", "payments", "plateNumber", "status"]);
  assert.deepEqual(keys(P.projectPortalVehicle("v", {})), ["currentMileageKm", "id", "make", "model", "nextServiceMileageKm", "oilBrand", "oilGrade", "plateNumber", "vehicleType"]);
  assert.deepEqual(keys(P.projectSharedNote("n", {})), ["createdAtMillis", "id", "message", "needsFollowUp", "plateNumber"]);
  assert.deepEqual(keys(P.projectPortalCustomer("c", {})), ["createdAtMillis", "id", "name", "phone"]);
  assert.deepEqual(keys(P.projectInvoiceLine({})), ["billingType", "brand", "description", "discount", "hourlyRate", "lineTotal", "partNumber", "qty", "type", "unitPrice", "warranty", "workingHours"]);
  assert.deepEqual(keys(P.projectPayment({})), ["amount", "bank", "branch", "chequeDateMillis", "chequeNumber", "clearance", "dateMillis", "id", "method"]);
});

test("payments: only cheque and credit are shown, and never who recorded them", () => {
  const out = P.projectPayments([payment, { method: "cash", amount: 1 }, { method: "card", amount: 2 }, { method: "credit", amount: 3, id: "c" }, null]);
  assert.deepEqual(out.map((p) => p.method), ["cheque", "credit"]);
});

test("invoice lines keep the customer-facing price and drop the shop's cost", () => {
  const out = P.projectInvoiceLine(line);
  assert.equal(out.unitPrice, 2500);
  assert.equal(out.brand, "Bosch");
  assert.deepEqual(out.warranty, { value: 6, unit: "months", notes: "defects" });
  assert.ok(!("costPrice" in out) && !("unitCost" in out));
});

test("timestamps leave as millis", () => {
  assert.equal(P.millis(ts(42)), 42);
  assert.equal(P.millis(new Date(7)), 7);
  assert.equal(P.millis(null), null);
  assert.equal(P.projectPublicInvoice("i", invoice).serviceDateMillis, 10);
});

test("garbage types are neutralised, not passed through", () => {
  const j = P.projectPortalJob("j", { services: ["ok", 5, { a: 1 }], customServices: "nope", mileageOut: "12", plateNumber: 9 });
  assert.deepEqual(j.services, ["ok"]);
  assert.deepEqual(j.customServices, []);
  assert.equal(j.mileageOut, null);
  assert.equal(j.plateNumber, "");
});

test("a rejection reason is shown only on a rejected booking", () => {
  assert.equal(P.projectPortalBooking("b", { status: "rejected", rejectionReason: "full" }).rejectionReason, "full");
  assert.equal(P.projectPortalBooking("b", { status: "confirmed", rejectionReason: "stale" }).rejectionReason, null);
});

test("release rule matches the invoice page: unfinalized, unsent, pending drafts are hidden; deleted never shown", () => {
  assert.equal(P.isInvoiceReleased({ status: "pending" }), false);
  assert.equal(P.isInvoiceReleased({ status: "pending", finalized: true }), true);
  assert.equal(P.isInvoiceReleased({ status: "pending", smsSent: true }), true);
  assert.equal(P.isInvoiceReleased({ status: "paid" }), true);
  assert.equal(P.isInvoiceReleased({ status: "paid", isDeleted: true }), false);
});
