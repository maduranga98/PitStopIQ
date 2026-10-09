// Firestore security-rules tests for the Repair Catalog module.
//
// Not part of `npm test` (needs the Firestore emulator + Java). Same harness as
// inspectionReports.rules.test.mjs:
//
//   npx firebase emulators:exec --only firestore --project demo-test \
//     "node --test tests/rules/repairCatalog.rules.test.mjs"
import { test, before, after } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where } from "firebase/firestore";

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
const as = (uid) => env.authenticatedContext(uid).firestore();
const centerRef = (db) => doc(db, "servicecenters", C);

async function seed(flag = false) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(centerRef(db), { name: "C", plan: "pro", ownerUid: "owner1", ...(flag ? { repairCatalogEnabled: true } : {}) });
    await setDoc(doc(db, "superadmins", "admin1"), { createdAt: new Date() });
    for (const [uid, role] of Object.entries(ROLES)) {
      await setDoc(doc(db, "servicecenters", C, "staff", uid), { role });
    }
  });
}

// ── The flag is super-admin only ─────────────────────────────────────────────
test("flag: neither Owner nor Manager can set or change repairCatalogEnabled or its audit fields", async () => {
  for (const uid of ["owner1", "mgr1"]) {
    await seed(false);
    await assertFails(updateDoc(centerRef(as(uid)), { repairCatalogEnabled: true }));
    await assertFails(updateDoc(centerRef(as(uid)), { repairCatalogToggledAt: new Date() }));
    await assertFails(updateDoc(centerRef(as(uid)), { repairCatalogToggledBy: "x" }));
    await assertFails(updateDoc(centerRef(as(uid)), { repairCatalogToggledByName: "x" }));
    // Bundled with an allowed field: the whole write is rejected.
    await assertFails(updateDoc(centerRef(as(uid)), { name: "N", repairCatalogEnabled: true }));
    // Cannot turn it off either.
    await seed(true);
    await assertFails(updateDoc(centerRef(as(uid)), { repairCatalogEnabled: false }));
  }
});

test("flag: Owner/Manager can still write ordinary center fields and repairCategories", async () => {
  await seed(false);
  await assertSucceeds(updateDoc(centerRef(as("owner1")), { name: "New" }));
  await assertSucceeds(updateDoc(centerRef(as("mgr1")), { repairCategories: ["Engine", "Brakes"] }));
});

test("flag: super admin can set it and the audit fields", async () => {
  await seed(false);
  await assertSucceeds(updateDoc(centerRef(as("admin1")), {
    repairCatalogEnabled: true, repairCatalogToggledAt: new Date(),
    repairCatalogToggledBy: "admin1", repairCatalogToggledByName: "Admin",
  }));
});

test("flag: a center cannot create its own doc with the flag; without it create is unchanged", async () => {
  await env.clearFirestore();
  await assertFails(setDoc(doc(as("newowner"), "servicecenters", "newowner"), { name: "X", repairCatalogEnabled: true }));
  await assertFails(setDoc(doc(as("newowner"), "servicecenters", "newowner"), { name: "X", repairCatalogEnabled: false }));
  await assertSucceeds(setDoc(doc(as("newowner"), "servicecenters", "newowner"), { name: "X" }));
  // The super admin may still create a center with the flag set.
  await seed(false);
  await assertSucceeds(setDoc(doc(as("admin1"), "servicecenters", "other"), { name: "Y", repairCatalogEnabled: true }));
});

// ── Catalog collections ──────────────────────────────────────────────────────
for (const col of ["vehicleModels", "vehicleGroups", "repairCatalog"]) {
  test(`${col}: every staff role reads (Receptionist included); strangers cannot`, async () => {
    await seed(true);
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "servicecenters", C, col, "a"), { name: "A" });
    });
    for (const uid of Object.keys(ROLES)) {
      await assertSucceeds(getDoc(doc(as(uid), "servicecenters", C, col, "a")));
    }
    await assertSucceeds(getDoc(doc(as("admin1"), "servicecenters", C, col, "a")));
    await assertFails(getDoc(doc(as("stranger"), "servicecenters", C, col, "a")));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "servicecenters", C, col, "a")));
  });

  test(`${col}: only Owner/Manager write`, async () => {
    await seed(true);
    for (const uid of ["owner1", "mgr1"]) {
      await assertSucceeds(setDoc(doc(as(uid), "servicecenters", C, col, uid), { name: "A" }));
      await assertSucceeds(updateDoc(doc(as(uid), "servicecenters", C, col, uid), { name: "B" }));
      await assertSucceeds(deleteDoc(doc(as(uid), "servicecenters", C, col, uid)));
    }
    for (const uid of ["tech1", "cash1", "rec1", "stranger"]) {
      await assertFails(setDoc(doc(as(uid), "servicecenters", C, col, "x"), { name: "A" }));
    }
  });
}

// ── adminActionLog ───────────────────────────────────────────────────────────
test("adminActionLog: super admin appends; nobody updates or deletes; centers cannot read or write", async () => {
  await seed(false);
  const entry = { action: "repairCatalog.enable", centerId: C, performedBy: "admin1", createdAt: new Date() };
  await assertSucceeds(setDoc(doc(as("admin1"), "adminActionLog", "e1"), entry));
  await assertSucceeds(addDoc(collection(as("admin1"), "adminActionLog"), entry));
  // Must be stamped with the writer's own uid.
  await assertFails(setDoc(doc(as("admin1"), "adminActionLog", "e2"), { ...entry, performedBy: "someoneElse" }));
  await assertFails(updateDoc(doc(as("admin1"), "adminActionLog", "e1"), { action: "x" }));
  await assertFails(deleteDoc(doc(as("admin1"), "adminActionLog", "e1")));
  await assertSucceeds(getDoc(doc(as("admin1"), "adminActionLog", "e1")));
  for (const uid of ["owner1", "mgr1", "tech1"]) {
    await assertFails(setDoc(doc(as(uid), "adminActionLog", "z"), { ...entry, performedBy: uid }));
    await assertFails(getDoc(doc(as(uid), "adminActionLog", "e1")));
  }
});

// ── No regression on existing job / invoice / inventory writes ───────────────
test("regression: job, vehicle and inventory writes carrying the new optional fields follow existing rules", async () => {
  await seed(true);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "servicecenters", C, "jobs", "j1"), { status: "pending", partsUsed: [] });
    await setDoc(doc(db, "servicecenters", C, "vehicles", "v1"), { plateNumber: "A" });
    await setDoc(doc(db, "servicecenters", C, "inventory", "i1"), { name: "P", currentQty: 5 });
  });
  const repairs = { repairsPerformed: [{ repairItemId: "r", name: "n", price: 1, custom: false, resolvedFrom: "default" }] };
  for (const uid of ["owner1", "mgr1", "rec1", "tech1"]) {
    await assertSucceeds(updateDoc(doc(as(uid), "servicecenters", C, "jobs", "j1"), repairs));
  }
  // Cashier keeps its narrow whitelist: cannot add or change repairs. (A
  // different value, since an unchanged field is not a write at all.)
  const changed = { repairsPerformed: [{ ...repairs.repairsPerformed[0], price: 2 }] };
  await assertFails(updateDoc(doc(as("cash1"), "servicecenters", C, "jobs", "j1"), changed));
  await assertSucceeds(updateDoc(doc(as("rec1"), "servicecenters", C, "vehicles", "v1"), { modelId: "m1" }));
  await assertFails(updateDoc(doc(as("tech1"), "servicecenters", C, "vehicles", "v1"), { modelId: "m1" }));
  const compat = { compatibility: { universal: false, types: [], groupIds: [], modelIds: ["m1"] } };
  await assertSucceeds(updateDoc(doc(as("mgr1"), "servicecenters", C, "inventory", "i1"), compat));
  await assertFails(updateDoc(doc(as("tech1"), "servicecenters", C, "inventory", "i1"),
    { compatibility: { universal: true, types: [], groupIds: [], modelIds: [] } }));
  // Inventory read access is NOT widened: Receptionist still cannot read it.
  await assertFails(getDoc(doc(as("rec1"), "servicecenters", C, "inventory", "i1")));
  await assertSucceeds(getDoc(doc(as("tech1"), "servicecenters", C, "inventory", "i1")));
});

test("adminActionLog: READ is super admin only (get and list), for every center role and signed-out users", async () => {
  await seed(false);
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "adminActionLog", "e1"), { action: "repairCatalog.enable", centerId: C, performedBy: "admin1" });
  });
  const roleUids = ["owner1", "mgr1", "tech1", "cash1", "rec1", "stranger"];
  for (const uid of roleUids) {
    await assertFails(getDoc(doc(as(uid), "adminActionLog", "e1")));
    await assertFails(getDocs(collection(as(uid), "adminActionLog")));
    // Even scoped to the center's own entries.
    await assertFails(getDocs(query(collection(as(uid), "adminActionLog"), where("centerId", "==", C))));
  }
  const anon = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(anon, "adminActionLog", "e1")));
  await assertFails(getDocs(collection(anon, "adminActionLog")));
  await assertSucceeds(getDoc(doc(as("admin1"), "adminActionLog", "e1")));
  await assertSucceeds(getDocs(collection(as("admin1"), "adminActionLog")));
});
