// Storage rules for postServiceChecklists/{center}/{recordKey}/report.pdf — the
// report PDFs written by generatePostServiceChecklistPdf. Same setup as
// inspectionReports.storage.test.mjs (Firestore + Storage emulators; unset proxy
// variables and JAVA_TOOL_OPTIONS first).
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
    for (const [uid, role] of Object.entries({ own: "Owner", tech: "Technician", cash: "Cashier" })) {
      await setDoc(doc(db, `servicecenters/c1/staff/${uid}`), { role });
    }
    await setDoc(doc(db, "servicecenters/c2/staff/other"), { role: "Owner" });
  });
  // The function writes with the Admin SDK; here that is "rules disabled".
  await env.withSecurityRulesDisabled(async (ctx) => {
    await uploadBytes(ref(ctx.storage(), "postServiceChecklists/c1/standalone-k1/report.pdf"), new Uint8Array(10), { contentType: "application/pdf" });
  });
});
after(() => env.cleanup());

const st = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).storage();
const pdf = (s, center = "c1", key = "standalone-k1") => ref(s, `postServiceChecklists/${center}/${key}/report.pdf`);

test("staff of the centre can read a report PDF; other centres and signed-out users cannot", async () => {
  for (const uid of ["own", "tech", "cash"]) await assertSucceeds(getBytes(pdf(st(uid))));
  await assertFails(getBytes(pdf(st("other"))));
  await assertFails(getBytes(pdf(st(null))));
});

test("no client can create, overwrite or delete a report PDF — not even the Owner", async () => {
  const bytes = new Uint8Array(10);
  await assertFails(uploadBytes(pdf(st("own"), "c1", "job-j9"), bytes, { contentType: "application/pdf" }));
  await assertFails(uploadBytes(pdf(st("own")), bytes, { contentType: "application/pdf" }));
  await assertFails(uploadBytes(pdf(st("tech"), "c1", "standalone-k2"), bytes, { contentType: "application/pdf" }));
  await assertFails(deleteObject(pdf(st("own"))));
});
