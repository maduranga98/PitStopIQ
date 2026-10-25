// Rules tests for the job card's finance freeze: once `financeFinalized` is set,
// status can only move done -> delivered and the technicians are fixed. Also
// covers delivery no longer being gated on the post-service checklist.
//   npx firebase emulators:exec --only firestore --project demo-test "node --test tests/rules/financeFreeze.rules.test.mjs"
import { test, before, after, beforeEach } from "node:test";
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

const ROLES = { owner1: "Owner", mgr1: "Manager", cash1: "Cashier" };
const as = (uid) => env.authenticatedContext(uid).firestore();
const jobRef = (db) => doc(db, "servicecenters", C, "jobs", "j1");

async function seedJob(extra) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(jobRef(ctx.firestore()), {
      status: "done", partsUsed: [], technicianId: "t1", technicianName: "T", technicianIds: ["t1"], technicianNames: ["T"], ...extra,
    });
  });
}

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "servicecenters", C), { name: "C", plan: "pro", postServiceChecklistEnabled: true, ownerUid: "owner1" });
    for (const [uid, role] of Object.entries(ROLES)) await setDoc(doc(db, "servicecenters", C, "staff", uid), { role });
  });
});

test("a finalized job can still be delivered, but not reverted or re-assigned", async () => {
  await seedJob({ financeFinalized: true });
  await assertFails(updateDoc(jobRef(as("owner1")), { status: "in_progress" }));
  await assertFails(updateDoc(jobRef(as("mgr1")), { technicianId: "t2", technicianName: "U", technicianIds: ["t2"], technicianNames: ["U"] }));
  await assertFails(updateDoc(jobRef(as("mgr1")), { financeFinalized: false }));
  await assertSucceeds(updateDoc(jobRef(as("mgr1")), { status: "delivered" }));
});

test("an un-finalized job stays editable", async () => {
  await seedJob({});
  await assertSucceeds(updateDoc(jobRef(as("owner1")), { technicianId: "t2", technicianIds: ["t2"] }));
  await assertSucceeds(updateDoc(jobRef(as("owner1")), { status: "in_progress" }));
});

test("a Cashier can set financeFinalized, and cannot unset it", async () => {
  await seedJob({});
  await assertSucceeds(updateDoc(jobRef(as("cash1")), { financeFinalized: true }));
  await assertFails(updateDoc(jobRef(as("cash1")), { financeFinalized: false }));
});

test("delivery is no longer blocked by an unsigned post-service checklist", async () => {
  await seedJob({});
  await assertSucceeds(updateDoc(jobRef(as("mgr1")), { status: "delivered" }));
});
