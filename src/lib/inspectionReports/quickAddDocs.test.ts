// Run with: npm test   (node --test, TypeScript stripped natively by Node)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  toStoredCustomerPhone, looksLikePhone, storedPlate, validateQuickCustomer, validateQuickVehicle,
  buildCustomerDoc, buildVehicleDoc,
} from "./quickAddDocs.ts";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const NOW = "NOW";

// ── Phone ────────────────────────────────────────────────────────────────────
test("phone: every form Add Customer accepts maps to the same stored value", () => {
  for (const raw of ["0771234567", "+94771234567", "94771234567", "077 123 4567", "077-123-4567"]) {
    assert.equal(toStoredCustomerPhone(raw), "+94771234567", raw);
  }
  // Extra forms the shared login/SMS normaliser also understands.
  assert.equal(toStoredCustomerPhone("0094771234567"), "+94771234567");
  assert.equal(toStoredCustomerPhone("771234567"), "+94771234567");
});

test("phone: rejects what is not a Sri Lankan number", () => {
  for (const raw of ["", "abc", "12345", "+1 202 555 0100", "077123456", "kamal@x.lk"]) {
    assert.equal(toStoredCustomerPhone(raw), null, raw);
  }
});

test("search box: phone vs plate", () => {
  assert.equal(looksLikePhone("077 123 4567"), true);
  assert.equal(looksLikePhone("CAB-1234"), false);
  assert.equal(looksLikePhone("1234"), false);
});

// ── Validation mirrors the pages ─────────────────────────────────────────────
test("customer validation", () => {
  assert.deepEqual(validateQuickCustomer({ name: "Kamal", phone: "0771234567" }), {});
  assert.ok(validateQuickCustomer({ name: "K", phone: "0771234567" }).name);
  assert.ok(validateQuickCustomer({ name: "x".repeat(81), phone: "0771234567" }).name);
  assert.ok(validateQuickCustomer({ name: "Kamal", phone: "" }).phone);
  assert.ok(validateQuickCustomer({ name: "Kamal", phone: "12" }).phone);
});

test("vehicle validation: plate and type required, mileage optional but sane", () => {
  const ok = { plate: "cab-1234", make: "", model: "", vehicleType: "Car", mileage: "" };
  assert.deepEqual(validateQuickVehicle(ok), {});
  assert.ok(validateQuickVehicle({ ...ok, plate: " " }).plate);
  assert.ok(validateQuickVehicle({ ...ok, vehicleType: "" }).vehicleType);
  assert.ok(validateQuickVehicle({ ...ok, mileage: "-5" }).mileage);
  assert.ok(validateQuickVehicle({ ...ok, mileage: "abc" }).mileage);
  assert.deepEqual(validateQuickVehicle({ ...ok, mileage: "0" }), {});
});

// ── Documents ────────────────────────────────────────────────────────────────
test("customer doc has the same values Add Customer writes", () => {
  assert.deepEqual(buildCustomerDoc("c1", { name: "  Kamal Perera ", phone: "077 123 4567" }, NOW), {
    name: "Kamal Perera", phone: "+94771234567", smsLanguage: "english", notes: null,
    isDeleted: false, vehicleCount: 0, lastServiceDate: null, createdAt: NOW, centerId: "c1",
  });
});

test("vehicle doc: plate upper-cased, reminder fields NOT set, mileage kept only as the reading", () => {
  const d = buildVehicleDoc("c1", { id: "cu1", name: "Kamal" },
    { plate: " cab-1234 ", make: " Toyota ", model: "", vehicleType: " Car ", mileage: "45000" }, NOW);
  assert.equal(d.plateNumber, "CAB-1234");
  assert.equal(storedPlate(" cab-1234 "), "CAB-1234");
  assert.equal(d.make, "Toyota");
  assert.equal(d.model, null);
  assert.equal(d.vehicleType, "Car");
  assert.equal(d.currentMileageKm, 45000);
  assert.equal(d.nextServiceMileageKm, null); // Add Vehicle would write 50000 here
  assert.equal(d.isDeleted, false);
  assert.deepEqual(d.photoUrls, []);
  assert.equal(buildVehicleDoc("c1", { id: "x", name: "y" }, { plate: "A", make: "", model: "", vehicleType: "Car", mileage: "" }, NOW).currentMileageKm, null);
});

// ── Parity with the real pages (they are not edited, so they must not drift) ──
/** Top-level `key:` names inside the first `{ ... }` literal that follows `anchor`. */
function literalKeys(src: string, anchor: string, depthIndent: number): string[] {
  const start = src.indexOf(anchor);
  assert.notEqual(start, -1, `anchor not found: ${anchor}`);
  const open = src.indexOf("{", start);
  const lines = src.slice(open).split("\n");
  const keys: string[] = [];
  const pad = " ".repeat(depthIndent);
  for (const line of lines.slice(1)) {
    if (/^\s*}/.test(line) && !line.startsWith(pad + " ")) break;
    const m = line.match(new RegExp(`^${pad}(\\w+):`)) ?? line.match(new RegExp(`^${pad}(\\w+),\\s*$`));
    if (m) keys.push(m[1]);
  }
  return keys;
}

test("parity: customer fields == AddCustomerPage.doCreate", () => {
  const src = read("pages/customers/AddCustomerPage.tsx");
  const pageKeys = literalKeys(src, "async function doCreate", 10);
  assert.deepEqual([...pageKeys].sort(), Object.keys(buildCustomerDoc("c", { name: "Ab", phone: "0771234567" }, NOW)).sort());
});

test("parity: vehicle fields == AddVehiclePage.doSave (payload + photoUrls + createdAt)", () => {
  const src = read("pages/vehicles/AddVehiclePage.tsx");
  const payloadKeys = literalKeys(src, "const payload = {", 8);
  assert.ok(payloadKeys.length > 10, "payload keys not parsed");
  const expected = [...payloadKeys, "photoUrls", "createdAt"].sort();
  const ours = Object.keys(buildVehicleDoc("c", { id: "i", name: "n" }, { plate: "A", make: "", model: "", vehicleType: "T", mileage: "" }, NOW)).sort();
  assert.deepEqual(ours, expected);
  assert.match(src, /\{ \.\.\.payload, photoUrls: \[\], createdAt: Timestamp\.now\(\) \}/);
});
