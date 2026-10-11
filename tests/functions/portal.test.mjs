// Customer-portal callables (functions/portalCore.js) against the Firestore
// emulator. Not part of `npm test` (needs the emulator + Java):
//
//   npm run test:portal
//
// Drives the handlers directly with an injected clock and a spy logger, so the
// throttle windows and the "nothing sensitive is logged" rule are testable.
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8085";
const FN = process.env.FUNCTIONS_DIR ?? new URL("../../functions/", import.meta.url).pathname;
const require = createRequire(`${FN}index.js`);
const admin = require("firebase-admin");
const { Timestamp } = require("firebase-admin/firestore");
admin.initializeApp({ projectId: "demo-test" });
const { createPortal, PAGE_SIZE } = require(`${FN}portalCore.js`);
const { LIMITS, WINDOW_MS } = await import(`${FN}shared/portalThrottle.mjs`);

const db = admin.firestore();
const T0 = 50 * WINDOW_MS + 1000;
let clock = T0;
let logs = [];
const spy = { warn: (...a) => logs.push(a), error: (...a) => logs.push(a), info: (...a) => logs.push(a) };
const portal = createPortal({ db, now: () => clock, logger: spy, toTimestamp: (ms) => Timestamp.fromMillis(ms) });

const PHONE = "0771234567";
const NAME = "Nimal Perera";
const SECRET = "SECRET-VALUE";
const at = (ms) => Timestamp.fromMillis(ms);
const req = (data, ip = "203.0.113.7") => ({ data, rawRequest: { ip } });
const code = async (p) => { try { await p; return null; } catch (e) { return e.code; } };

const internalJob = { laborCost: 4444, commissionTotal: 5555, internalNotes: SECRET, technicianName: SECRET,
  technicianNames: [SECRET], serviceLines: [{ technicianName: SECRET }], partsUsed: [{ itemName: "Filter", costPrice: 7777, unitPrice: 9999, unitCost: 6666 }] };

async function wipe() {
  const cols = ["servicecenters", "portalThrottle"];
  for (const c of cols) await db.recursiveDelete(db.collection(c));
}

async function seed() {
  const c = db.doc("servicecenters/c1");
  await c.set({ name: "Auto One", phone: "0112223334", logoUrl: "https://x/logo", ownerUid: SECRET, ownerPhone: SECRET,
    paymentCode: SECRET, smsQuota: 98765, weeklyHours: { mon: { open: true, start: "08:00", end: "17:00" } }, slotDurationMinutes: 30,
    standaloneInspectionEnabled: true, address: "1 Main St", phone2: "0114445556", email: "a@b.c", invoicePaper: { size: "A4" } });
  await db.doc("servicecenters/c2").set({ name: "Other" });
  await c.collection("customers").doc("cu1").set({ name: NAME, phone: PHONE, nic: SECRET, notes: SECRET, createdAt: at(1000), isDeleted: false });
  await c.collection("customers").doc("cu2").set({ name: "Someone Else", phone: "0779999999", isDeleted: false });
  await c.collection("customers").doc("cuDel").set({ name: "Gone", isDeleted: true });
  await db.doc("servicecenters/c2/customers/cuX").set({ name: "Other center", isDeleted: false });
  await c.collection("vehicles").doc("v1").set({ customerId: "cu1", plateNumber: "CAB-1", make: "Toyota", model: "Aqua", vehicleType: "Car",
    currentMileageKm: 50000, nextServiceMileageKm: 55000, oilBrand: "Castrol", oilGrade: "5W-30", qrCodeUrl: SECRET, photoUrls: [SECRET], isDeleted: false });
  await c.collection("vehicles").doc("v2").set({ customerId: "cu1", plateNumber: "OLD-9", isDeleted: true });
  await c.collection("vehicles").doc("v3").set({ customerId: "cu2", plateNumber: "NOT-MINE", isDeleted: false });
  const logs_ = c.collection("vehicles").doc("v1").collection("logs");
  await logs_.doc("n1").set({ type: "note", message: "Brake pads due", needsFollowUp: true, customerVisible: true, authorName: SECRET, authorRole: "Owner", createdAt: at(5000) });
  await logs_.doc("n2").set({ type: "note", message: "internal chatter", customerVisible: false, createdAt: at(6000) });
  await logs_.doc("n3").set({ type: "system", message: "system event", createdAt: at(7000) });
  await c.collection("jobs").doc("j1").set({ customerId: "cu1", plateNumber: "CAB-1", createdAt: at(2000), services: ["Oil change"], customServices: ["Polish"], mileageOut: 50100, status: "done", ...internalJob });
  await c.collection("jobs").doc("jDel").set({ customerId: "cu1", plateNumber: "CAB-1", createdAt: at(3000), services: ["Deleted"], isDeleted: true });
  await c.collection("jobs").doc("jOther").set({ customerId: "cu2", plateNumber: "NOT-MINE", createdAt: at(3000), services: ["Other"] });
  const line = { description: "Oil filter", qty: 1, unitPrice: 2500, lineTotal: 2500, type: "part", brand: "Bosch", partNumber: "OF-1",
    costPrice: 1111, technicianName: SECRET, commissionSnapshot: { rate: 5, amount: 86421 }, warranty: { value: 6, unit: "months" } };
  const inv = { customerId: "cu1", customerName: NAME, customerPhone: PHONE, plateNumber: "CAB-1", invoiceNumber: "INV-1", createdAt: at(4000),
    serviceDate: at(4000), lineItems: [line], discount: 0, discountType: "amount", tax: 0, grandTotal: 2500, paidAmount: 0, balanceDue: 2500,
    status: "pending", finalized: true, commissionTotal: 5555, commissionRunHash: SECRET, pdfUrl: SECRET,
    payments: [{ id: "p1", method: "cheque", amount: 2500, date: at(4100), chequeNumber: "00123", bank: "BOC", branch: "Galle", clearance: "pending",
      recordedByName: SECRET, note: SECRET }, { id: "p2", method: "cash", amount: 5, recordedByName: SECRET }] };
  await c.collection("invoices").doc("i1").set(inv);
  await c.collection("invoices").doc("iDraft").set({ ...inv, invoiceNumber: "INV-D", finalized: false, smsSent: false, status: "pending", createdAt: at(4500) });
  await c.collection("invoices").doc("iDel").set({ ...inv, invoiceNumber: "INV-X", isDeleted: true, createdAt: at(4600) });
  await c.collection("invoices").doc("iOther").set({ ...inv, customerId: "cu2", invoiceNumber: "INV-O" });
  await c.collection("bookings").doc("b1").set({ customerId: "cu1", plateNumber: "CAB-1", requestedDate: "2027-03-01", requestedSlot: "09:00", status: "requested", customerPhone: PHONE, createdAt: at(8000) });
  await c.collection("bookings").doc("b2").set({ customerId: "cu1", plateNumber: "CAB-1", requestedDate: "2027-03-02", requestedSlot: "10:00", status: "rejected", rejectionReason: "Closed", reviewedByName: SECRET, createdAt: at(8100) });
  await c.collection("bookings").doc("b3").set({ customerId: "cu2", plateNumber: "NOT-MINE", requestedDate: "2027-03-01", requestedSlot: "11:00", status: "confirmed", customerName: "Someone Else", createdAt: at(8200) });
  await c.collection("bookings").doc("b4").set({ customerId: "cu2", requestedDate: "2027-03-01", requestedSlot: "13:00", status: "cancelled", createdAt: at(8300) });
  await c.collection("bookings").doc("b5").set({ customerId: "cu2", requestedDate: "2027-03-01", requestedSlot: "09:00", status: "checked_in", createdAt: at(8400) });
  await c.collection("customerFeedback").doc("f1").set({ customerId: "cu1", customerName: NAME, customerPhone: PHONE, type: "complaint", message: "Slow", status: "new", reviewedByName: SECRET, createdAt: at(9000) });
  await c.collection("customerFeedback").doc("f2").set({ customerId: "cu2", type: "suggestion", message: "not mine", status: "new", createdAt: at(9100) });
}

before(async () => { await wipe(); });
beforeEach(async () => { await wipe(); await seed(); clock = T0; logs = []; });

const ok = { centerId: "c1", customerId: "cu1" };

// ── getPortalData ─────────────────────────────────────────────────────────────

test("getPortalData returns the portal, and nothing internal, anywhere", async () => {
  const out = await portal.getPortalData(req(ok));
  assert.equal(out.found, true);
  const json = JSON.stringify(out);
  for (const leak of [SECRET, "4444", "5555", "7777", "6666", "1111", "98765", "ownerUid", "costPrice", "unitCost", "laborCost", "commissionTotal",
    "internalNotes", "technician", "partsUsed", "nic", "paymentCode", "ownerPhone", "authorName", "recordedBy", "reviewedBy", "qrCodeUrl", "photoUrls"]) {
    assert.ok(!json.includes(leak), `payload leaked ${leak}`);
  }
  assert.deepEqual(out.customer, { id: "cu1", name: NAME, phone: PHONE, createdAtMillis: 1000 });
  assert.deepEqual(Object.keys(out.center).sort(), ["calendarOverrides", "diagnosticReportsEnabled", "logoUrl", "name", "phone", "slotDurationMinutes", "standaloneInspectionEnabled", "weeklyHours"]);
  assert.equal(out.center.standaloneInspectionEnabled, true);
  assert.deepEqual(out.vehicles.map((v) => v.id), ["v1"], "deleted and other customers' vehicles are not returned");
  assert.deepEqual(out.jobs.map((j) => j.id), ["j1"], "deleted jobs and other customers' jobs are not returned");
  assert.deepEqual(out.jobs[0], { id: "j1", plateNumber: "CAB-1", createdAtMillis: 2000, services: ["Oil change"], customServices: ["Polish"], mileageOut: 50100 });
  assert.deepEqual(out.invoices.map((i) => i.id), ["i1"], "drafts, deleted and other customers' invoices are not returned");
  assert.deepEqual(out.invoices[0].payments.map((p) => p.method), ["cheque"], "cash payments stay out");
  assert.deepEqual(out.sharedNotes.map((n) => n.id), ["n1"], "only customer-visible notes");
  assert.equal(out.sharedNotes[0].plateNumber, "CAB-1");
  assert.deepEqual(out.bookings.map((b) => b.id), ["b2", "b1"], "own bookings only, newest first");
  assert.equal(out.bookings[0].rejectionReason, "Closed");
  assert.deepEqual(out.feedback.map((f) => f.id), ["f1"]);
  assert.deepEqual(out.next, { jobs: null, invoices: null });
});

test("pagination: `before` walks older history without gaps or repeats", async () => {
  const c = db.doc("servicecenters/c1");
  const batch = db.batch();
  for (let i = 0; i < 120; i++) {
    batch.set(c.collection("jobs").doc(`bulk${String(i).padStart(3, "0")}`), { customerId: "cu1", plateNumber: "CAB-1", createdAt: at(100000 + i * 10), services: [`s${i}`] });
  }
  await batch.commit();
  const seen = [];
  let page = await portal.getPortalData(req(ok));
  assert.equal(page.jobs.length, PAGE_SIZE);
  seen.push(...page.jobs.map((j) => j.id));
  let cursor = page.next.jobs;
  let pages = 1;
  while (cursor) {
    page = await portal.getPortalData(req({ ...ok, before: { jobs: cursor } }));
    assert.deepEqual(Object.keys(page).sort(), ["found", "invoices", "jobs", "next"], "older pages carry only the lists");
    assert.deepEqual(page.invoices, []);
    seen.push(...page.jobs.map((j) => j.id));
    cursor = page.next.jobs;
    pages++;
    assert.ok(pages < 10);
  }
  assert.equal(new Set(seen).size, seen.length, "no repeats");
  assert.equal(seen.length, 121, "120 bulk + j1; the deleted job never appears");
  const millis = seen.map((id) => (id === "j1" ? 2000 : 100000 + Number(id.slice(4)) * 10));
  assert.deepEqual(millis, [...millis].sort((a, b) => b - a), "newest first throughout");
});

test("a `before` cursor naming someone else's document is refused", async () => {
  assert.equal(await code(portal.getPortalData(req({ ...ok, before: { jobs: "jOther" } }))), "invalid-argument");
  assert.equal(await code(portal.getPortalData(req({ ...ok, before: { jobs: "no/slash" } }))), "invalid-argument");
  assert.equal(await code(portal.getPortalData(req({ ...ok, before: { jobs: 42 } }))), "invalid-argument");
});

test("every kind of wrong link gets the same answer", async () => {
  const wrong = [
    { centerId: "nope", customerId: "cu1" },
    { centerId: "c1", customerId: "nope" },
    { centerId: "c1", customerId: "cuDel" },
    { centerId: "c1", customerId: "cuX" },        // a customer of another center
    { centerId: "c1/../c2", customerId: "cu1" },  // malformed
    { centerId: "c1", customerId: "a b" },
  ];
  for (const w of wrong) assert.deepEqual(await portal.getPortalData(req(w)), { found: false }, JSON.stringify(w));
});

test("a missing parameter is a client error, not a 'not found'", async () => {
  assert.equal(await code(portal.getPortalData(req({}))), "invalid-argument");
  assert.equal(await code(portal.getPortalData(req({ centerId: "c1" }))), "invalid-argument");
  assert.equal(await code(portal.getPortalData(req({ centerId: 5, customerId: "cu1" }))), "invalid-argument");
});

// ── getPublicInvoice ──────────────────────────────────────────────────────────

test("getPublicInvoice returns the bill without the shop's cost or staff", async () => {
  const out = await portal.getPublicInvoice(req({ ...ok, invoiceId: "i1" }));
  assert.equal(out.found, true);
  const json = JSON.stringify(out);
  for (const leak of [SECRET, "1111", "5555", "86421", "costPrice", "commission", "technician", "recordedBy", "pdfUrl", "ownerUid", "98765"]) {
    assert.ok(!json.includes(leak), `payload leaked ${leak}`);
  }
  assert.equal(out.invoice.lineItems[0].unitPrice, 2500);
  assert.equal(out.invoice.lineItems[0].brand, "Bosch");
  assert.deepEqual(out.invoice.payments.map((p) => p.method), ["cheque"]);
  assert.deepEqual(Object.keys(out.center).sort(), ["address", "email", "invoicePaper", "logoUrl", "name", "phone", "phone2"]);
});

test("getPublicInvoice: wrong owner, draft, deleted and missing are all the same 'not found'", async () => {
  for (const invoiceId of ["iOther", "iDraft", "iDel", "ghost"]) {
    assert.deepEqual(await portal.getPublicInvoice(req({ ...ok, invoiceId })), { found: false }, invoiceId);
  }
  assert.deepEqual(await portal.getPublicInvoice(req({ centerId: "c9", customerId: "cu1", invoiceId: "i1" })), { found: false });
  assert.equal(await code(portal.getPublicInvoice(req(ok))), "invalid-argument");
});

// ── getBookingSlots ───────────────────────────────────────────────────────────

test("getBookingSlots returns taken times only — no customers, no plates", async () => {
  const out = await portal.getBookingSlots(req({ ...ok, date: "2027-03-01" }));
  assert.deepEqual(out, { found: true, takenSlots: ["09:00", "11:00"] }, "requested/confirmed/checked_in count; cancelled does not; duplicates collapse");
  assert.deepEqual(await portal.getBookingSlots(req({ ...ok, date: "2030-01-01" })), { found: true, takenSlots: [] });
});

test("getBookingSlots validates its input and the customer", async () => {
  assert.equal(await code(portal.getBookingSlots(req({ ...ok, date: "tomorrow" }))), "invalid-argument");
  assert.equal(await code(portal.getBookingSlots(req(ok))), "invalid-argument");
  assert.deepEqual(await portal.getBookingSlots(req({ centerId: "c1", customerId: "ghost", date: "2027-03-01" })), { found: false });
});

// ── Throttle ──────────────────────────────────────────────────────────────────

test("an IP that keeps missing is cut off at the miss cap — and a real link from it is refused too", async () => {
  const ip = "198.51.100.1";
  for (let i = 0; i < LIMITS.ipMisses; i++) {
    assert.deepEqual(await portal.getPortalData(req({ centerId: "c1", customerId: `ghost${i}` }, ip)), { found: false });
  }
  assert.equal(await code(portal.getPortalData(req({ centerId: "c1", customerId: "ghost-more" }, ip))), "resource-exhausted");
  assert.equal(await code(portal.getPortalData(req(ok, ip))), "resource-exhausted");
  // A different caller is unaffected.
  assert.equal((await portal.getPortalData(req(ok, "198.51.100.2"))).found, true);
});

test("a shared address of real customers is NOT cut off at 20/hour", async () => {
  const ip = "198.51.100.3";
  // 60 different customers' valid links from one NAT'd IP inside an hour.
  const batch = db.batch();
  for (let i = 0; i < 60; i++) batch.set(db.doc(`servicecenters/c1/customers/nat${i}`), { name: `N${i}`, phone: "0770000000", isDeleted: false });
  await batch.commit();
  for (let i = 0; i < 60; i++) assert.equal((await portal.getPortalData(req({ centerId: "c1", customerId: `nat${i}` }, ip))).found, true);
});

test("the total ceiling per IP holds, then lifts when the hour rolls over", async () => {
  const ip = "198.51.100.4";
  await db.doc("servicecenters/c1/customers/many").set({ name: "M", isDeleted: false });
  // Fill the IP bucket directly rather than making 300 round trips.
  const crypto = require("crypto");
  const bucket = `portalThrottle/ip_${crypto.createHash("sha256").update(ip).digest("hex").slice(0, 32)}`;
  await db.doc(bucket).set({ windowStart: Math.floor(T0 / WINDOW_MS) * WINDOW_MS, total: LIMITS.ipTotal, misses: 0 });
  assert.equal(await code(portal.getPortalData(req({ centerId: "c1", customerId: "many" }, ip))), "resource-exhausted");
  clock = T0 + WINDOW_MS;
  assert.equal((await portal.getPortalData(req({ centerId: "c1", customerId: "many" }, ip))).found, true);
});

test("one customer's record can only be pulled so often, whoever asks", async () => {
  for (let i = 0; i < LIMITS.customerTotal; i++) {
    assert.equal((await portal.getBookingSlots(req({ ...ok, date: "2027-03-01" }, `192.0.2.${i % 250}.${i}`))).found, true);
  }
  assert.equal(await code(portal.getBookingSlots(req({ ...ok, date: "2027-03-01" }, "192.0.2.250"))), "resource-exhausted");
  assert.equal((await portal.getPortalData(req({ centerId: "c1", customerId: "cu2" }, "192.0.2.251"))).found, true, "other customers unaffected");
});

test("a throttle store outage fails open: the customer still gets their page", async () => {
  const broken = new Proxy(db, { get: (t, k) => (k === "runTransaction" ? () => Promise.reject(Object.assign(new Error("store down"), { code: 14 })) : (typeof t[k] === "function" ? t[k].bind(t) : t[k])) });
  const p = createPortal({ db: broken, now: () => clock, logger: spy, toTimestamp: (ms) => Timestamp.fromMillis(ms) });
  assert.equal((await p.getPortalData(req(ok))).found, true);
});

test("throttle documents carry no raw IP and expire", async () => {
  await portal.getPortalData(req(ok, "198.51.100.77"));
  const snap = await db.collection("portalThrottle").get();
  assert.ok(snap.size >= 2, "an IP bucket and a customer bucket");
  for (const d of snap.docs) {
    assert.ok(!d.id.includes("198.51.100.77"));
    assert.ok(d.data().expireAt, "expireAt is set so a TTL policy can reap it");
  }
});

// ── Logging ───────────────────────────────────────────────────────────────────

test("nothing sensitive is logged — not phones, names, payloads or the raw IP", async () => {
  const ip = "198.51.100.88";
  for (let i = 0; i <= LIMITS.ipMisses; i++) await code(portal.getPortalData(req({ centerId: "c1", customerId: `g${i}` }, ip)));
  await code(portal.getPortalData(req(ok, ip)));      // throttled → warn
  await portal.getPublicInvoice(req({ ...ok, invoiceId: "i1" }, "198.51.100.89"));
  await portal.getPortalData(req(ok, "198.51.100.90"));
  assert.ok(logs.length > 0, "the throttle refusal is logged");
  const all = JSON.stringify(logs);
  for (const s of [PHONE, NAME, SECRET, ip, "Auto One", "2500", "Oil filter"]) assert.ok(!all.includes(s), `logs contain ${s}`);
});
