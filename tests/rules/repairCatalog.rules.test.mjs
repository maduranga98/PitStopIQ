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
import { writeBatch, doc, getDoc, setDoc, updateDoc, deleteDoc } from "firebase/firestore";

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

// ── The flag is owner-controlled, like bayWorkflowEnabled ────────────────────
test("flag: Owner and Manager can switch repairCatalogEnabled on and off", async () => {
  for (const uid of ["owner1", "mgr1"]) {
    await seed(false);
    await assertSucceeds(updateDoc(centerRef(as(uid)), { repairCatalogEnabled: true }));
    await assertSucceeds(updateDoc(centerRef(as(uid)), { repairCatalogEnabled: false }));
    // Bundled with another allowed field.
    await assertSucceeds(updateDoc(centerRef(as(uid)), { name: "N", repairCatalogEnabled: true }));
  }
});

test("flag: Technician, Cashier, Receptionist and strangers cannot change it", async () => {
  for (const uid of ["tech1", "cash1", "rec1", "stranger"]) {
    await seed(false);
    await assertFails(updateDoc(centerRef(as(uid)), { repairCatalogEnabled: true }));
    await seed(true);
    await assertFails(updateDoc(centerRef(as(uid)), { repairCatalogEnabled: false }));
  }
});

test("flag: super admin can still set it; ordinary center fields and repairCategories are unchanged", async () => {
  await seed(false);
  await assertSucceeds(updateDoc(centerRef(as("admin1")), { repairCatalogEnabled: true }));
  await assertSucceeds(updateDoc(centerRef(as("owner1")), { name: "New" }));
  await assertSucceeds(updateDoc(centerRef(as("mgr1")), { repairCategories: ["Engine", "Brakes"] }));
});

test("flag: Owner/Manager still cannot touch the protected billing fields, even alongside the flag", async () => {
  await seed(false);
  await assertFails(updateDoc(centerRef(as("owner1")), { repairCatalogEnabled: true, plan: "basic" }));
  await assertFails(updateDoc(centerRef(as("mgr1")), { repairCatalogEnabled: true, smsQuotaLimit: 99999 }));
});

test("flag: create is unchanged — a center registers itself, with or without the field", async () => {
  await env.clearFirestore();
  await assertSucceeds(setDoc(doc(as("newowner"), "servicecenters", "newowner"), { name: "X" }));
  await assertFails(setDoc(doc(as("someone"), "servicecenters", "other"), { name: "Y" }));
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

test("category rename batch (center doc + repairs): Owner/Manager succeed; Receptionist/Technician cannot", async () => {
  await seed(true);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "servicecenters", C, "repairCatalog", "r1"), { name: "Pads", category: "Brakes" });
    await setDoc(doc(db, "servicecenters", C, "repairCatalog", "r2"), { name: "Oil", category: "Brakes" });
  });
  const rename = (uid) => {
    const db = as(uid);
    const batch = writeBatch(db);
    batch.update(doc(db, "servicecenters", C), { repairCategories: ["Braking"] });
    for (const id of ["r1", "r2"]) {
      batch.update(doc(db, "servicecenters", C, "repairCatalog", id), { category: "Braking", updatedAt: new Date(), updatedBy: uid, updatedByName: "X" });
    }
    return batch.commit();
  };
  await assertSucceeds(rename("mgr1"));
  await assertSucceeds(rename("owner1"));
  for (const uid of ["rec1", "tech1", "cash1"]) await assertFails(rename(uid));
});

// ── Phase 5: inventory compatibility and item <-> repair links ──────────────
test("phase 5: compatibility is Owner/Manager-only, in single and batched writes; stock moves are unchanged", async () => {
  await seed(true);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const id of ["i1", "i2"]) await setDoc(doc(db, "servicecenters", C, "inventory", id), { name: id, currentQty: 5 });
  });
  const compat = { universal: false, types: ["car"], groupIds: [], modelIds: ["m1"] };
  const inv = (uid, id) => doc(as(uid), "servicecenters", C, "inventory", id);

  // Owner and Manager set it, replace it, and remove it again (single doc).
  for (const uid of ["owner1", "mgr1"]) {
    await assertSucceeds(updateDoc(inv(uid, "i1"), { compatibility: compat, updatedAt: new Date() }));
    await assertSucceeds(updateDoc(inv(uid, "i1"), { compatibility: { universal: true, types: [], groupIds: [], modelIds: [] }, updatedAt: new Date() }));
  }
  // The bulk action: one batch, several items, the same fixed value.
  const db = as("mgr1");
  const batch = writeBatch(db);
  for (const id of ["i1", "i2"]) batch.update(doc(db, "servicecenters", C, "inventory", id), { compatibility: compat, updatedAt: new Date() });
  await assertSucceeds(batch.commit());

  // Nobody else can, in a single write or inside a batch. (A value different
  // from what is stored: an unchanged field is not part of the diff at all.)
  const other = { universal: false, types: ["van"], groupIds: ["g1"], modelIds: [] };
  for (const uid of ["tech1", "cash1", "rec1"]) {
    await assertFails(updateDoc(inv(uid, "i1"), { compatibility: other, updatedAt: new Date() }));
    await assertFails(updateDoc(inv(uid, "i1"), { currentQty: 4, compatibility: other, updatedAt: new Date() }));
    const fdb = as(uid);
    const b = writeBatch(fdb);
    b.update(doc(fdb, "servicecenters", C, "inventory", "i2"), { compatibility: other, updatedAt: new Date() });
    await assertFails(b.commit());
  }
  // Their existing stock-only update still works, so nothing was narrowed.
  for (const uid of ["tech1", "cash1"]) {
    await assertSucceeds(updateDoc(inv(uid, "i2"), { currentQty: 3, updatedAt: new Date() }));
  }
  // Read access is not widened.
  await assertFails(getDoc(inv("rec1", "i1")));
  await assertSucceeds(getDoc(inv("cash1", "i1")));
});

test("phase 5: linking a part writes the repair doc, and only Owner/Manager can", async () => {
  await seed(true);
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "servicecenters", C, "repairCatalog", "r1"), {
      name: "Oil change", suggestedParts: [{ inventoryItemId: "i1", defaultQty: 1 }],
    });
  });
  const repair = (uid) => doc(as(uid), "servicecenters", C, "repairCatalog", "r1");
  const next = {
    suggestedParts: [{ inventoryItemId: "i1", defaultQty: 1 }, { inventoryItemId: "i2", defaultQty: 2 }],
    updatedAt: new Date(), updatedBy: "mgr1", updatedByName: "M",
  };
  await assertSucceeds(updateDoc(repair("mgr1"), next));
  // Removing one entry is the same kind of write.
  await assertSucceeds(updateDoc(repair("owner1"), { suggestedParts: [{ inventoryItemId: "i2", defaultQty: 2 }], updatedAt: new Date() }));
  for (const uid of ["tech1", "cash1", "rec1"]) {
    await assertFails(updateDoc(repair(uid), next));
    // They can still read it, which is what the read-only "Used for repairs" list needs.
    await assertSucceeds(getDoc(repair(uid)));
  }
});
