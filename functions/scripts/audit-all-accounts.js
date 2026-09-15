/**
 * audit-all-accounts.js — the same check as verify-account.js, for every centre.
 *
 * This is the script that answers "how many of our owners cannot log in right
 * now", which is not a question the app can answer from the inside. It walks
 * every servicecenters document, runs the identical sign-in chain check, and
 * prints a ready-to-paste repair command for each centre it can repair.
 *
 * Read-only. It never writes anything — every repair is a command it prints for
 * a human to read, consider and run.
 *
 * Usage (from functions/):
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
 *     node scripts/audit-all-accounts.js
 *
 *   --json   machine-readable output instead of the report
 */

const admin = require("firebase-admin");

admin.initializeApp();

const { describeAccountChain, problemsWithChain, KNOWN_PLANS } = require("../shared/provisioning");
const { normaliseLocalPhone, toDisplayPhone } = require("../shared/phone.mjs");

async function main() {
  const asJson = process.argv.includes("--json");
  const db = admin.firestore();

  const snap = await db.collection("servicecenters").get();
  // Branches share their primary centre's owner login, so auditing them would
  // double-count the same account as both a pass and a failure.
  const centers = snap.docs.filter((d) => d.data().isBranch !== true);

  if (!asJson) {
    console.log(`Auditing ${centers.length} service centre${centers.length === 1 ? "" : "s"}` +
      `${snap.size !== centers.length ? ` (${snap.size - centers.length} branch record${snap.size - centers.length === 1 ? "" : "s"} skipped)` : ""}...\n`);
  }

  const results = [];
  for (const docSnap of centers) {
    const center = docSnap.data();
    const centerId = docSnap.id;
    const phone = center.ownerPhone;

    const entry = {
      centerId,
      name: center.name ?? "(unnamed)",
      ownerPhone: phone ?? null,
      problems: [],
      repair: null,
    };

    if (!phone) {
      entry.problems.push("the centre document has no ownerPhone, so no login email can be derived");
      results.push(entry);
      continue;
    }
    if (!normaliseLocalPhone(phone)) {
      entry.problems.push(`ownerPhone "${phone}" is not a parseable phone number`);
      results.push(entry);
      continue;
    }

    let chain;
    try {
      chain = await describeAccountChain({ phone, centerId });
    } catch (err) {
      entry.problems.push(`lookup failed: ${err.message}`);
      results.push(entry);
      continue;
    }

    entry.problems = problemsWithChain(chain);
    entry.expectedEmail = chain.expectedEmail;
    entry.actualEmail = chain.authUser?.email ?? null;

    // The repairable case: an Auth account exists for this centre's owner, but
    // at a different email than the login form will ask for.
    if (chain.authUser && chain.authUser.email !== chain.expectedEmail) {
      entry.repair = `node scripts/repair-login-email.js ${chain.authUser.email} ${toDisplayPhone(phone)}`;
    }
    results.push(entry);
  }

  if (asJson) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  const blocked = results.filter((r) => r.problems.length > 0);
  const ok = results.length - blocked.length;

  for (const r of blocked) {
    console.log(`✗ ${r.name}  (${r.centerId})`);
    console.log(`  owner phone: ${r.ownerPhone ?? "—"}`);
    for (const p of r.problems) console.log(`    • ${p}`);
    if (r.repair) console.log(`    repair: ${r.repair}`);
    console.log("");
  }

  console.log("─".repeat(60));
  console.log(`  ${ok} centre${ok === 1 ? "" : "s"} can sign in`);
  console.log(`  ${blocked.length} login-blocked`);
  const repairable = blocked.filter((r) => r.repair).length;
  if (repairable) console.log(`  ${repairable} repairable with the printed command`);

  // A summary of the two things the audit was specifically asked to count.
  const emailMismatch = results.filter((r) => r.actualEmail && r.expectedEmail && r.actualEmail !== r.expectedEmail).length;
  const missingCenterDoc = blocked.filter((r) => r.problems.some((p) => p.includes("is missing — the owner would sign in"))).length;
  const badPlan = blocked.filter((r) => r.problems.some((p) => p.includes("cannot gate on"))).length;
  console.log("");
  console.log(`  Auth email does not match what login builds : ${emailMismatch}`);
  console.log(`  No servicecenters document                  : ${missingCenterDoc}`);
  console.log(`  Plan outside ${KNOWN_PLANS.join("/")}${" ".repeat(Math.max(0, 30 - KNOWN_PLANS.join("/").length))}: ${badPlan}`);
  console.log("");
  console.log(`  NOTE: custom claims are not audited because this system sets none.`);
  console.log(`  Role and plan live on users/{uid} and the centre document, both checked above.`);

  if (blocked.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error("audit-all-accounts failed:", err);
  process.exit(1);
});
