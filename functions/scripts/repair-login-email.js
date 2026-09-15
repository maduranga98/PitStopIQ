/**
 * repair-login-email.js — move an owner's Auth login email onto the address the
 * login form actually derives from their phone number.
 *
 * The failure this repairs: an Auth account exists and the owner's data is all
 * there, but the account was created at an email built from a differently
 * formatted phone number, so the login form asks Firebase for an address that
 * does not exist and the owner is told "no account for this number". The uid is
 * fine, the data is fine, only the email is wrong.
 *
 * updateUser({ email }) changes the address IN PLACE. It keeps the uid, and with
 * it the password hash, any custom claims and every document keyed on that uid —
 * so the owner keeps their existing password and nothing has to be re-linked.
 * The denormalised copies of the email on users/{uid} and the owner's staff
 * record are updated to match, and ownerPhone on the centre is rewritten to the
 * canonical display form so the next audit agrees with the login form.
 *
 * DRY RUN BY DEFAULT. Nothing is written unless you pass --apply. The dry run
 * prints the exact changes, and an --apply run prints the command that reverses
 * it before it makes any change.
 *
 * Usage (from functions/):
 *   node scripts/repair-login-email.js <currentEmail> <correctPhone>            # dry run
 *   node scripts/repair-login-email.js <currentEmail> <correctPhone> --apply    # do it
 *
 * Example:
 *   node scripts/repair-login-email.js 94771234567@pitstopiq.app 0771234567 --apply
 */

const admin = require("firebase-admin");

admin.initializeApp();

const { phoneToLoginEmail, toDisplayPhone, normaliseLocalPhone } = require("../shared/phone.mjs");

async function main() {
  const [currentEmail, correctPhone] = process.argv.slice(2);
  const apply = process.argv.includes("--apply");

  if (!currentEmail || !correctPhone) {
    console.error("Usage: node scripts/repair-login-email.js <currentEmail> <correctPhone> [--apply]");
    process.exit(2);
  }

  if (!normaliseLocalPhone(correctPhone)) {
    console.error(`✗ "${correctPhone}" is not a phone number this app can parse. Nothing done.`);
    process.exit(1);
  }

  const targetEmail = phoneToLoginEmail(correctPhone);
  const displayPhone = toDisplayPhone(correctPhone);

  // 1. The account being moved must exist.
  let user;
  try {
    user = await admin.auth().getUserByEmail(currentEmail);
  } catch (err) {
    if (err.code === "auth/user-not-found") {
      console.error(`✗ No Auth account at "${currentEmail}". Nothing done.`);
      console.error(`  Run: node scripts/verify-account.js ${displayPhone}`);
      process.exit(1);
    }
    throw err;
  }

  if (user.email === targetEmail) {
    console.log(`✓ ${currentEmail} already IS the address login derives from ${displayPhone}. Nothing to do.`);
    return;
  }

  // 2. Refuse if the destination is occupied. Taking an email from another
  //    account is never a repair — it is a second outage.
  try {
    const occupant = await admin.auth().getUserByEmail(targetEmail);
    console.error(`✗ ${targetEmail} is already taken by uid ${occupant.uid}.`);
    console.error(`  Refusing to move ${user.uid} onto it — that would break both accounts.`);
    console.error(`  Investigate which of the two is the live centre before doing anything.`);
    process.exit(1);
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
    // Free. Good.
  }

  const db = admin.firestore();
  const userIdxSnap = await db.doc(`users/${user.uid}`).get();
  const centerId = userIdxSnap.exists ? userIdxSnap.data().centerId : user.uid;
  const centerSnap = await db.doc(`servicecenters/${centerId}`).get();
  const staffRef = db.doc(`servicecenters/${centerId}/staff/${user.uid}`);
  const staffSnap = await staffRef.get();

  console.log(`  uid              : ${user.uid}  (unchanged — password and data are kept)`);
  console.log(`  centre           : ${centerSnap.exists ? `${centerSnap.data().name} (${centerId})` : `${centerId} — NOT FOUND`}`);
  console.log(`  email            : ${user.email}  →  ${targetEmail}`);
  console.log(`  users/{uid}.email: ${userIdxSnap.exists ? userIdxSnap.data().email : "— missing —"}  →  ${targetEmail}`);
  console.log(`  staff.email      : ${staffSnap.exists ? staffSnap.data().email : "— missing —"}  →  ${targetEmail}`);
  if (centerSnap.exists) {
    console.log(`  centre.ownerPhone: ${centerSnap.data().ownerPhone}  →  ${displayPhone}`);
  }
  console.log("");

  if (!apply) {
    console.log(`DRY RUN — nothing was written.`);
    console.log(`Re-run with --apply to make these changes.`);
    return;
  }

  // The reversal, printed BEFORE the change so it survives a failure midway.
  console.log(`To reverse this exactly:`);
  console.log(`  node scripts/repair-login-email.js ${targetEmail} ${toDisplayPhone(user.email.split("@")[0]) ?? user.email} --apply`);
  console.log("");

  await admin.auth().updateUser(user.uid, { email: targetEmail });
  console.log(`  ✓ Auth email moved`);

  const batch = db.batch();
  if (userIdxSnap.exists) batch.update(db.doc(`users/${user.uid}`), { email: targetEmail });
  if (staffSnap.exists) batch.update(staffRef, { email: targetEmail, loginPhone: displayPhone, phone: displayPhone });
  if (centerSnap.exists) batch.update(db.doc(`servicecenters/${centerId}`), { ownerPhone: displayPhone });
  await batch.commit();
  console.log(`  ✓ Documents updated`);
  console.log("");
  console.log(`Now confirm:  node scripts/verify-account.js ${displayPhone}`);
}

main().catch((err) => {
  console.error("repair-login-email failed:", err);
  process.exit(1);
});
