// createCallerAccount against the Auth + Firestore emulators. Not part of
// `npm test` (needs the emulators + Java):
//
//   npm run test:callers
//
// Calls the real handler from functions/index.js through `.run(...)`.
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const FS = "127.0.0.1:8085";
const AUTH = "127.0.0.1:9099";
process.env.GCLOUD_PROJECT = "demo-test";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? FS;
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? AUTH;

const FN = process.env.FUNCTIONS_DIR ?? new URL("../../functions/", import.meta.url).pathname;
const require = createRequire(`${FN}index.js`);
const admin = require("firebase-admin");
const fns = require(`${FN}index.js`);
const handler = fns.createCallerAccount;

const db = admin.firestore();
const auth = admin.auth();

const GOOD = { name: "Kasun Perera", email: "Kasun@Example.com", phone: "0771234567" };
const asAdmin = (data) => ({ auth: { uid: "admin1" }, data });

async function reset() {
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/demo-test/accounts`, { method: "DELETE" });
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-test/databases/(default)/documents`, { method: "DELETE" });
  await auth.createUser({ uid: "admin1", email: "boss@example.com", displayName: "Boss" });
  await db.doc("superadmins/admin1").set({ createdAt: new Date() });
  await auth.createUser({ uid: "plain1", email: "plain@example.com", password: "secret123" });
}

async function signIn(email, password) {
  const res = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) },
  );
  return res.ok;
}

const rejects = (promise, code) =>
  assert.rejects(promise, (err) => { assert.equal(err.code, code, err.message); return true; });

before(() => { assert.ok(handler?.run, "createCallerAccount must be an onCall with .run"); });
beforeEach(reset);

test("rejects an unauthenticated call", async () => {
  await rejects(handler.run({ data: GOOD }), "unauthenticated");
});

test("rejects a signed-in user who is not a super admin", async () => {
  await rejects(handler.run({ auth: { uid: "plain1" }, data: GOOD }), "permission-denied");
  assert.equal((await db.collection("callers").get()).size, 0);
});

test("rejects missing or invalid input and creates nothing", async () => {
  for (const bad of [{}, { ...GOOD, name: " " }, { ...GOOD, email: "nope" }, { ...GOOD, phone: "12" },
    { ...GOOD, email: "0771234567@pitstopiq.app" }]) {
    await rejects(handler.run(asAdmin(bad)), "invalid-argument");
  }
  assert.equal((await db.collection("callers").get()).size, 0);
});

test("creates the Auth user and callers doc; the returned password signs in", async () => {
  const res = await handler.run(asAdmin(GOOD));
  assert.equal(res.success, true);
  assert.equal(res.verified, true);
  assert.equal(res.email, "kasun@example.com");
  assert.equal(res.tempPassword.length, 12);

  const user = await auth.getUserByEmail("kasun@example.com");
  assert.equal(user.uid, res.callerId);
  assert.equal(user.displayName, "Kasun Perera");

  const doc = (await db.doc(`callers/${res.callerId}`).get()).data();
  assert.equal(doc.name, "Kasun Perera");
  assert.equal(doc.email, "kasun@example.com");
  assert.equal(doc.phone, "0771234567");
  assert.equal(doc.isActive, true);
  assert.equal(doc.createdBy, "admin1");
  assert.equal(doc.createdByName, "Boss");
  assert.ok(doc.createdAt);

  assert.equal(await signIn("kasun@example.com", res.tempPassword), true);
  assert.equal(await signIn("kasun@example.com", "wrong-password"), false);
});

test("createdBy comes from the session, not the payload", async () => {
  const res = await handler.run(asAdmin({ ...GOOD, createdBy: "evil", createdByName: "Evil", adminId: "evil" }));
  const doc = (await db.doc(`callers/${res.callerId}`).get()).data();
  assert.equal(doc.createdBy, "admin1");
  assert.equal(doc.createdByName, "Boss");
});

test("a duplicate email is already-exists and writes no second doc", async () => {
  await handler.run(asAdmin(GOOD));
  await rejects(handler.run(asAdmin({ ...GOOD, name: "Someone Else" })), "already-exists");
  assert.equal((await db.collection("callers").get()).size, 1);
  // An email already used by any other account, e.g. a super admin, is refused too.
  await rejects(handler.run(asAdmin({ ...GOOD, email: "boss@example.com" })), "already-exists");
});

test("each call gets a different password", async () => {
  const a = await handler.run(asAdmin(GOOD));
  const b = await handler.run(asAdmin({ ...GOOD, email: "second@example.com" }));
  assert.notEqual(a.tempPassword, b.tempPassword);
});

test("a failed Firestore write rolls the Auth user back, so the retry is clean", async () => {
  const Ref = db.doc("callers/x").constructor;
  const realSet = Ref.prototype.set;
  Ref.prototype.set = function (...args) {
    if (this.path.startsWith("callers/")) return Promise.reject(new Error("simulated write failure"));
    return realSet.apply(this, args);
  };
  try {
    await rejects(handler.run(asAdmin(GOOD)), "internal");
  } finally {
    Ref.prototype.set = realSet;
  }
  await assert.rejects(auth.getUserByEmail("kasun@example.com"), (e) => e.code === "auth/user-not-found");
  assert.equal((await db.collection("callers").get()).size, 0);

  const retry = await handler.run(asAdmin(GOOD));
  assert.equal(retry.success, true);
});

test("the password is never logged", async () => {
  const logger = require("firebase-functions/logger");
  const lines = [];
  const orig = { info: logger.info, error: logger.error, warn: logger.warn };
  for (const k of Object.keys(orig)) logger[k] = (...a) => lines.push(JSON.stringify(a));
  let res;
  try { res = await handler.run(asAdmin(GOOD)); } finally { Object.assign(logger, orig); }
  assert.ok(lines.length > 0);
  assert.ok(lines.every((l) => !l.includes(res.tempPassword)));
});
