// Retention cleanup (functions/inspectionCleanup.js) against the Firestore and
// Storage emulators. Not part of `npm test`. From a directory that has
// firebase-tools and @firebase/rules-unit-testing:
//
//   npx firebase emulators:exec --only firestore,storage --project demo-test \
//     "node --test cleanup.test.mjs"        (Storage with open rules, ports 8085 / 9195)
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8085";
process.env.STORAGE_EMULATOR_HOST = "http://127.0.0.1:9195";
const FN = process.env.FUNCTIONS_DIR ?? new URL("../../functions/", import.meta.url).pathname;
const require = createRequire(`${FN}index.js`);
const admin = require("firebase-admin");
const { Timestamp } = require("firebase-admin/firestore");
admin.initializeApp({ projectId: "demo-test", storageBucket: "demo-test.appspot.com" });
const { runStandaloneInspectionCleanup } = require(`${FN}inspectionCleanup.js`);

const db = admin.firestore();
const bucket = admin.storage().bucket();
const NOW = new Date("2027-10-10T00:00:00Z");
const past = (d) => Timestamp.fromDate(new Date(NOW.getTime() - d * 86400e3));
const future = (d) => Timestamp.fromDate(new Date(NOW.getTime() + d * 86400e3));
const ref = (id) => db.doc(`servicecenters/c1/inspectionReports/${id}`);
const path = (rid, fid) => `inspectionReports/c1/${rid}/${fid}`;
const exists = async (rid, fid) => (await bucket.file(path(rid, fid)).exists())[0];
const img = (id, at) => ({ id, kind: "photo", mimeType: "image/jpeg", name: `${id}.jpg`, url: `https://x/${id}`, pending: false, mediaDeleted: false, mediaDeleteAt: at });

async function seed(id, media, over = {}) {
  for (const f of [...Object.keys(media), "report.pdf"]) await bucket.file(path(id, f)).save(Buffer.from("x"), { resumable: false });
  const dates = Object.values(media).map((m) => m.mediaDeleteAt).filter(Boolean).sort((a, b) => a.toMillis() - b.toMillis());
  await ref(id).set({ status: "finalized", reportNumber: "INS-2026-0001", observations: "keep me", pdfUrl: "https://pdf", media, nextMediaDeleteAt: dates[0] ?? null, ...over });
}

before(async () => {
  for (const col of await db.collection("servicecenters/c1/inspectionReports").listDocuments()) await col.delete();
});

test("expires only images past their date; keeps text, PDF, PDF attachments and later images", async () => {
  await seed("A", {
    i1: img("i1", past(2)), i2: img("i2", future(30)), i3: img("i3", past(400)),
    a1: { id: "a1", kind: "attachment", mimeType: "application/pdf", name: "scan.pdf", url: "https://x/a1", pending: false, mediaDeleted: false, mediaDeleteAt: null },
  });
  const r = await runStandaloneInspectionCleanup(NOW);
  assert.equal(r.expired, 2);
  const a = (await ref("A").get()).data();
  for (const id of ["i1", "i3"]) { assert.equal(a.media[id].mediaDeleted, true); assert.equal(a.media[id].url, null); assert.equal(await exists("A", id), false); }
  assert.equal(a.media.i2.mediaDeleted, false); assert.equal(a.media.i2.url, "https://x/i2"); assert.equal(await exists("A", "i2"), true);
  assert.equal(a.media.a1.mediaDeleted, false); assert.equal(await exists("A", "a1"), true);
  assert.equal(await exists("A", "report.pdf"), true, "the generated PDF is kept permanently");
  assert.equal(a.observations, "keep me");
  assert.equal(a.pdfUrl, "https://pdf");
  assert.equal(a.nextMediaDeleteAt.toMillis(), future(30).toMillis(), "next due date moves to the remaining image");
});

test("when nothing is left to expire the scan key is cleared", async () => {
  await seed("B", { i1: img("i1", past(1)), i2: img("i2", past(5)) });
  await runStandaloneInspectionCleanup(NOW);
  const b = (await ref("B").get()).data();
  assert.equal(b.nextMediaDeleteAt, null);
  assert.ok(Object.values(b.media).every((m) => m.mediaDeleted && m.url === null));
});

test("a report that isn't due is untouched; a second run does nothing", async () => {
  await seed("C", { i1: img("i1", future(10)) });
  const before = (await ref("C").get()).data();
  const r = await runStandaloneInspectionCleanup(NOW);
  assert.equal(r.expired, 0);
  assert.deepEqual((await ref("C").get()).data(), before);
});

test("a reopened (draft) report's expired images are still removed", async () => {
  await seed("D", { i1: img("i1", past(3)) }, { status: "draft" });
  await runStandaloneInspectionCleanup(NOW);
  assert.equal((await ref("D").get()).data().media.i1.mediaDeleted, true);
});

test("an image already missing from Storage still gets marked expired", async () => {
  await seed("E", { i1: img("i1", past(3)) });
  await bucket.file(path("E", "i1")).delete();
  const r = await runStandaloneInspectionCleanup(NOW);
  assert.equal(r.failed, 0);
  assert.equal((await ref("E").get()).data().media.i1.mediaDeleted, true);
});

test("a failed Storage delete is retried next run, not lost, and doesn't loop", async () => {
  await seed("F", { i1: img("i1", past(3)), i2: img("i2", past(4)) });
  const flaky = { file: (p) => (p.endsWith("/F/i1") ? { delete: async () => { throw new Error("boom"); } } : bucket.file(p)) };
  const r = await runStandaloneInspectionCleanup(NOW, flaky);
  assert.deepEqual([r.expired, r.failed], [1, 1]);
  let f = (await ref("F").get()).data();
  assert.equal(f.media.i2.mediaDeleted, true);
  assert.equal(f.media.i1.mediaDeleted, false);
  assert.equal(f.media.i1.url, "https://x/i1");
  assert.equal(f.nextMediaDeleteAt.toMillis(), past(3).toMillis(), "stays due");
  assert.equal(await exists("F", "i1"), true);
  const again = await runStandaloneInspectionCleanup(NOW);
  assert.equal(again.expired, 1);
  f = (await ref("F").get()).data();
  assert.equal(f.media.i1.mediaDeleted, true);
  assert.equal(f.nextMediaDeleteAt, null);
});

test("works through more than one page of due reports", async () => {
  for (let i = 0; i < 105; i++) await ref(`P${i}`).set({ status: "finalized", media: { i1: img("i1", past(2)) }, nextMediaDeleteAt: past(2) });
  const r = await runStandaloneInspectionCleanup(NOW);
  assert.equal(r.reports >= 105, true);
  const left = await db.collectionGroup("inspectionReports").where("nextMediaDeleteAt", "<=", Timestamp.fromDate(NOW)).get();
  assert.equal(left.size, 0);
});
