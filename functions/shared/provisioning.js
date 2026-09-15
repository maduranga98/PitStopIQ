// ── What "this account actually works" means, in one place ─────────────────────
//
// registerServiceCenter needs this to decide whether it may hand over
// credentials. verify-account.js and audit-all-accounts.js need exactly the same
// judgement, or a centre could pass the audit and still not be able to log in.
// So the check lives here and all three call it.
//
// The checks mirror what the app really does at sign-in, rather than what the
// provisioner intended to write:
//
//   1. Firebase Auth has a user at the email the LOGIN FORM will derive from the
//      owner's phone number — not at the email the provisioner happened to use.
//      This is the check that catches a number stored in a format the login
//      form's normaliser resolves differently.
//   2. That user is not disabled.
//   3. users/{uid} exists and points at the centre with role Owner. This is the
//      first read AuthContext.resolveAuthUser makes.
//   4. servicecenters/{centerId} exists. This is its legacy fallback, and the
//      source of plan, status and quota for the whole app.
//   5. The owner's staff record exists and is active.
//   6. The plan on the document is one the app understands.
//
// A problem is a string a human can act on, not a code. These are read by a
// super admin at a keyboard, sometimes with an owner on the phone.

const admin = require("firebase-admin");
const { phoneToLoginEmail, toDisplayPhone } = require("./phone.mjs");

/** Plans the app can actually gate on — see the PLANS table in index.js. */
const KNOWN_PLANS = ["basic", "pro"];

/**
 * Look up the Auth user the login form would reach for a given phone number.
 * Returns null when there is no such account, rather than throwing, so callers
 * can report "no account" as a finding instead of a crash.
 */
async function findAuthUserByPhone(phone) {
  const email = phoneToLoginEmail(phone);
  if (!email) return { email: null, user: null };
  try {
    return { email, user: await admin.auth().getUserByEmail(email) };
  } catch (err) {
    if (err.code === "auth/user-not-found" || err.code === "auth/invalid-email") {
      return { email, user: null };
    }
    throw err;
  }
}

/**
 * The full sign-in chain for one centre, as data.
 *
 * `centerId` is optional: verify-account.js starts from a phone number alone and
 * discovers the centre from the Auth uid, which is the same thing the app does.
 */
async function describeAccountChain({ phone, centerId }) {
  const db = admin.firestore();
  const { email: expectedEmail, user } = await findAuthUserByPhone(phone);

  const uid = user?.uid;
  const resolvedCenterId = centerId || uid;

  const [userIdxSnap, centerSnap, staffSnap] = await Promise.all([
    uid ? db.doc(`users/${uid}`).get() : Promise.resolve(null),
    resolvedCenterId ? db.doc(`servicecenters/${resolvedCenterId}`).get() : Promise.resolve(null),
    uid && resolvedCenterId
      ? db.doc(`servicecenters/${resolvedCenterId}/staff/${uid}`).get()
      : Promise.resolve(null),
  ]);

  return {
    phone,
    displayPhone: toDisplayPhone(phone),
    expectedEmail,
    uid: uid ?? null,
    authUser: user
      ? { uid: user.uid, email: user.email, disabled: user.disabled, displayName: user.displayName }
      : null,
    centerId: resolvedCenterId ?? null,
    userIndex: userIdxSnap?.exists ? userIdxSnap.data() : null,
    center: centerSnap?.exists ? centerSnap.data() : null,
    staff: staffSnap?.exists ? staffSnap.data() : null,
  };
}

/**
 * Turn a chain into a list of human-readable problems. Empty means the owner can
 * sign in and land somewhere.
 */
function problemsWithChain(chain) {
  const problems = [];

  if (!chain.expectedEmail) {
    problems.push(
      `"${chain.phone}" is not a phone number the login form can parse, so no login email can be derived from it`
    );
    return problems; // nothing below can be meaningful
  }

  if (!chain.authUser) {
    problems.push(`no Firebase Auth account exists at ${chain.expectedEmail}, which is what logging in with ${chain.displayPhone} looks for`);
  } else if (chain.authUser.disabled) {
    problems.push(`the Auth account ${chain.expectedEmail} is disabled`);
  }

  if (!chain.uid) return problems; // no uid, so the document checks cannot run

  if (!chain.userIndex) {
    problems.push(`users/${chain.uid} is missing — this is the first document the app reads after sign-in`);
  } else {
    if (!chain.userIndex.centerId) {
      problems.push(`users/${chain.uid} has no centerId`);
    } else if (chain.centerId && chain.userIndex.centerId !== chain.centerId) {
      problems.push(`users/${chain.uid}.centerId is "${chain.userIndex.centerId}" but the centre is "${chain.centerId}"`);
    }
    if (chain.userIndex.role !== "Owner") {
      problems.push(`users/${chain.uid}.role is "${chain.userIndex.role ?? "(unset)"}", expected "Owner"`);
    }
  }

  if (!chain.center) {
    problems.push(`servicecenters/${chain.centerId} is missing — the owner would sign in and reach the "no profile" screen`);
  } else {
    if (!KNOWN_PLANS.includes(chain.center.plan)) {
      problems.push(`servicecenters/${chain.centerId}.plan is "${chain.center.plan ?? "(unset)"}", which the app cannot gate on (expected ${KNOWN_PLANS.join(" or ")})`);
    }
    if (chain.center.status && chain.center.status !== "active") {
      problems.push(`servicecenters/${chain.centerId}.status is "${chain.center.status}"`);
    }
  }

  if (!chain.staff) {
    problems.push(`the owner's staff record servicecenters/${chain.centerId}/staff/${chain.uid} is missing`);
  } else if (chain.staff.active === false) {
    problems.push(`the owner's staff record is marked inactive, which signs them straight back out`);
  }

  return problems;
}

/**
 * The gate registerServiceCenter uses before releasing credentials.
 * `{ ok: true }` means: this owner can sign in with their phone number right now.
 */
async function verifyProvisioning({ uid, centerId, loginEmail, plan }) {
  const problems = [];
  const db = admin.firestore();

  // The email the login form will derive must be the one the account was made
  // at. These are the same derivation now (shared/phone.mjs), so a mismatch here
  // means something upstream passed a different number — worth catching loudly.
  let authUser = null;
  try {
    authUser = await admin.auth().getUserByEmail(loginEmail);
  } catch (err) {
    if (err.code === "auth/user-not-found" || err.code === "auth/invalid-email") {
      problems.push(`no Auth account was found at ${loginEmail}`);
    } else {
      throw err;
    }
  }
  if (authUser && authUser.uid !== uid) {
    problems.push(`${loginEmail} resolves to uid ${authUser.uid}, not the ${uid} just created`);
  }
  if (authUser && authUser.disabled) {
    problems.push(`the new Auth account ${loginEmail} is already disabled`);
  }

  const [userIdxSnap, centerSnap, staffSnap] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    db.doc(`servicecenters/${centerId}`).get(),
    db.doc(`servicecenters/${centerId}/staff/${uid}`).get(),
  ]);

  if (!userIdxSnap.exists) {
    problems.push(`users/${uid} was not written`);
  } else {
    const d = userIdxSnap.data();
    if (d.centerId !== centerId) problems.push(`users/${uid}.centerId is "${d.centerId}", expected "${centerId}"`);
    if (d.role !== "Owner") problems.push(`users/${uid}.role is "${d.role}", expected "Owner"`);
  }

  if (!centerSnap.exists) {
    problems.push(`servicecenters/${centerId} was not written`);
  } else if (centerSnap.data().plan !== plan) {
    problems.push(`servicecenters/${centerId}.plan is "${centerSnap.data().plan}", expected "${plan}"`);
  }

  if (!staffSnap.exists) {
    problems.push(`the owner's staff record was not written`);
  } else if (staffSnap.data().active !== true) {
    problems.push(`the owner's staff record is not active`);
  }

  return { ok: problems.length === 0, problems };
}

/**
 * The message the super admin pastes into WhatsApp when handing a centre over.
 *
 * The credentials SMS is capped at one 160-character GSM-7 segment and has no
 * room to explain anything. This does, and it is the message the owner actually
 * keeps. Plain text on purpose: WhatsApp's own markup renders inconsistently
 * across the Android versions these owners run, and a stray asterisk around a
 * password is a support call.
 */
function buildHandoverMessage({ centerName, ownerName, loginPhone, password }) {
  return [
    `Hello ${ownerName},`,
    ``,
    `Your PitStopIQ account for ${centerName} is ready.`,
    ``,
    `Login phone: ${loginPhone}`,
    `Password: ${password}`,
    ``,
    `Open ${"https://app.pitstopiq.com/login"} and sign in with the number above.`,
    `You can type it as ${loginPhone} or +94${loginPhone.slice(1)} — both work.`,
    ``,
    `Please change your password after your first login.`,
    `Any problems, message us on 071 110 0800.`,
  ].join("\n");
}

module.exports = {
  KNOWN_PLANS,
  findAuthUserByPhone,
  describeAccountChain,
  problemsWithChain,
  verifyProvisioning,
  buildHandoverMessage,
};
