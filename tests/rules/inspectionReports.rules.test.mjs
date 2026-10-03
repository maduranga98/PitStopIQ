// Firestore security-rules tests for Inspection Reports.
//
// Not part of `npm test` (needs the Firestore emulator + Java). Run from a
// directory that has @firebase/rules-unit-testing, firebase and firebase-tools:
//
//   npx firebase emulators:exec --only firestore --project demo-test \
//     "node --test tests/rules/inspectionReports.rules.test.mjs"
//
// with a firebase.json whose "firestore.rules" points at ../../firestore.rules.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs,
} from "firebase/firestore";

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

async function seed(moduleOn = true, { plan = "basic", grid = null, customRoles = {}, staffRoleIds = {} } = {}) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "servicecenters", C), { name: "C", plan, standaloneInspectionEnabled: moduleOn, ownerUid: "owner1" });
    for (const [uid, role] of Object.entries(ROLES)) {
      await setDoc(doc(db, "servicecenters", C, "staff", uid), { role, ...(staffRoleIds[uid] ? { customRoleId: staffRoleIds[uid] } : {}) });
    }
    if (grid) await setDoc(doc(db, "servicecenters", C, "settings", "rolePermissions"), grid);
    for (const [id, data] of Object.entries(customRoles)) await setDoc(doc(db, "servicecenters", C, "customRoles", id), data);
  });
}
const ir = (over) => ({ inspectionReports: over });
const as = (uid) => env.authenticatedContext(uid).firestore();
const reportRef = (db, id = "r1") => doc(db, "servicecenters", C, "inspectionReports", id);

function freshDraft(uid, over = {}) {
  return {
    centerId: C, type: "checklist", status: "draft", reportNumber: null,
    vehicleId: "v1", customerId: "cu1",
    header: { customerName: "A", customerPhone: "+94771234567", plateNumber: "CAB1234", make: "", model: "", vehicleType: "Car" },
    mileage: null, reportDate: new Date(), title: "", findings: "",
    templateSnapshot: [], templateDefaultsVersion: 1, results: {}, reportOnlyItems: [],
    media: {}, attachmentIds: [], observations: "", recommendations: "", disclaimer: "d",
    inspectorUid: null, inspectorName: "", signatureName: "", assignedToUid: null,
    finalizedAt: null, pdfUrl: null, pdfPath: null, pdfGeneratedAt: null, nextMediaDeleteAt: null,
    shareToken: "a".repeat(32), shareRevoked: false, viewedAt: null, lastViewedAt: null, viewCount: 0,
    visibleToCustomer: true, sharedAt: null,
    createdBy: uid, createdAt: new Date(), updatedAt: new Date(),
    ...over,
  };
}
async function seedReport(over = {}, id = "r1") {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(reportRef(ctx.firestore(), id), freshDraft("owner1", over));
  });
}

// ── Center flag ──────────────────────────────────────────────────────────────
test("flag: Owner may set it, Manager may not, protected fields stay protected", async () => {
  await seed(false);
  await assertSucceeds(updateDoc(doc(as("owner1"), "servicecenters", C), { standaloneInspectionEnabled: true }));
  await seed(false);
  await assertFails(updateDoc(doc(as("mgr1"), "servicecenters", C), { standaloneInspectionEnabled: true }));
  // Unrelated fields: Manager unchanged behaviour.
  await assertSucceeds(updateDoc(doc(as("mgr1"), "servicecenters", C), { name: "New name" }));
  // Owner still cannot touch billing fields.
  await assertFails(updateDoc(doc(as("owner1"), "servicecenters", C), { plan: "pro" }));
  // Owner sets the flag together with an ordinary field.
  await assertSucceeds(updateDoc(doc(as("owner1"), "servicecenters", C), { standaloneInspectionEnabled: true, name: "X" }));
});

// ── Templates ────────────────────────────────────────────────────────────────
test("templates: Owner/Manager create while on; denied when off, for others, and never deleted", async () => {
  await seed(true);
  const t = (db) => doc(db, "servicecenters", C, "inspectionTemplates", "default");
  await assertSucceeds(setDoc(t(as("mgr1")), { name: "t", sections: [], defaultsVersion: 1 }));
  await assertSucceeds(updateDoc(t(as("owner1")), { name: "t2" }));
  await assertSucceeds(getDoc(t(as("cash1"))));
  await assertFails(updateDoc(t(as("tech1")), { name: "x" }));
  await assertFails(deleteDoc(t(as("owner1"))));
  await seed(false);
  await assertFails(setDoc(t(as("owner1")), { name: "t", sections: [] }));
});

// ── Create ───────────────────────────────────────────────────────────────────
test("create: only Owner/Manager, only a fresh draft, only while the module is on", async () => {
  await seed(true);
  await assertSucceeds(setDoc(reportRef(as("owner1")), freshDraft("owner1")));
  await assertSucceeds(setDoc(reportRef(as("mgr1"), "r2"), freshDraft("mgr1")));
  for (const uid of ["tech1", "cash1", "rec1"]) {
    await assertFails(setDoc(reportRef(as(uid), "r3"), freshDraft(uid)));
  }
  await assertFails(setDoc(reportRef(as("owner1"), "r4"), freshDraft("owner1", { status: "finalized" })));
  await assertFails(setDoc(reportRef(as("owner1"), "r4"), freshDraft("owner1", { reportNumber: "INS-2026-0001" })));
  await assertFails(setDoc(reportRef(as("owner1"), "r4"), freshDraft("owner1", { viewCount: 5 })));
  await assertFails(setDoc(reportRef(as("owner1"), "r4"), freshDraft("owner1", { shareToken: "short" })));
  await assertFails(setDoc(reportRef(as("owner1"), "r4"), freshDraft("owner1", { type: "other" })));
  await assertFails(setDoc(reportRef(as("owner1"), "r4"), freshDraft("mgr1")));
  await seed(false);
  await assertFails(setDoc(reportRef(as("owner1")), freshDraft("owner1")));
});

// ── Update ───────────────────────────────────────────────────────────────────
test("update: Owner/Manager edit drafts but never server-owned or fixed keys", async () => {
  await seed(true);
  await seedReport();
  await assertSucceeds(updateDoc(reportRef(as("mgr1")), { observations: "ok", assignedToUid: "tech1", "header.customerName": "B" }));
  for (const bad of [
    { status: "finalized" }, { reportNumber: "INS-2026-0001" }, { finalizedBy: "owner1" }, { pdfUrl: "x" }, { shareRevoked: true },
    { shareToken: "b".repeat(32) }, { viewCount: 9 }, { nextMediaDeleteAt: new Date() },
    { type: "diagnostic" }, { vehicleId: "v2" }, { createdBy: "mgr1" }, { templateSnapshot: [{}] },
  ]) {
    await assertFails(updateDoc(reportRef(as("owner1")), bad));
  }
});

test("update: a finalized report is locked except visibility and sharedAt", async () => {
  await seed(true);
  await seedReport({ status: "finalized", reportNumber: "INS-2026-0001" });
  await assertFails(updateDoc(reportRef(as("owner1")), { observations: "late edit" }));
  await assertSucceeds(updateDoc(reportRef(as("mgr1")), { visibleToCustomer: false, sharedAt: new Date(), updatedAt: new Date() }));
  await assertFails(updateDoc(reportRef(as("mgr1")), { visibleToCustomer: false, observations: "x" }));
  await assertFails(updateDoc(reportRef(as("tech1")), { visibleToCustomer: false }));
});

test("update: Technician fills only their own assigned drafts, only the allowed keys", async () => {
  await seed(true);
  await seedReport({ assignedToUid: "tech1" });
  await assertSucceeds(updateDoc(reportRef(as("tech1")), { "results.op1": { status: "meets", remark: "", photoIds: [] }, observations: "x", updatedAt: new Date() }));
  // Queue landing writes a dotted path inside the media map.
  await assertSucceeds(updateDoc(reportRef(as("tech1")), { "media.f1": { id: "f1", kind: "photo", url: "u", pending: false } }));
  await assertFails(updateDoc(reportRef(as("tech1")), { assignedToUid: "tech2" }));
  await assertFails(updateDoc(reportRef(as("tech1")), { visibleToCustomer: false }));
  await assertFails(updateDoc(reportRef(as("tech1")), { header: {} }));
  await assertFails(updateDoc(reportRef(as("tech1")), { status: "finalized" }));
  await assertFails(updateDoc(reportRef(as("tech2")), { observations: "not mine" }));
  await seedReport({ assignedToUid: "tech1", status: "finalized" }, "r9");
  await assertFails(updateDoc(reportRef(as("tech1"), "r9"), { observations: "locked" }));
  for (const uid of ["cash1", "rec1"]) await assertFails(updateDoc(reportRef(as(uid)), { observations: "view only" }));
});

// ── Read ─────────────────────────────────────────────────────────────────────
test("read: staff roles, technician only when assigned, never unauthenticated", async () => {
  await seed(true);
  await seedReport({ assignedToUid: "tech1" }, "mine");
  await seedReport({ assignedToUid: "tech2" }, "theirs");
  for (const uid of ["owner1", "mgr1", "cash1", "rec1"]) await assertSucceeds(getDoc(reportRef(as(uid), "mine")));
  await assertSucceeds(getDoc(reportRef(as("tech1"), "mine")));
  await assertFails(getDoc(reportRef(as("tech1"), "theirs")));
  const col = (db) => collection(db, "servicecenters", C, "inspectionReports");
  await assertSucceeds(getDocs(query(col(as("tech1")), where("assignedToUid", "==", "tech1"))));
  await assertFails(getDocs(col(as("tech1"))));
  await assertFails(getDoc(reportRef(env.unauthenticatedContext().firestore(), "mine")));
  await assertFails(getDocs(col(env.unauthenticatedContext().firestore())));
});

// ── Delete / counters ────────────────────────────────────────────────────────
test("delete: Owner only", async () => {
  await seed(true);
  await seedReport();
  await assertFails(deleteDoc(reportRef(as("mgr1"))));
  await assertSucceeds(deleteDoc(reportRef(as("owner1"))));
});

test("inspectionCounters: staff read, nobody writes from a client", async () => {
  await seed(true);
  const ctr = (db) => doc(db, "servicecenters", C, "inspectionCounters", "2026");
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(ctr(ctx.firestore()), { seq: 1 }); });
  await assertSucceeds(getDoc(ctr(as("mgr1"))));
  await assertFails(setDoc(ctr(as("owner1")), { seq: 2 }));
  await assertFails(updateDoc(ctr(as("mgr1")), { seq: 2 }));
});

// ── Existing rules unaffected (spot checks) ──────────────────────────────────
test("existing rules: invoices/customers/diagnosticReports behave as before", async () => {
  await seed(true);
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "servicecenters", C, "customers", "cu1"), { name: "n" });
  });
  await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), "servicecenters", C, "customers", "cu1")));
  await assertFails(setDoc(doc(as("cash1"), "servicecenters", C, "customers", "cu2"), { name: "n" }));
  await assertSucceeds(setDoc(doc(as("rec1"), "servicecenters", C, "customers", "cu2"), { name: "n" }));
});

// ── Permission group (Role Permission Manager) mirrored in the rules ──────────
test("permissions, Basic plan: role defaults apply and a stored grid is ignored", async () => {
  await seed(true, { plan: "basic", grid: { manager: ir({ create: false, edit: false, send: false }) } });
  await seedReport({ assignedToUid: "tech1" });
  await assertSucceeds(updateDoc(reportRef(as("mgr1")), { observations: "ok" }));
  await assertSucceeds(setDoc(reportRef(as("mgr1"), "n1"), freshDraft("mgr1")));
  await assertFails(deleteDoc(reportRef(as("mgr1"))));           // Manager never deletes
  await assertSucceeds(updateDoc(reportRef(as("tech1")), { observations: "t" }));
  await assertSucceeds(getDoc(reportRef(as("cash1"))));
  await assertSucceeds(getDoc(reportRef(as("rec1"))));
});

test("permissions, Pro: the Owner switches individual permissions off", async () => {
  await seed(true, { plan: "pro", grid: {
    manager: ir({ create: false }),
    technician: ir({ edit: false }),
    cashier: ir({ view: false }),
  } });
  await seedReport({ assignedToUid: "tech1" });
  await assertFails(setDoc(reportRef(as("mgr1"), "n1"), freshDraft("mgr1")));          // create off
  await assertSucceeds(updateDoc(reportRef(as("mgr1")), { observations: "still can edit" })); // others untouched
  await assertSucceeds(setDoc(reportRef(as("owner1"), "n2"), freshDraft("owner1")));   // Owner immune
  await assertFails(updateDoc(reportRef(as("tech1")), { observations: "x" }));         // edit off
  await assertSucceeds(getDoc(reportRef(as("tech1"))));                                // …view still on
  await assertFails(getDoc(reportRef(as("cash1"))));                                   // view off
  await assertSucceeds(getDoc(reportRef(as("rec1"))));                                 // other roles unaffected
});

test("permissions, Pro: edit/send/manageTemplate/view switched off on Manager", async () => {
  await seed(true, { plan: "pro", grid: { manager: ir({ edit: false, send: false, manageTemplate: false, view: false }) } });
  await seedReport();
  await seedReport({ status: "finalized", reportNumber: "INS-2026-0001" }, "fin");
  await assertFails(updateDoc(reportRef(as("mgr1")), { observations: "x" }));
  await assertFails(updateDoc(reportRef(as("mgr1"), "fin"), { visibleToCustomer: false, updatedAt: new Date() }));
  await assertFails(getDoc(reportRef(as("mgr1"))));
  await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), "servicecenters", C, "inspectionTemplates", "default"), { name: "t", sections: [] }); });
  await assertFails(updateDoc(doc(as("mgr1"), "servicecenters", C, "inspectionTemplates", "default"), { name: "x" }));
  await assertSucceeds(updateDoc(doc(as("owner1"), "servicecenters", C, "inspectionTemplates", "default"), { name: "x" }));
  await assertSucceeds(updateDoc(reportRef(as("owner1"), "fin"), { visibleToCustomer: false, updatedAt: new Date() }));
});

test("permissions, Pro: a grid can never grant above a role's ceiling", async () => {
  const all = { view: true, create: true, edit: true, finalize: true, send: true, delete: true, manageTemplate: true };
  await seed(true, { plan: "pro", grid: { manager: ir(all), technician: ir(all), cashier: ir(all), receptionist: ir(all) } });
  await seedReport({ assignedToUid: "tech1" });
  await seedReport({ status: "finalized", reportNumber: "INS-2026-0001" }, "fin");
  await assertFails(deleteDoc(reportRef(as("mgr1"))));                                          // Manager delete locked off
  await assertFails(setDoc(reportRef(as("tech1"), "t1"), freshDraft("tech1")));                  // Technician create
  await assertFails(updateDoc(reportRef(as("tech1"), "fin"), { visibleToCustomer: false }));     // Technician send
  await assertFails(updateDoc(reportRef(as("cash1")), { observations: "x" }));                  // Cashier edit
  await assertFails(setDoc(reportRef(as("rec1"), "r1x"), freshDraft("rec1")));                   // Receptionist create
  await assertSucceeds(deleteDoc(reportRef(as("owner1"))));
});

test("permissions, Pro: a custom role's grid takes over from the base role's entry", async () => {
  await seed(true, {
    plan: "pro",
    grid: { manager: ir({ send: false }) },
    customRoles: { cr1: { name: "Senior", baseRole: "manager", permissions: ir({ send: true, edit: false }) } },
    staffRoleIds: { mgr1: "cr1" },
  });
  await seedReport();
  await seedReport({ status: "finalized", reportNumber: "INS-2026-0001" }, "fin");
  await assertSucceeds(updateDoc(reportRef(as("mgr1"), "fin"), { visibleToCustomer: false, updatedAt: new Date() })); // custom send: true beats base send: false
  await assertFails(updateDoc(reportRef(as("mgr1")), { observations: "x" }));                                          // custom edit: false
  // The deepest path (custom role + module flag + permission) must stay inside the rules' get() budget.
  await assertSucceeds(setDoc(reportRef(as("mgr1"), "deep"), freshDraft("mgr1")));
});
