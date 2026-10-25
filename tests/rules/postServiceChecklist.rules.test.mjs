// Rules tests for standalone post-service checklists, the sectioned template
// shape and the send-to-customer switch.
//   npx firebase emulators:exec --only firestore --project demo-test "node --test tests/rules/postServiceChecklist.rules.test.mjs"
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, deleteDoc, getDoc, Timestamp } from "firebase/firestore";

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

const ROLES = { owner1: "Owner", mgr1: "Manager", tech1: "Technician", tech2: "Technician", cash1: "Cashier", rec1: "Receptionist" };
const as = (uid) => env.authenticatedContext(uid).firestore();
const ref = (db, id = "k1") => doc(db, "servicecenters", C, "postServiceChecklists", id);

const sections = [{
  id: "s1", title: "12V Battery", order: 0, hasTechnician: false,
  items: [{ id: "i1", label: "Battery Charge", order: 0, type: "status_numeric", unit: "V", status: null, value: null }],
}];
const record = (over = {}) => ({
  templateId: "t1", templateName: "Default", allowedRoles: ["Owner", "Manager", "Technician"],
  assignedTo: null, sections, remarks: null,
  customerId: null, customerNameManual: "Walk-in Sam", vehicleId: null, plateNumberManual: "CAI 5598",
  mileage: 120000, date: Timestamp.now(),
  completedBy: null, completedAt: null, createdBy: "tech1", createdAt: Timestamp.now(),
  ...over,
});

async function seed({ moduleOn = true, plan = "pro" } = {}) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "servicecenters", C), { name: "C", plan, postServiceChecklistEnabled: moduleOn, ownerUid: "owner1" });
    for (const [uid, role] of Object.entries(ROLES)) await setDoc(doc(db, "servicecenters", C, "staff", uid), { role });
  });
}
const seedRecord = (over) => env.withSecurityRulesDisabled((ctx) => setDoc(ref(ctx.firestore()), record(over)));

beforeEach(() => seed());

test("Owner, Manager and Technician can create (as themselves); Cashier and Receptionist cannot", async () => {
  await assertSucceeds(setDoc(ref(as("tech1"), "a"), record({ createdBy: "tech1" })));
  await assertSucceeds(setDoc(ref(as("mgr1"), "b"), record({ createdBy: "mgr1" })));
  await assertSucceeds(setDoc(ref(as("owner1"), "c"), record({ createdBy: "owner1" })));
  await assertFails(setDoc(ref(as("cash1"), "d"), record({ createdBy: "cash1" })));
  await assertFails(setDoc(ref(as("rec1"), "e"), record({ createdBy: "rec1" })));
  // A record cannot be created in someone else's name, or already signed off.
  await assertFails(setDoc(ref(as("tech1"), "f"), record({ createdBy: "mgr1" })));
  await assertFails(setDoc(ref(as("tech1"), "g"), record({ completedAt: Timestamp.now(), completedBy: "tech1" })));
});

test("creation needs the Pro module switched on", async () => {
  await seed({ moduleOn: false });
  await assertFails(setDoc(ref(as("owner1")), record({ createdBy: "owner1" })));
  await seed({ plan: "basic" });
  await assertFails(setDoc(ref(as("owner1")), record({ createdBy: "owner1" })));
});

test("header: mileage is optional and unchecked against history; bad shapes are refused", async () => {
  await assertSucceeds(setDoc(ref(as("tech1"), "a"), record({ mileage: null })));
  await assertSucceeds(setDoc(ref(as("tech1"), "b"), record({ mileage: 5 })));
  await assertFails(setDoc(ref(as("tech1"), "c"), record({ mileage: "lots" })));
  await assertFails(setDoc(ref(as("tech1"), "d"), record({ mileage: -1 })));
  await assertFails(setDoc(ref(as("tech1"), "e"), record({ date: "yesterday" })));
  await assertFails(setDoc(ref(as("tech1"), "f"), record({ sections: [] })));
  await assertFails(setDoc(ref(as("tech1"), "g"), record({ sections: "x" })));
});

test("every staff member reads; a non-member does not", async () => {
  await seedRecord();
  for (const uid of Object.keys(ROLES)) await assertSucceeds(getDoc(ref(as(uid))));
  await assertFails(getDoc(ref(env.authenticatedContext("stranger").firestore())));
});

test("an open record can be filled in by an eligible role, not by a Cashier", async () => {
  await seedRecord();
  await assertSucceeds(updateDoc(ref(as("tech2")), { remarks: "Caliper pin checked" }));
  await assertFails(updateDoc(ref(as("cash1")), { remarks: "x" }));
  await assertFails(updateDoc(ref(as("rec1")), { remarks: "x" }));
});

test("sign-off must be the signer's own, and then the record is frozen", async () => {
  await seedRecord();
  await assertFails(updateDoc(ref(as("tech1")), { completedAt: Timestamp.now(), completedBy: "mgr1" }));
  await assertSucceeds(updateDoc(ref(as("tech1")), { completedAt: Timestamp.now(), completedBy: "tech1" }));
  await assertFails(updateDoc(ref(as("owner1")), { remarks: "edit after sign-off" }));
  await assertFails(updateDoc(ref(as("owner1")), { completedAt: null, completedBy: null }));
});

test("what a record was built from cannot be rewritten; only Owner/Manager reassign", async () => {
  await seedRecord();
  await assertFails(updateDoc(ref(as("tech1")), { allowedRoles: ["Owner", "Manager", "Technician", "Cashier"] }));
  await assertFails(updateDoc(ref(as("tech1")), { createdBy: "owner1" }));
  await assertFails(updateDoc(ref(as("tech1")), { templateId: "other" }));
  await assertFails(updateDoc(ref(as("tech1")), { assignedTo: "tech1" }));
  await assertSucceeds(updateDoc(ref(as("mgr1")), { assignedTo: "tech2" }));
  // Pinned to tech2: tech1 is no longer eligible, Owner/Manager still can reassign.
  await assertFails(updateDoc(ref(as("tech1")), { remarks: "x" }));
  await assertSucceeds(updateDoc(ref(as("tech2")), { remarks: "x" }));
});

test("only the Owner can delete, in any state short of sent to the customer", async () => {
  await seedRecord();
  await assertFails(deleteDoc(ref(as("mgr1"))));
  await assertFails(deleteDoc(ref(as("tech1"))));
  await assertSucceeds(deleteDoc(ref(as("owner1"))));
  await seedRecord({ completedAt: Timestamp.now(), completedBy: "tech1" });
  await assertFails(deleteDoc(ref(as("mgr1"))));
  await assertSucceeds(deleteDoc(ref(as("owner1"))));
});

test("once sent to the customer, not even the Owner can delete it", async () => {
  await seedRecord({ completedAt: Timestamp.now(), completedBy: "tech1", sentToCustomer: true, sentAt: Timestamp.now(), sentBy: "mgr1" });
  await assertFails(deleteDoc(ref(as("owner1"))));
  await assertFails(deleteDoc(ref(as("mgr1"))));
  // An explicit false (or an absent flag) still deletes.
  await seedRecord({ sentToCustomer: false });
  await assertSucceeds(deleteDoc(ref(as("owner1"))));
});

test("marking as sent: Owner/Manager, signed-off records only, set-once, nothing else alongside", async () => {
  const sent = { sentToCustomer: true, sentAt: Timestamp.now(), sentBy: "mgr1" };
  // Not signed off yet: no.
  await seedRecord();
  await assertFails(updateDoc(ref(as("mgr1")), sent));
  // Signed off: Manager can; a Technician and a stranger's uid cannot.
  await seedRecord({ completedAt: Timestamp.now(), completedBy: "tech1" });
  await assertFails(updateDoc(ref(as("tech1")), { ...sent, sentBy: "tech1" }));
  await assertFails(updateDoc(ref(as("mgr1")), { ...sent, sentBy: "owner1" }));
  await assertFails(updateDoc(ref(as("mgr1")), { ...sent, remarks: "sneaky edit" }));
  await assertSucceeds(updateDoc(ref(as("mgr1")), sent));
  // Set-once and never cleared; the record stays frozen.
  await assertFails(updateDoc(ref(as("owner1")), { sentToCustomer: false }));
  await assertFails(updateDoc(ref(as("owner1")), { ...sent, sentBy: "owner1" }));
  await assertFails(updateDoc(ref(as("owner1")), { remarks: "edit after sent" }));
});

test("an open record can neither be created nor edited into the sent state", async () => {
  await assertFails(setDoc(ref(as("tech1"), "a"), record({ sentToCustomer: true })));
  await seedRecord();
  await assertFails(updateDoc(ref(as("tech1")), { sentToCustomer: true, sentAt: Timestamp.now(), sentBy: "tech1" }));
});

test("templates: sectioned shape is accepted for the Owner only; the old flat shape still is", async () => {
  const t = (db) => doc(db, "servicecenters", C, "postServiceChecklistTemplates", "t1");
  await assertSucceeds(setDoc(t(as("owner1")), { name: "Default", sections, allowedRoles: ["Owner"], isActive: true, isDefault: true }));
  await assertSucceeds(setDoc(t(as("owner1")), { name: "Old", items: [{ id: "a", label: "x", order: 0 }], allowedRoles: ["Owner"], isActive: true, isDefault: true }));
  await assertFails(setDoc(t(as("owner1")), { name: "Bad", sections: "nope", allowedRoles: ["Owner"] }));
  await assertFails(setDoc(t(as("mgr1")), { name: "Mgr", sections, allowedRoles: ["Owner"] }));
});

test("the send-to-customer switch is Owner-only, like the checklist switch", async () => {
  const c = (db) => doc(db, "servicecenters", C);
  await assertFails(updateDoc(c(as("mgr1")), { postServiceChecklistSendToCustomerEnabled: true }));
  await assertSucceeds(updateDoc(c(as("owner1")), { postServiceChecklistSendToCustomerEnabled: true }));
});

test("the report PDF fields are written by the function only — never by a client, on create or update", async () => {
  const pdf = { pdfUrl: "https://evil.example/x.pdf", pdfPath: "x", pdfGeneratedAt: Timestamp.now() };
  await assertFails(setDoc(ref(as("tech1"), "a"), record({ ...pdf })));
  await seedRecord();
  await assertFails(updateDoc(ref(as("tech1")), { pdfUrl: pdf.pdfUrl }));
  await assertFails(updateDoc(ref(as("mgr1")), { pdfPath: "x" }));
  // A signed-off record is frozen to clients, PDF fields included.
  await seedRecord({ completedAt: Timestamp.now(), completedBy: "tech1" });
  await assertFails(updateDoc(ref(as("owner1")), { pdfUrl: pdf.pdfUrl }));
  await assertFails(updateDoc(ref(as("mgr1")), { sentToCustomer: true, sentAt: Timestamp.now(), sentBy: "mgr1", pdfUrl: pdf.pdfUrl }));
});

test("job-tied instance: PDF fields are refused on create and on update, ordinary fill-in still works", async () => {
  const jobChecklist = (db) => doc(db, "servicecenters", C, "jobs", "j1", "postServiceChecklist", "main");
  const base = { templateId: "t1", templateName: "Default", allowedRoles: ["Technician"], assignedTo: null, sections, remarks: null, completedBy: null, completedAt: null, createdAt: Timestamp.now() };
  await assertFails(setDoc(jobChecklist(as("tech1")), { ...base, pdfUrl: "https://evil.example/x.pdf" }));
  await assertSucceeds(setDoc(jobChecklist(as("tech1")), base));
  await assertFails(updateDoc(jobChecklist(as("tech1")), { pdfUrl: "https://evil.example/x.pdf" }));
  await assertSucceeds(updateDoc(jobChecklist(as("tech1")), { remarks: "ok" }));
});
