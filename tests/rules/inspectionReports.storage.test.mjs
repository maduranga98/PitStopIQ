// Storage security-rules tests for inspectionReports/{center}/{report}/{file}.
// Needs the Firestore + Storage emulators (staff roles are read from Firestore):
//
//   (unset any HTTP proxy variables and JAVA_TOOL_OPTIONS first — the Storage rules
//    runtime fails to start with them set)
//   npx firebase emulators:exec --only firestore,storage --project demo-test \
//     "node --test tests/rules/inspectionReports.storage.test.mjs"
//
// with a firebase.json pointing at ../../storage.rules (see tests/e2e README).
import { test, before, after } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { ref, uploadBytes, deleteObject, getBytes } from "firebase/storage";

const RULES = process.env.STORAGE_RULES_PATH ?? new URL("../../storage.rules", import.meta.url).pathname;
let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-test",
    firestore: { host: "127.0.0.1", port: 8085, rules: "service cloud.firestore { match /databases/{d}/documents { match /{x=**} { allow read, write: if true; } } }" },
    storage: { host: "127.0.0.1", port: 9195, rules: readFileSync(RULES, "utf8") },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, role] of Object.entries({ own: "Owner", mgr: "Manager", tech: "Technician", cash: "Cashier", rec: "Receptionist" })) {
      await setDoc(doc(db, `servicecenters/c1/staff/${uid}`), { role });
    }
    await setDoc(doc(db, "servicecenters/c2/staff/other"), { role: "Owner" });
  });
});
after(() => env.cleanup());

const st = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).storage();
const f = (s, name, report = "r1", center = "c1") => ref(s, `inspectionReports/${center}/${report}/${name}`);
const bytes = (n = 10) => new Uint8Array(n);
const put = (uid, name, type = "image/jpeg", n = 10, report = "r1", center = "c1") => uploadBytes(f(st(uid), name, report, center), bytes(n), { contentType: type });

test("Owner, Manager and Technician can add JPEG, PNG and PDF media", async () => {
  for (const uid of ["own", "mgr", "tech"]) {
    await assertSucceeds(put(uid, `${uid}-a`, "image/jpeg"));
    await assertSucceeds(put(uid, `${uid}-b`, "image/png"));
    await assertSucceeds(put(uid, `${uid}-c`, "application/pdf"));
  }
});

test("Cashier, Receptionist, other centres and signed-out users can't add media", async () => {
  await assertFails(put("cash", "x1"));
  await assertFails(put("rec", "x2"));
  await assertFails(put("other", "x3"));
  await assertFails(put(null, "x4"));
});

test("only JPEG/PNG/PDF, and under 10 MB", async () => {
  await assertFails(put("own", "g1", "image/gif"));
  await assertFails(put("own", "g2", "text/html"));
  await assertFails(put("own", "big", "image/jpeg", 10 * 1024 * 1024));
  await assertSucceeds(put("own", "ok", "image/jpeg", 10 * 1024 * 1024 - 1));
});

test("report.pdf: no client may create it; media can't be overwritten", async () => {
  for (const uid of ["own", "mgr", "tech"]) await assertFails(put(uid, "report.pdf", "application/pdf"));
  await assertSucceeds(put("own", "once"));
  await assertFails(put("own", "once"));
});

test("reads: staff only", async () => {
  await assertSucceeds(put("own", "readme"));
  for (const uid of ["own", "mgr", "tech", "cash", "rec"]) await assertSucceeds(getBytes(f(st(uid), "readme")));
  await assertFails(getBytes(f(st("other"), "readme")));
  await assertFails(getBytes(f(st(null), "readme")));
});

test("delete: Owner/Manager/Technician only; report.pdf Owner only", async () => {
  for (const [i, uid] of ["own", "mgr", "tech"].entries()) { await assertSucceeds(put("own", `d${i}`)); await assertSucceeds(deleteObject(f(st(uid), `d${i}`))); }
  await assertSucceeds(put("own", "keep"));
  for (const uid of ["cash", "rec", "other"]) await assertFails(deleteObject(f(st(uid), "keep")));
  await assertFails(deleteObject(f(st(null), "keep")));
  // Seed a report.pdf the way the callable does (Admin SDK = rules bypassed).
  await env.withSecurityRulesDisabled(async (ctx) => { await uploadBytes(f(ctx.storage(), "report.pdf"), bytes(), { contentType: "application/pdf" }); });
  await assertFails(deleteObject(f(st("mgr"), "report.pdf")));
  await assertFails(deleteObject(f(st("tech"), "report.pdf")));
  await assertSucceeds(deleteObject(f(st("own"), "report.pdf")));
});

test("existing storage rules unaffected (spot check: vehicle photos public read, logo size cap)", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => { await uploadBytes(ref(ctx.storage(), "servicecenters/c1/vehicles/v1/qr.png"), bytes(), { contentType: "image/png" }); });
  await assertSucceeds(getBytes(ref(st(null), "servicecenters/c1/vehicles/v1/qr.png")));
  await assertFails(uploadBytes(ref(st("cash"), "servicecenters/c1/logo.png"), bytes(3 * 1024 * 1024), { contentType: "image/png" }));
});
