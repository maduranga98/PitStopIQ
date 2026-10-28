// Firestore security-rules tests for the sales pipeline: caller-scoped access,
// the stageHistory contract and the commission/payout fields on `leads`.
//
// Not part of `npm test` (needs the Firestore emulator + Java):
//
//   npx firebase emulators:exec --only firestore --project demo-test \
//     "node --test tests/rules/leads.rules.test.mjs"
import { test, before, after } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where,
  writeBatch, arrayUnion, Timestamp,
} from "firebase/firestore";

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
const lead = (db, id = "L1") => doc(db, "leads", id);
const entry = (from, to, byUid) => ({ from, to, byUid, byName: "N", at: Timestamp.now() });

const baseLead = (over = {}) => ({
  businessName: "Garage", contactName: "Owner", phone: "0771234567", stage: "called",
  callCount: 1, tags: [], closedAmount: 0, isDeleted: false,
  assignedTo: "caller1", assignedToName: "One", assignedAt: Timestamp.now(), assignedBy: "admin1",
  packageId: null, commissionAmount: null, paymentConfirmed: false, payoutStatus: null, payoutWeek: null,
  stageHistory: [], createdAt: Timestamp.now(), updatedAt: Timestamp.now(), ...over,
});

async function seed(leadOver = {}, { legacy = false } = {}) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "superadmins", "admin1"), { createdAt: new Date() });
    await setDoc(doc(db, "callers", "caller1"), { name: "One", isActive: true });
    await setDoc(doc(db, "callers", "caller2"), { name: "Two", isActive: true });
    await setDoc(doc(db, "callers", "gone"), { name: "Gone", isActive: false });
    await setDoc(doc(db, "packages", "basic"), { name: "Basic", price: 4999, commissionRate: 0.2 });
    await setDoc(doc(db, "packages", "pro"), { name: "Pro", price: 7999, commissionRate: 0.2 });
    // A lead from before callers existed carries none of the new fields.
    const data = legacy
      ? { businessName: "Old", phone: "0770000000", stage: "new", createdAt: Timestamp.now(), updatedAt: Timestamp.now() }
      : baseLead(leadOver);
    await setDoc(lead(db), data);
    await setDoc(lead(db, "L2"), baseLead({ assignedTo: "caller2" }));
    await setDoc(doc(db, "leads", "L1", "calls", "c1"), { outcome: "note", createdBy: "caller1" });
    await setDoc(doc(db, "leads", "L1", "notes", "n1"), { text: "x", createdBy: "caller1" });
    await setDoc(doc(db, "leads", "L1", "notes", "n2"), { text: "y", createdBy: "admin1" });
  });
}

// ── Caller: read scope ───────────────────────────────────────────────────────
test("caller: reads and queries only their own leads", async () => {
  await seed();
  const db = as("caller1");
  await assertSucceeds(getDoc(lead(db, "L1")));
  await assertFails(getDoc(lead(db, "L2")));
  await assertSucceeds(getDocs(query(collection(db, "leads"), where("assignedTo", "==", "caller1"))));
  await assertFails(getDocs(collection(db, "leads")));
  await assertFails(getDocs(query(collection(db, "leads"), where("assignedTo", "==", "caller2"))));
});

test("caller: cannot see an unassigned or legacy lead", async () => {
  await seed({}, { legacy: true });
  await assertFails(getDoc(lead(as("caller1"))));
});

test("caller: a deactivated caller loses access to their leads", async () => {
  await seed({ assignedTo: "gone" });
  await assertFails(getDoc(lead(as("gone"))));
  await assertFails(updateDoc(lead(as("gone")), { stage: "no_answer", stageHistory: arrayUnion(entry("called", "no_answer", "gone")) }));
});

test("caller: service-center owners and strangers cannot read leads", async () => {
  await seed();
  await assertFails(getDoc(lead(as("stranger"))));
});

// ── Caller: create / delete / protected fields ───────────────────────────────
test("caller: cannot create or delete a lead", async () => {
  await seed();
  const db = as("caller1");
  await assertFails(setDoc(doc(db, "leads", "new"), baseLead()));
  await assertFails(deleteDoc(lead(db)));
});

test("caller: cannot touch assignment, package, commission or payout fields", async () => {
  await seed();
  const db = as("caller1");
  for (const patch of [
    { assignedTo: "caller2" }, { assignedTo: null }, { assignedToName: "X" }, { assignedAt: Timestamp.now() },
    { assignedBy: "caller1" }, { packageId: "pro" }, { commissionAmount: 9999 }, { paymentConfirmed: true },
    { paymentConfirmedAt: Timestamp.now() }, { paymentConfirmedBy: "caller1" }, { paymentConfirmedByName: "x" },
    { payoutStatus: "pending" }, { payoutWeek: "2026-W44" },
  ]) {
    await assertFails(updateDoc(lead(db), patch));
    await assertFails(updateDoc(lead(db), { ...patch, notes: "bundled with an allowed field" }));
  }
});

test("caller: cannot edit identity, revenue, conversion or archive fields", async () => {
  await seed();
  const db = as("caller1");
  for (const patch of [
    { businessName: "X" }, { phone: "0779999999" }, { closedAmount: 100000 }, { convertedCenterId: "c9" },
    { convertedAt: Timestamp.now() }, { isDeleted: true }, { createdBy: "caller1" },
  ]) {
    await assertFails(updateDoc(lead(db), patch));
  }
});

test("caller: cannot set a lead to won, or move one out of won", async () => {
  await seed();
  await assertFails(updateDoc(lead(as("caller1")), { stage: "won", stageHistory: arrayUnion(entry("called", "won", "caller1")) }));
  await seed({ stage: "won" });
  await assertFails(updateDoc(lead(as("caller1")), { stage: "demo_done", stageHistory: arrayUnion(entry("won", "demo_done", "caller1")) }));
});

test("caller: cannot edit another caller's lead", async () => {
  await seed();
  await assertFails(updateDoc(lead(as("caller1"), "L2"), { notes: "hi" }));
});

// ── Caller: allowed work + stageHistory contract ─────────────────────────────
test("caller: can edit call counters, notes and follow-ups without a stage change", async () => {
  await seed();
  await assertSucceeds(updateDoc(lead(as("caller1")), {
    callCount: 2, tags: ["bug"], lastCallAt: Timestamp.now(), notes: "n", nextFollowUp: "2026-11-01", updatedAt: Timestamp.now(),
  }));
});

test("caller: a stage change must append exactly one matching history entry", async () => {
  await seed();
  const db = as("caller1");
  await assertSucceeds(updateDoc(lead(db), { stage: "demo_booked", stageHistory: arrayUnion(entry("called", "demo_booked", "caller1")) }));
  // And the next one builds on the first.
  await assertSucceeds(updateDoc(lead(db), { stage: "demo_done", stageHistory: arrayUnion(entry("demo_booked", "demo_done", "caller1")) }));
});

test("caller: a stage change with no history entry is rejected", async () => {
  await seed();
  await assertFails(updateDoc(lead(as("caller1")), { stage: "demo_booked" }));
});

test("caller: forged, mismatched or doubled history entries are rejected", async () => {
  await seed();
  const db = as("caller1");
  await assertFails(updateDoc(lead(db), { stage: "demo_booked", stageHistory: arrayUnion(entry("called", "demo_booked", "caller2")) }));
  await assertFails(updateDoc(lead(db), { stage: "demo_booked", stageHistory: arrayUnion(entry("new", "demo_booked", "caller1")) }));
  await assertFails(updateDoc(lead(db), { stage: "demo_booked", stageHistory: arrayUnion(entry("called", "demo_done", "caller1")) }));
  await assertFails(updateDoc(lead(db), {
    stage: "demo_booked",
    stageHistory: arrayUnion(entry("called", "demo_booked", "caller1"), entry("demo_booked", "demo_done", "caller1")),
  }));
});

test("caller: cannot rewrite or truncate existing history, or touch it without a stage change", async () => {
  await seed({ stage: "demo_booked", stageHistory: [entry("called", "demo_booked", "caller1")] });
  const db = as("caller1");
  await assertFails(updateDoc(lead(db), { stageHistory: [] }));
  await assertFails(updateDoc(lead(db), { stageHistory: arrayUnion(entry("demo_booked", "demo_booked", "caller1")) }));
  await assertFails(updateDoc(lead(db), {
    stage: "demo_done", stageHistory: [entry("called", "demo_done", "caller1"), entry("demo_booked", "demo_done", "caller1")],
  }));
});

test("caller: losing a lead needs a reason", async () => {
  await seed();
  const db = as("caller1");
  await assertFails(updateDoc(lead(db), { stage: "lost", stageHistory: arrayUnion(entry("called", "lost", "caller1")) }));
  await assertFails(updateDoc(lead(db), { stage: "lost", lostReason: "", stageHistory: arrayUnion(entry("called", "lost", "caller1")) }));
  await assertSucceeds(updateDoc(lead(db), { stage: "lost", lostReason: "Too expensive", stageHistory: arrayUnion(entry("called", "lost", "caller1")) }));
});

test("caller: logging a call is one batch — calls entry plus lead update", async () => {
  await seed();
  const db = as("caller1");
  const batch = writeBatch(db);
  batch.set(doc(collection(db, "leads", "L1", "calls")), { outcome: "demo_booked", note: "n", createdBy: "caller1" });
  batch.update(lead(db), {
    callCount: 2, lastCallAt: Timestamp.now(), demoRequested: true, stage: "demo_booked",
    stageHistory: arrayUnion(entry("called", "demo_booked", "caller1")), updatedAt: Timestamp.now(),
  });
  await assertSucceeds(batch.commit());
});

// ── Sub-collections ──────────────────────────────────────────────────────────
test("calls: caller reads and adds to their own lead; entries are immutable; other leads are closed", async () => {
  await seed();
  const db = as("caller1");
  await assertSucceeds(getDocs(collection(db, "leads", "L1", "calls")));
  await assertSucceeds(setDoc(doc(db, "leads", "L1", "calls", "c2"), { outcome: "note", createdBy: "caller1" }));
  await assertFails(setDoc(doc(db, "leads", "L1", "calls", "c3"), { outcome: "note", createdBy: "caller2" }));
  await assertFails(updateDoc(doc(db, "leads", "L1", "calls", "c1"), { note: "edited" }));
  await assertFails(deleteDoc(doc(db, "leads", "L1", "calls", "c1")));
  await assertFails(getDocs(collection(db, "leads", "L2", "calls")));
  await assertFails(setDoc(doc(db, "leads", "L2", "calls", "c9"), { outcome: "note", createdBy: "caller1" }));
});

test("notes: caller edits and removes only their own entries, on their own leads", async () => {
  await seed();
  const db = as("caller1");
  await assertSucceeds(getDocs(collection(db, "leads", "L1", "notes")));
  await assertSucceeds(setDoc(doc(db, "leads", "L1", "notes", "n3"), { text: "z", createdBy: "caller1" }));
  await assertSucceeds(updateDoc(doc(db, "leads", "L1", "notes", "n1"), { text: "edit" }));
  await assertSucceeds(deleteDoc(doc(db, "leads", "L1", "notes", "n1")));
  await assertFails(updateDoc(doc(db, "leads", "L1", "notes", "n2"), { text: "edit" }));
  await assertFails(deleteDoc(doc(db, "leads", "L1", "notes", "n2")));
  await assertFails(getDocs(collection(db, "leads", "L2", "notes")));
});

test("collectionGroup calls stays super-admin only", async () => {
  await seed();
  const { collectionGroup } = await import("firebase/firestore");
  await assertSucceeds(getDocs(collectionGroup(as("admin1"), "calls")));
  await assertFails(getDocs(collectionGroup(as("caller1"), "calls")));
});

// ── Super admin ──────────────────────────────────────────────────────────────
test("admin: still has full access, including to legacy leads without the new fields", async () => {
  await seed({}, { legacy: true });
  const db = as("admin1");
  await assertSucceeds(getDoc(lead(db)));
  await assertSucceeds(updateDoc(lead(db), { stage: "called", stageHistory: arrayUnion(entry("new", "called", "admin1")) }));
  await assertSucceeds(updateDoc(lead(db), { notes: "x", closedAmount: 5000 }));
  await assertSucceeds(setDoc(lead(db, "new"), baseLead()));
  await assertSucceeds(deleteDoc(lead(db, "new")));
});

test("admin: assigns only to an active caller, or clears the assignment", async () => {
  await seed({ assignedTo: null });
  const db = as("admin1");
  await assertSucceeds(updateDoc(lead(db), { assignedTo: "caller2", assignedToName: "Two", assignedAt: Timestamp.now(), assignedBy: "admin1" }));
  await assertFails(updateDoc(lead(db), { assignedTo: "gone", assignedBy: "admin1" }));
  await assertFails(updateDoc(lead(db), { assignedTo: "nobody", assignedBy: "admin1" }));
  await assertFails(updateDoc(lead(db), { assignedTo: "caller1", assignedBy: "caller1" }));
  await assertSucceeds(updateDoc(lead(db), { assignedTo: null, assignedToName: null, assignedBy: null }));
});

test("admin: registration stamps the package commission — 1000 for Basic, 1600 for Pro — and nothing else", async () => {
  await seed({ stage: "demo_done" });
  const db = as("admin1");
  await assertSucceeds(updateDoc(lead(db), { stage: "won", packageId: "basic", commissionAmount: 1000 }));
  await seed({ stage: "demo_done" });
  await assertSucceeds(updateDoc(lead(db), { stage: "won", packageId: "pro", commissionAmount: 1600 }));
  await seed({ stage: "demo_done" });
  await assertFails(updateDoc(lead(db), { stage: "won", packageId: "basic", commissionAmount: 1600 }));
  await assertFails(updateDoc(lead(db), { stage: "won", packageId: "basic", commissionAmount: 999.8 }));
  await assertFails(updateDoc(lead(db), { stage: "won", packageId: "gold", commissionAmount: 1000 }));
  await assertFails(updateDoc(lead(db), { stage: "won", commissionAmount: 1000 }));
  // Unreadable package at registration: won with the package, commission left unset.
  await assertSucceeds(updateDoc(lead(db), { stage: "won", packageId: "pro", commissionAmount: null }));
});

const confirm = (over = {}) => ({
  paymentConfirmed: true, paymentConfirmedAt: Timestamp.now(), paymentConfirmedBy: "admin1",
  paymentConfirmedByName: "Admin", payoutStatus: "pending", payoutWeek: "2026-W44", ...over,
});

test("admin: confirming payment needs a won lead with a commission, stamped by that admin", async () => {
  const won = { stage: "won", packageId: "basic", commissionAmount: 1000 };
  await seed(won);
  await assertSucceeds(updateDoc(lead(as("admin1")), confirm()));
  for (const bad of [
    confirm({ paymentConfirmedBy: "someone-else" }), confirm({ payoutStatus: null }),
    confirm({ payoutStatus: "paid_to_caller" }), confirm({ payoutWeek: "week 44" }), confirm({ payoutWeek: null }),
  ]) {
    await seed(won);
    await assertFails(updateDoc(lead(as("admin1")), bad));
  }
  await seed({ ...won, stage: "demo_done" });
  await assertFails(updateDoc(lead(as("admin1")), confirm()));
  await seed({ stage: "won", packageId: "basic", commissionAmount: null });
  await assertFails(updateDoc(lead(as("admin1")), confirm()));
});

test("admin: marking a payout sent works, and a sent payout is frozen", async () => {
  await seed({ stage: "won", packageId: "basic", commissionAmount: 1000, ...confirm() });
  const db = as("admin1");
  await assertSucceeds(updateDoc(lead(db), { payoutStatus: "paid_to_caller" }));
  await assertFails(updateDoc(lead(db), { payoutStatus: "pending" }));
  await assertFails(updateDoc(lead(db), { paymentConfirmed: false }));
  await assertFails(updateDoc(lead(db), { commissionAmount: 1600, packageId: "pro" }));
  await assertFails(updateDoc(lead(db), { payoutWeek: "2026-W45" }));
  // Ordinary edits are still fine.
  await assertSucceeds(updateDoc(lead(db), { notes: "paid via bank" }));
});
