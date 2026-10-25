// Post-service checklist report PDF: the record -> report mapping and a real
// render. Pure — no emulator, no firebase-admin. The render tests need pdfkit,
// which lives in functions/node_modules; where the functions dependencies are
// not installed they are skipped rather than failed (the mapping tests still run).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../functions/package.json", import.meta.url));
const { reportFromRecord } = require("./postServiceChecklistReport.js");
let render = null;
let skip = false;
try { render = require("./postServiceChecklistPdf.js").renderChecklistPdf; } catch { skip = "functions dependencies (pdfkit) are not installed"; }
const mod = { reportFromRecord, renderChecklistPdf: (...a) => render(...a) };

const item = (id, label, type, status, extra = {}) => ({ id, label, order: 0, type, status, value: null, technicianName: null, ...extra });
const section = (id, title, items, hasTechnician = false) => ({ id, title, order: 0, hasTechnician, items: items.map((i, order) => ({ ...i, order })) });
const ts = (d) => ({ toDate: () => d });

const record = {
  templateName: "Post-Service Checklist",
  sections: [
    section("b", "12V Battery", [item("b0", "Battery Charge", "status_numeric", "ok", { value: 13.5, unit: "V" }), item("b1", "Battery Indicator", "status_numeric", "immediate", { value: 9, unit: "V" })]),
    section("k", "Brake Service", [item("k0", "Rear Brake Service", "status", "attention", { technicianName: "Ishan" })], true),
  ],
  remarks: "Caliper pin checked", completedBy: "u1", completedAt: ts(new Date("2026-10-13T10:00:00Z")),
  date: ts(new Date("2026-10-12T00:00:00Z")), plateNumberManual: null, vehicleId: "v1", customerId: "c1", customerNameManual: null, mileage: 120500,
};

test("a standalone record's header comes from the documents it points at, or what was typed", () => {
  const r = mod.reportFromRecord({ kind: "standalone", record, customer: { name: "Kamal", phone: "0771234567" }, vehicle: { plateNumber: "CAI 5598" }, signerName: "Ranga" });
  assert.deepEqual([r.header.plate, r.header.customer, r.header.phone, r.header.mileage], ["CAI 5598", "Kamal", "0771234567", 120500]);
  assert.equal(r.header.date.toISOString(), "2026-10-12T00:00:00.000Z");
  assert.equal(r.signerName, "Ranga");
  const typed = mod.reportFromRecord({ kind: "standalone", record: { ...record, vehicleId: null, customerId: null, plateNumberManual: "WP 1", customerNameManual: "Walk-in" } });
  assert.deepEqual([typed.header.plate, typed.header.customer], ["WP 1", "Walk-in"]);
});

test("a job's header comes off the job card, dated by the sign-off", () => {
  const r = mod.reportFromRecord({ kind: "job", record, job: { plateNumber: "CAB 1", customerName: "Sam", customerPhone: "07", mileageIn: 100, mileageOut: 150, jobNumber: "J-9" } });
  assert.deepEqual([r.header.plate, r.header.customer, r.header.mileage, r.header.reference], ["CAB 1", "Sam", 150, "J-9"]);
  assert.equal(r.header.date.toISOString(), "2026-10-13T10:00:00.000Z");
});

test("a checklist filled in before sections existed still reports: ticked = OK", () => {
  const r = mod.reportFromRecord({ kind: "job", record: { items: [{ id: "a", label: "A", checked: true }, { id: "b", label: "B", checked: false }], completedAt: ts(new Date()) }, job: {} });
  assert.equal(r.sections.length, 1);
  assert.deepEqual(r.sections[0].items.map((i) => i.status), ["ok", null]);
});

test("sections and lines come back in order", () => {
  const raw = (id, order, items) => ({ id, title: id, order, hasTechnician: false, items });
  const r = mod.reportFromRecord({ kind: "standalone", record: { ...record, sections: [
    raw("Second", 1, [item("x", "X", "status", "ok")]),
    raw("First", 0, [{ ...item("b", "B", "status", "ok"), order: 1 }, { ...item("a", "A", "status", "ok"), order: 0 }]),
  ] } });
  assert.deepEqual(r.sections.map((s) => s.title), ["First", "Second"]);
  assert.deepEqual(r.sections[0].items.map((i) => i.id), ["a", "b"]);
});

test("renders a valid, paginated PDF for a long report with readings, names and odd text", { skip }, async () => {
  const many = Array.from({ length: 80 }, (_, i) => item(`m${i}`, `Check ${i + 1} ${i % 9 === 0 ? "ශ්‍රී தமிழ் 😀 and a label long enough to wrap across the label column for sure, twice over" : ""}`, "status", ["ok", "attention", "immediate", null][i % 4]));
  const report = mod.reportFromRecord({ kind: "standalone", record: { ...record, sections: [section("m", "Everything", many), ...record.sections], remarks: "x".repeat(900) }, customer: { name: "Kamal" }, vehicle: { plateNumber: "CAI 5598" }, signerName: "Ranga" });
  const buf = await mod.renderChecklistPdf({ report, center: { name: "Halford Care", phone: "+94 762 36 36 37", logo: null } });
  assert.equal(buf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(buf.length > 5000);
  assert.ok((buf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length >= 3, "a long report runs onto further pages");
});

test("renders with nothing rated, no sections at all, and a missing header", { skip }, async () => {
  const empty = await mod.renderChecklistPdf({ report: { title: "T", header: {}, sections: [], remarks: "", signerName: "" }, center: { name: "C", logo: null } });
  assert.equal(empty.subarray(0, 5).toString(), "%PDF-");
  const unrated = await mod.renderChecklistPdf({ report: mod.reportFromRecord({ kind: "job", record: { ...record, sections: [section("s", "S", [item("i", "Line", "status", null)])] }, job: {} }), center: { name: "C", logo: null } });
  assert.equal(unrated.subarray(0, 5).toString(), "%PDF-");
});
