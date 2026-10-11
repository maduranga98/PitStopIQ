// Rules tests for the Repair Catalog's job fields (repairsPerformed / modelId) and
// the "repair" invoice line. Reads firestore.rules; changes nothing in it.
//   npx firebase emulators:exec --only firestore --project demo-test "node --test tests/rules/jobRepairs.rules.test.mjs"
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc } from "firebase/firestore";

const C = "c1";
const RULES = process.env.RULES_PATH ?? new URL("../../firestore.rules", import.meta.url).pathname;
let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-test",
    firestore: { rules: readFileSync(RULES, "utf8"), host: "127.0.0.1", port: Number(process.env.FIRESTORE_EMULATOR_PORT ?? 8085) },
  });
});
after(async () => { await env.cleanup(); });

const ROLES = { owner1: "Owner", mgr1: "Manager", tech1: "Technician", cash1: "Cashier", rec1: "Receptionist" };
const repairs = [{ repairItemId: "r1", name: "Brake job", price: 3500, custom: false, resolvedFrom: "model" }];
const repairLine = { description: "Brake job", qty: 1, unitPrice: 3500, lineTotal: 3500, type: "repair", repairItemId: "r1" };
const as = (uid) => env.authenticatedContext(uid).firestore();
const jobRef = (db) => doc(db, "servicecenters", C, "jobs", "j1");
const invRef = (db) => doc(db, "servicecenters", C, "invoices", "i1");

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "servicecenters", C), { name: "C", plan: "pro", repairCatalogEnabled: true, ownerUid: "owner1" });
    for (const [uid, role] of Object.entries(ROLES)) await setDoc(doc(db, "servicecenters", C, "staff", uid), { role });
    await setDoc(jobRef(db), { status: "pending", services: ["Oil change"], partsUsed: [], technicianIds: ["tech1"] });
    await setDoc(invRef(db), {
      serviceId: "j1", status: "pending", paidAmount: 0, discount: 0, tax: 0,
      lineItems: [{ description: "Oil change", qty: 1, unitPrice: 2500, lineTotal: 2500, type: "service" }],
      subtotal: 2500, grandTotal: 2500, balanceDue: 2500,
    });
  });
});

test("jobs: Owner, Manager, Receptionist and Technician can write repairsPerformed; a Cashier cannot", async () => {
  for (const uid of ["owner1", "mgr1", "rec1", "tech1"]) {
    await assertSucceeds(updateDoc(jobRef(as(uid)), { repairsPerformed: repairs }));
  }
  // A value that differs from what is stored, so the write really changes the key.
  await assertFails(updateDoc(jobRef(as("cash1")), { repairsPerformed: [{ ...repairs[0], price: 1 }] }));
  // A Cashier still has the keys they always had.
  await assertSucceeds(updateDoc(jobRef(as("cash1")), { partsUsed: [] }));
});

test("invoices: a Receptionist / Technician can re-price an untouched draft with a repair line", async () => {
  const lines = [{ description: "Oil change", qty: 1, unitPrice: 2500, lineTotal: 2500, type: "service" }, repairLine];
  const reprice = { lineItems: lines, subtotal: 6000, grandTotal: 6000, balanceDue: 6000 };
  await assertSucceeds(updateDoc(invRef(as("rec1")), reprice));
  await assertSucceeds(updateDoc(invRef(as("tech1")), { ...reprice, subtotal: 6000 }));
});

test("invoices: once money is against the bill, a Receptionist can no longer re-price it", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => { await updateDoc(invRef(ctx.firestore()), { paidAmount: 500 }); });
  await assertFails(updateDoc(invRef(as("rec1")), { lineItems: [repairLine], subtotal: 3500, grandTotal: 3500, balanceDue: 3500 }));
});

test("invoices: a Receptionist creating the first draft of a repairs-only job passes the pristine-draft check", async () => {
  await assertSucceeds(setDoc(doc(as("rec1"), "servicecenters", C, "invoices", "i2"), {
    serviceId: "j2", status: "pending", paidAmount: 0, discount: 0, tax: 0,
    lineItems: [repairLine], subtotal: 3500, grandTotal: 3500, balanceDue: 3500,
  }));
});
