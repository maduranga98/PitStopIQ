// Firestore security-rules tests for caller accounts and the packages price list.
//
// Not part of `npm test` (needs the Firestore emulator + Java). Same harness as
// repairCatalog.rules.test.mjs:
//
//   npx firebase emulators:exec --only firestore --project demo-test \
//     "node --test tests/rules/callers.rules.test.mjs"
import { test, before, after } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection } from "firebase/firestore";

const RULES = process.env.RULES_PATH ?? new URL("../../firestore.rules", import.meta.url).pathname;
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-test",
    firestore: { rules: readFileSync(RULES, "utf8"), host: "127.0.0.1", port: Number(process.env.FIRESTORE_EMULATOR_PORT ?? 8085) },
  });
});
after(async () => { await env.cleanup(); });

const as = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

const callerDoc = (name, isActive = true) => ({
  name, email: `${name}@example.com`, phone: "0771234567", isActive,
  createdAt: new Date(), createdBy: "admin1", createdByName: "Admin",
});

async function seed() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "superadmins", "admin1"), { createdAt: new Date() });
    await setDoc(doc(db, "callers", "caller1"), callerDoc("one"));
    await setDoc(doc(db, "callers", "caller2"), callerDoc("two"));
    await setDoc(doc(db, "callers", "gone"), callerDoc("gone", false));
    await setDoc(doc(db, "packages", "basic"), { name: "Basic", price: 4999, commissionRate: 0.2 });
    await setDoc(doc(db, "packages", "pro"), { name: "Pro", price: 7999, commissionRate: 0.2 });
    // A service-center owner, to prove tenants are locked out.
    await setDoc(doc(db, "servicecenters", "c1"), { name: "C", ownerUid: "owner1" });
    await setDoc(doc(db, "servicecenters", "c1", "staff", "owner1"), { role: "Owner" });
  });
}

// ── callers ──────────────────────────────────────────────────────────────────
test("callers: super admin can create, read, list, toggle isActive and delete", async () => {
  await seed();
  const db = as("admin1");
  await assertSucceeds(setDoc(doc(db, "callers", "new1"), callerDoc("new")));
  await assertSucceeds(getDoc(doc(db, "callers", "caller1")));
  await assertSucceeds(getDocs(collection(db, "callers")));
  await assertSucceeds(updateDoc(doc(db, "callers", "caller1"), { isActive: false }));
  await assertSucceeds(deleteDoc(doc(db, "callers", "caller2")));
});

test("callers: a caller reads only their own doc", async () => {
  await seed();
  const db = as("caller1");
  await assertSucceeds(getDoc(doc(db, "callers", "caller1")));
  await assertFails(getDoc(doc(db, "callers", "caller2")));
  await assertFails(getDocs(collection(db, "callers")));
});

test("callers: a deactivated caller can still read their own doc", async () => {
  await seed();
  await assertSucceeds(getDoc(doc(as("gone"), "callers", "gone")));
});

test("callers: a caller cannot write their own doc or any other", async () => {
  await seed();
  const db = as("caller1");
  await assertFails(updateDoc(doc(db, "callers", "caller1"), { name: "Renamed" }));
  await assertFails(updateDoc(doc(db, "callers", "caller1"), { isActive: false }));
  await assertFails(updateDoc(doc(db, "callers", "caller2"), { isActive: false }));
  await assertFails(setDoc(doc(db, "callers", "caller3"), callerDoc("three")));
  await assertFails(deleteDoc(doc(db, "callers", "caller1")));
});

test("callers: a deactivated caller cannot reactivate themselves", async () => {
  await seed();
  await assertFails(updateDoc(doc(as("gone"), "callers", "gone"), { isActive: true }));
});

test("callers: service-center owners, strangers and anonymous users are locked out", async () => {
  await seed();
  for (const db of [as("owner1"), as("stranger"), anon()]) {
    await assertFails(getDoc(doc(db, "callers", "caller1")));
    await assertFails(getDocs(collection(db, "callers")));
    await assertFails(setDoc(doc(db, "callers", "x"), callerDoc("x")));
    await assertFails(updateDoc(doc(db, "callers", "caller1"), { isActive: false }));
  }
});

// ── packages ─────────────────────────────────────────────────────────────────
test("packages: super admin and an active caller can read", async () => {
  await seed();
  for (const uid of ["admin1", "caller1"]) {
    await assertSucceeds(getDoc(doc(as(uid), "packages", "basic")));
    await assertSucceeds(getDocs(collection(as(uid), "packages")));
  }
});

test("packages: a deactivated caller, service-center owners and anonymous users cannot read", async () => {
  await seed();
  for (const db of [as("gone"), as("owner1"), as("stranger"), anon()]) {
    await assertFails(getDoc(doc(db, "packages", "basic")));
    await assertFails(getDocs(collection(db, "packages")));
  }
});

test("packages: nobody can write, not even a super admin", async () => {
  await seed();
  for (const uid of ["admin1", "caller1", "owner1"]) {
    const db = as(uid);
    await assertFails(updateDoc(doc(db, "packages", "basic"), { price: 1 }));
    await assertFails(setDoc(doc(db, "packages", "gold"), { name: "Gold", price: 1, commissionRate: 1 }));
    await assertFails(deleteDoc(doc(db, "packages", "pro")));
  }
  await assertFails(updateDoc(doc(anon(), "packages", "basic"), { price: 1 }));
});

// ── isCaller() ───────────────────────────────────────────────────────────────
test("isCaller: a user with no callers doc gets no caller access", async () => {
  await seed();
  await assertFails(getDoc(doc(as("stranger"), "packages", "pro")));
});
