/**
 * verify-account.js — the full sign-in chain for ONE service centre.
 *
 * Answers the support question "owner X says they cannot log in" without
 * guessing: it derives the login email exactly as the login form does, looks for
 * the Auth account there, then walks the same documents the app reads after
 * sign-in and reports the first thing that does not line up.
 *
 * Read-only. It never writes anything.
 *
 * Usage (from functions/):
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
 *     node scripts/verify-account.js 0771234567
 *
 * Or, if you're already `firebase login`'d with access to the pitstopiq project:
 *   gcloud auth application-default login
 *   node scripts/verify-account.js 0771234567
 *
 * Any format the owner might type works: 0771234567, 771234567, +94771234567,
 * 94771234567, 0094771234567, or with spaces and dashes.
 */

const admin = require("firebase-admin");

admin.initializeApp();

const { describeAccountChain, problemsWithChain } = require("../shared/provisioning");
const { normaliseLocalPhone, toDisplayPhone } = require("../shared/phone.mjs");

async function main() {
  const phone = process.argv[2];
  if (!phone) {
    console.error("Usage: node scripts/verify-account.js <phone>");
    process.exit(2);
  }

  const local = normaliseLocalPhone(phone);
  if (!local) {
    console.error(`✗ "${phone}" is not a phone number this app can parse.`);
    console.error(`  Accepted: 0771234567, 771234567, +94771234567, 94771234567, 0094771234567.`);
    process.exit(1);
  }

  console.log(`Checking ${toDisplayPhone(phone)} (canonical: ${local})\n`);

  const chain = await describeAccountChain({ phone });
  const problems = problemsWithChain(chain);

  console.log(`  login email the app derives : ${chain.expectedEmail}`);
  console.log(`  Firebase Auth account       : ${chain.authUser ? `${chain.authUser.uid}${chain.authUser.disabled ? " (DISABLED)" : ""}` : "— none —"}`);
  console.log(`  users/{uid} index           : ${chain.userIndex ? `centerId=${chain.userIndex.centerId} role=${chain.userIndex.role}` : "— missing —"}`);
  console.log(`  servicecenters/{centerId}   : ${chain.center ? `${chain.center.name} plan=${chain.center.plan} status=${chain.center.status}` : "— missing —"}`);
  console.log(`  owner staff record          : ${chain.staff ? `${chain.staff.fullName} active=${chain.staff.active}` : "— missing —"}`);
  console.log("");

  if (problems.length === 0) {
    console.log(`✓ This owner can sign in with ${chain.displayPhone}.`);
    return;
  }

  console.log(`✗ ${problems.length} problem${problems.length === 1 ? "" : "s"}:\n`);
  for (const p of problems) console.log(`  • ${p}`);

  // The one problem there is a safe, scripted repair for.
  if (chain.authUser && chain.authUser.email && chain.authUser.email !== chain.expectedEmail) {
    console.log(`\n  Repair:`);
    console.log(`    node scripts/repair-login-email.js ${chain.authUser.email} ${chain.displayPhone}`);
  }
  process.exitCode = 1;
}

main().catch((err) => {
  console.error("verify-account failed:", err);
  process.exit(1);
});
