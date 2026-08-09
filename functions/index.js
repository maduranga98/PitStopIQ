/**
 * PitStop IQ Cloud Functions
 *
 * Triggers on smsLogs documents created by the app and dispatches the
 * SMS through Dialog eSMS POST API v2 (https://esms.dialog.lk/).
 *
 * Config — set in functions/.env (gitignored) or via Firebase secrets:
 *   ESMS_USERNAME   eSMS account username (mobile number, e.g. 947XXXXXXXX)
 *   ESMS_PASSWORD   eSMS account password
 *   ESMS_MASK       Default sender mask shown to recipients (max 11 chars)
 *
 * Token lifecycle: POST /api/v2/user/login → JWT valid 12 h.
 * The token is cached in module scope across warm invocations and refreshed
 * automatically when it is within 5 minutes of expiry.
 */

const { setGlobalOptions } = require("firebase-functions");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();
setGlobalOptions({ maxInstances: 10 });

const ESMS_LOGIN_URL = "https://esms.dialog.lk/api/v2/user/login";
const ESMS_SMS_URL   = "https://e-sms.dialog.lk/api/v2/sms";

// Public app URLs used inside outbound SMS messages.
const PUBLIC_APP_BASE  = "https://app.pitstopiq.com";
const PUBLIC_LOGIN_URL = `${PUBLIC_APP_BASE}/login`;
// App host (no scheme) for short customer links inside SMS — keeps them tiny.
// Uses app.pitstopiq.com (which serves the /v/ resolver route); the apex
// pitstopiq.com is a separate hosting target for the marketing site.
const SHORTLINK_HOST   = "app.pitstopiq.com";

const ESMS_USERNAME = process.env.ESMS_USERNAME || "";
const ESMS_PASSWORD = process.env.ESMS_PASSWORD || "";
// Hardcoded: the sender masks approved for this account with Dialog eSMS.
// Any other value (e.g. a per-center override) is ignored to prevent errCode 108.
const ESMS_MASK     = "PitStopIQ";
const APPROVED_MASKS = ["PitStopIQ", "Lumora Tech"];

// Module-level token cache (survives warm starts).
let _cachedToken    = null;
let _tokenExpiresAt = 0; // epoch ms

/**
 * Return a valid Bearer token, re-authenticating when expired or missing.
 * Token expiry is 12 h (43 200 s); we refresh 5 min early.
 */
async function getAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpiresAt) {
    return _cachedToken;
  }

  const res = await fetch(ESMS_LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: ESMS_USERNAME, password: ESMS_PASSWORD }),
  });

  const json = await res.json();

  if (json.status !== "success" || !json.token) {
    throw new Error(
      `eSMS login failed (errCode ${json.errCode}): ${json.comment}`
    );
  }

  _cachedToken    = json.token;
  // expiration is in seconds; subtract 5-minute safety margin
  _tokenExpiresAt = Date.now() + (json.expiration - 300) * 1000;

  logger.info("eSMS token refreshed", { expiresIn: json.expiration });
  return _cachedToken;
}

/**
 * Normalise any Sri Lankan phone number format to the 9-digit form the
 * eSMS POST API expects (7XXXXXXXX).
 *
 *   +94711234567 → 711234567
 *    94711234567 → 711234567
 *    0711234567  → 711234567
 *     711234567  → 711234567
 *
 * Returns null when the input cannot be parsed.
 */
function normaliseMsisdn(raw) {
  const s = String(raw || "").replace(/[\s\-()+]/g, "");
  if (/^94\d{9}$/.test(s))  return s.slice(2);  // 94 + 9 digits → strip prefix
  if (/^0\d{9}$/.test(s))   return s.slice(1);  // 0 + 9 digits  → strip leading 0
  if (/^\d{9}$/.test(s))    return s;            // already 9 digits
  return null;
}

/**
 * Derive a numeric transaction_id from the Firestore logId.
 * The eSMS API requires a unique integer of 1–18 digits.
 * We use the current timestamp (13 digits) which is always unique enough
 * for per-document dispatches and stays within JS safe integer range.
 */
function makeTransactionId() {
  // Date.now() is always 13 digits — well within Number.MAX_SAFE_INTEGER.
  // Appending a 4-digit random suffix avoids collisions within the same ms.
  const suffix = Math.floor(Math.random() * 10000);
  const padded = String(suffix).padStart(4, "0");
  const id = Number(`${Date.now()}${padded}`.slice(0, 16));
  return id;
}

// Next 8:00 AM Asia/Colombo (UTC+5:30) as a Firestore Timestamp.
function nextMorningLkt() {
  const now = new Date();
  // Shift to LKT (no DST in Sri Lanka)
  const lktNow = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const lktTarget = new Date(lktNow);
  lktTarget.setUTCHours(8, 0, 0, 0);
  if (lktNow.getUTCHours() >= 8) {
    lktTarget.setUTCDate(lktTarget.getUTCDate() + 1);
  }
  // Convert back to UTC
  return new Date(lktTarget.getTime() - 5.5 * 60 * 60 * 1000);
}

// Common non-GSM-7 punctuation → GSM-7-safe equivalents. A single character
// outside the GSM-7 alphabet (e.g. a "—" em-dash or a smart quote) forces the
// carrier to encode the WHOLE message as UCS-2, which fits only 70 chars per
// segment instead of 160 — more than doubling the cost of an otherwise-English
// SMS. Mapping these back keeps such messages on the cheaper GSM-7 encoding.
// Sinhala/Tamil letters are intentionally left untouched.
const GSM7_SUBSTITUTIONS = {
  "—": "-", "–": "-", "‒": "-", "−": "-", // — – ‒ −
  "‘": "'", "’": "'", "‚": "'", "′": "'", // ‘ ’ ‚ ′
  "“": '"', "”": '"', "„": '"', "″": '"', // “ ” „ ″
  "…": "...",                                             // …
  " ": " ", " ": " ", " ": " ",                 // no-break spaces
  "•": "*", "·": ".", "×": "x",                 // • · ×
};

// GSM 03.38 basic set — anything here encodes as a single 7-bit septet.
const GSM7_BASIC = new Set(
  [
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?",
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
  ].join(""),
);
// GSM 03.38 extension set — each costs TWO septets (an escape + char).
const GSM7_EXTENDED = new Set([..."\f^{}\\[~]|€"]);

/**
 * Number of SMS segments (credits) a message will bill as, mirroring
 * src/lib/smsTemplates.ts analyzeSms(): GSM-7 is 160 chars single / 153 per
 * segment once split; a single non-GSM-7 character forces UCS-2 (Unicode),
 * which is only 70 / 67. Run on the already-sanitised body — the same text
 * actually handed to the gateway — so the credit count matches what's sent.
 */
function computeSmsSegments(text) {
  let isGsm7 = true;
  let septets = 0;
  for (const ch of text) {
    if (GSM7_BASIC.has(ch)) septets += 1;
    else if (GSM7_EXTENDED.has(ch)) septets += 2;
    else { isGsm7 = false; break; }
  }
  if (isGsm7) return septets <= 160 ? 1 : Math.ceil(septets / 153);
  const units = text.length; // UTF-16 code units == UCS-2 code units
  return units <= 70 ? 1 : Math.ceil(units / 67);
}

/**
 * Strip characters the Dialog eSMS gateway cannot handle and normalise
 * typographic punctuation so English messages stay on the cheaper GSM-7
 * encoding. Emoji and other astral-plane (non-BMP, 4-byte UTF-8) characters make
 * the gateway return a generic HTTP 500 / errCode 101 ("Error occurred"). BMP
 * text — including Sinhala and Tamil — is unaffected. We also drop zero-width
 * joiners and variation selectors that are only meaningful as part of emoji
 * sequences.
 */
function sanitizeForEsms(raw) {
  let out = "";
  for (const ch of String(raw || "")) {
    const sub = GSM7_SUBSTITUTIONS[ch];
    if (sub !== undefined) { out += sub; continue; } // fold to GSM-7 equivalent
    const cp = ch.codePointAt(0);
    if (cp > 0xffff) continue; // emoji / astral-plane characters
    if (cp === 0x200d || cp === 0xfe0f) continue; // ZWJ / variation selector
    out += ch;
  }
  // Collapse any spaces left where an emoji used to sit, but keep newlines.
  return out.replace(/[ \t]{2,}/g, " ").replace(/ +\n/g, "\n").trim();
}

/**
 * Normalize an LK phone number to 9-digit local format (7XXXXXXXX).
 * Returns null if unparseable.
 */
function normalisePhone(raw) {
  const s = String(raw || "").replace(/[\s\-()+]/g, "");
  if (/^94\d{9}$/.test(s)) return s.slice(2);
  if (/^0\d{9}$/.test(s)) return s.slice(1);
  if (/^\d{9}$/.test(s)) return s;
  return null;
}

/**
 * createStaffAccount — callable function to create a Firebase Auth account
 * for a staff member and send login credentials via SMS.
 *
 * Called from AddEditEmployeePage when "System Login Access" is enabled.
 *
 * Expected payload: { centerId, staffId, phone, fullName, role, password }
 */
/**
 * registerServiceCenter — super admin callable to onboard a new service center.
 *
 * Creates:
 *  - Firebase Auth account for the owner (phone-based email)
 *  - /servicecenters/{centerId} document
 *  - /servicecenters/{centerId}/staff/{uid} owner record
 *  - /users/{uid} index document
 *
 * Returns: { success, centerId, ownerUid, loginEmail, password }
 */
exports.registerServiceCenter = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  // Verify caller is a super admin
  const adminSnap = await admin.firestore().doc(`superadmins/${request.auth.uid}`).get();
  if (!adminSnap.exists) {
    throw new HttpsError("permission-denied", "Super admin access required.");
  }

  const {
    centerName, centerPhone, address, district,
    ownerName, ownerPhone, plan, password,
    adminId, adminName,
  } = request.data;

  if (!centerName || !centerPhone || !address || !district || !ownerName || !ownerPhone || !plan || !password) {
    throw new HttpsError("invalid-argument", "Missing required fields.");
  }

  const normalised = normalisePhone(ownerPhone);
  if (!normalised) {
    throw new HttpsError("invalid-argument", `Phone number "${ownerPhone}" is invalid.`);
  }
  // The owner signs in with this number, and the login form only maps mobile
  // numbers to a login email. Registering a landline here would mint an account
  // its owner could never reach — and they'd also never receive the credentials
  // SMS below. Reject it here instead, while it can still be corrected.
  if (!/^7\d{8}$/.test(normalised)) {
    throw new HttpsError(
      "invalid-argument",
      `Owner phone "${ownerPhone}" is not a mobile number. Use a 07XXXXXXXX mobile — the owner signs in with it and their credentials are sent there by SMS.`
    );
  }

  const loginEmail = `${normalised}@pitstopiq.app`;

  // Check for duplicate owner phone across all service centers
  const ownerPhoneVariants = [ownerPhone, normalised, `0${normalised}`, `+94${normalised}`, `94${normalised}`];
  const ownerPhoneSnap = await admin.firestore()
    .collection("servicecenters")
    .where("ownerPhone", "in", ownerPhoneVariants)
    .limit(1)
    .get();
  if (!ownerPhoneSnap.empty) {
    throw new HttpsError(
      "already-exists",
      `Owner mobile number "${ownerPhone}" is already registered with another service center.`
    );
  }

  // Check for duplicate center phone across all service centers
  const normalisedCenter = normalisePhone(centerPhone);
  if (normalisedCenter) {
    const centerPhoneVariants = [centerPhone, normalisedCenter, `0${normalisedCenter}`, `+94${normalisedCenter}`, `94${normalisedCenter}`];
    const centerPhoneSnap = await admin.firestore()
      .collection("servicecenters")
      .where("phone", "in", centerPhoneVariants)
      .limit(1)
      .get();
    if (!centerPhoneSnap.empty) {
      throw new HttpsError(
        "already-exists",
        `Service center phone number "${centerPhone}" is already registered with another service center.`
      );
    }
  }

  let uid;
  try {
    const userRecord = await admin.auth().createUser({
      email: loginEmail,
      password,
      displayName: ownerName,
    });
    uid = userRecord.uid;
  } catch (err) {
    if (err.code === "auth/email-already-exists") {
      throw new HttpsError(
        "already-exists",
        `Owner mobile number "${ownerPhone}" is already registered. Please use a different mobile number.`
      );
    }
    logger.error("registerServiceCenter: auth create failed", err);
    throw new HttpsError("internal", `Failed to create account: ${err.message}`);
  }

  // centerId == ownerUid (matches existing convention)
  const centerId = uid;

  const smsQuotaLimit = plan === "pro" ? 1000 : 200;

  // Generate a short unique payment reference code (e.g. PSQ-AB12C)
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "PSQ-";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];

  try {
    await admin.firestore().doc(`servicecenters/${centerId}`).set({
      id: centerId,
      name: centerName,
      phone: centerPhone,
      address,
      district,
      smsSenderName: "PitStopIQ",
      reminderCooldownDays: 30,
      plan,
      ownerId: uid,
      ownerName,
      ownerPhone,
      status: "active",
      registeredByAdminId: adminId,
      smsQuotaUsed: 0,
      smsQuotaLimit,
      paymentCode: code,
      // Multi-branch: this is always the primary branch at registration time.
      ownerUid: uid,
      isBranch: false,
      primaryCenterId: null,
      monthlyRate: plan === "pro" ? 7999 : 4999,
      isActive: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await admin.firestore().doc(`servicecenters/${centerId}/staff/${uid}`).set({
      id: uid,
      authUid: uid,
      email: loginEmail,
      fullName: ownerName,
      phone: ownerPhone,
      role: "Owner",
      centerId,
      active: true,
      hasLogin: true,
      loginPhone: ownerPhone,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await admin.firestore().doc(`users/${uid}`).set({
      centerId,
      role: "Owner",
      email: loginEmail,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    logger.error("registerServiceCenter: Firestore write failed", err);
    // The auth account already exists at this point. Leaving it behind creates
    // exactly the failure this whole flow is meant to avoid: an owner who can
    // sign in successfully and land nowhere, because no service center is
    // attached to their uid — and a super admin who can't re-register the same
    // number because the email is taken. Roll the account back so the retry is
    // clean, and remove any documents that did land.
    try {
      await admin.auth().deleteUser(uid);
      await Promise.all([
        admin.firestore().doc(`servicecenters/${centerId}/staff/${uid}`).delete(),
        admin.firestore().doc(`servicecenters/${centerId}`).delete(),
        admin.firestore().doc(`users/${uid}`).delete(),
      ]);
    } catch (cleanupErr) {
      logger.error("registerServiceCenter: rollback failed — orphaned account", {
        uid, centerId, error: cleanupErr.message,
      });
      throw new HttpsError(
        "internal",
        `Failed to save service center data (${err.message}), and the partially created ` +
        `account could not be removed. Contact engineering before retrying — uid ${uid}.`
      );
    }
    throw new HttpsError(
      "internal",
      `Failed to save service center data: ${err.message}. Nothing was created — you can retry with the same details.`
    );
  }

  // Send the owner their login credentials via SMS using the existing
  // smsLogs dispatch pipeline. Best-effort — registration has already
  // succeeded even if this fails.
  try {
    const loginPhone = `0${normalised}`;
    // Keep this within a single 160-character GSM-7 SMS segment: drop the
    // centre name, the blank lines and the sign-off, and use single newlines.
    // With a 10-digit login phone and a 12-char password this resolves to
    // ~154 chars, so the owner's credentials cost exactly one SMS segment.
    const smsMessage =
      `Welcome to PitStopIQ. Your service center has been registered.\n` +
      `Login Phone: ${loginPhone}\nPassword: ${password}\nLog in here:\n${PUBLIC_LOGIN_URL}`;

    await admin.firestore()
      .collection(`servicecenters/${centerId}/smsLogs`)
      .add({
        phone: ownerPhone,
        message: smsMessage,
        messageType: "Invitation",
        customerName: ownerName,
        status: "sent",
        // sentAt is required: the SMS Log page orders by it, and Firestore
        // drops documents that are missing the orderBy field.
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
  } catch (err) {
    logger.error("registerServiceCenter: failed to queue credentials SMS", err);
  }

  logger.info("registerServiceCenter: success", { centerId, uid, adminId });
  return { success: true, centerId, ownerUid: uid, loginEmail, password };
});

exports.createStaffAccount = onCall(async (request) => {
  // Must be authenticated
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const { centerId, staffId, phone, fullName, role, password } = request.data;

  if (!centerId || !staffId || !phone || !fullName || !role || !password) {
    throw new HttpsError("invalid-argument", "Missing required fields.");
  }

  // Verify the caller is an Owner of this service center
  const callerUid = request.auth.uid;
  const callerDoc = await admin.firestore()
    .doc(`servicecenters/${centerId}/staff/${callerUid}`)
    .get();

  if (!callerDoc.exists || callerDoc.data().role !== "Owner") {
    throw new HttpsError("permission-denied", "Only Owners can create staff logins.");
  }

  // Build the internal email from the phone number
  const normalised = normalisePhone(phone);
  if (!normalised) {
    throw new HttpsError("invalid-argument", `Phone number "${phone}" is invalid.`);
  }
  // Same rule as registerServiceCenter: the staff member signs in with this
  // number and receives their credentials by SMS, so a non-mobile would create
  // a login they can neither reach nor be told about.
  if (!/^7\d{8}$/.test(normalised)) {
    throw new HttpsError(
      "invalid-argument",
      `Phone number "${phone}" is not a mobile number. Use a 07XXXXXXXX mobile — the staff member signs in with it and their credentials are sent there by SMS.`
    );
  }
  const staffEmail = `${normalised}@pitstopiq.app`;

  let uid;
  try {
    // Try to create the Firebase Auth user
    const userRecord = await admin.auth().createUser({
      email: staffEmail,
      password,
      displayName: fullName,
    });
    uid = userRecord.uid;
  } catch (err) {
    if (err.code === "auth/email-already-exists") {
      // The phone number already maps to a Firebase Auth account. Before
      // touching it, make sure it isn't an account belonging to a *different*
      // service center — otherwise an Owner could reset the password of any
      // other center's owner/staff (full account takeover) just by entering
      // their phone number here.
      const existing = await admin.auth().getUserByEmail(staffEmail);
      const existingUid = existing.uid;

      // A pre-existing users-index doc pointing at another center, or an
      // owner/staff record under another center, means this account is not
      // ours to re-provision.
      const [indexSnap, legacyCenterSnap, sameStaffSnap] = await Promise.all([
        admin.firestore().doc(`users/${existingUid}`).get(),
        admin.firestore().doc(`servicecenters/${existingUid}`).get(),
        admin.firestore().doc(`servicecenters/${centerId}/staff/${existingUid}`).get(),
      ]);

      const belongsToThisCenter =
        (indexSnap.exists && indexSnap.data().centerId === centerId) ||
        sameStaffSnap.exists ||
        // Re-provisioning the same staff row we were asked to attach to.
        existingUid === staffId;

      const belongsToAnotherCenter =
        (indexSnap.exists && indexSnap.data().centerId && indexSnap.data().centerId !== centerId) ||
        // Legacy owner accounts use centerId == uid; such an account is the
        // owner of its own center and must never be re-pointed here.
        (legacyCenterSnap.exists && existingUid !== centerId);

      if (belongsToAnotherCenter || !belongsToThisCenter) {
        logger.warn("createStaffAccount: blocked cross-center account reuse", {
          centerId, staffId, existingUid, callerUid,
        });
        throw new HttpsError(
          "already-exists",
          `Phone number "${phone}" is already registered to another account. Use a different mobile number.`,
        );
      }

      // Safe: this account is already part of this center — refresh the
      // password/display name for the re-provisioned staff login.
      uid = existingUid;
      await admin.auth().updateUser(uid, { password, displayName: fullName });
    } else {
      logger.error("createStaffAccount: auth create failed", err);
      throw new HttpsError("internal", `Failed to create account: ${err.message}`);
    }
  }

  // Create/update the users index document (uid → { centerId, role }) so the
  // client can resolve this staff member's identity on login.
  await admin.firestore().doc(`users/${uid}`).set({
    centerId,
    role,
    email: staffEmail,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  // The staff document MUST be keyed by the Firebase Auth uid. Both the
  // Firestore security rules (isMember/hasRole read staff/{request.auth.uid})
  // and the client's login-time active check (staff/{user.uid}) look the member
  // up by uid — a staff doc stored under any other id is invisible to them, so
  // the freshly-authenticated staff member is bounced straight back to /login.
  //
  // The record is first created from the client with a random auto-id (the auth
  // uid isn't known until the account is created here), so migrate it onto the
  // uid-keyed doc and delete the stray random-id doc. Owners already register
  // straight onto staff/{uid}, so for them staffId === uid and this is a no-op.
  const staffCol = admin.firestore().collection(`servicecenters/${centerId}/staff`);
  const sourceSnap = await staffCol.doc(staffId).get();
  const sourceData = sourceSnap.exists ? sourceSnap.data() : {};

  await staffCol.doc(uid).set({
    ...sourceData,
    id: uid,
    authUid: uid,
    role,
    centerId,
    active: sourceData.active !== false,
    hasLogin: true,
    loginPhone: phone,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  if (staffId !== uid && sourceSnap.exists) {
    await staffCol.doc(staffId).delete();
  }

  // Send login credentials via SMS using existing smsLogs infrastructure
  const localPhone = phone.replace(/\D/g, "").startsWith("94")
    ? `0${phone.replace(/\D/g, "").slice(2)}`
    : phone.replace(/\D/g, "").startsWith("7") && phone.replace(/\D/g, "").length === 9
      ? `0${phone.replace(/\D/g, "")}`
      : phone;

  const smsMessage = `PitStopIQ Login Credentials:\nUsername: ${localPhone}\nPassword: ${password}\n\nLog in here:\n${PUBLIC_LOGIN_URL}`;

  await admin.firestore()
    .collection(`servicecenters/${centerId}/smsLogs`)
    .add({
      phone,
      message: smsMessage,
      type: "staff_credentials",
      messageType: "Invitation",
      customerName: fullName,
      status: "sent",
      staffId,
      // sentAt is required: the SMS Log page orders by it, and Firestore
      // drops documents that are missing the orderBy field.
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

  logger.info("createStaffAccount: success", { staffId, uid, centerId });
  return { success: true, uid };
});

/**
 * repairStaffLogins — heal staff accounts created before staff docs were keyed
 * by the Firebase Auth uid. Such docs live under a random auto-id with the real
 * uid only in an `authUid` field, which makes them invisible to the security
 * rules (isMember/hasRole read staff/{uid}) and to the login active check, so
 * the affected Manager/Cashier/Technician can authenticate but is immediately
 * signed back out. This copies each mis-keyed doc onto staff/{authUid} and
 * deletes the stray, without touching Firebase Auth credentials. Owner-only,
 * idempotent — running it when nothing is broken is a no-op.
 */
/**
 * checkLoginAccount — tells a failed sign-in *why* it failed.
 *
 * Firebase projects with email enumeration protection enabled (the default)
 * collapse "no such account" and "wrong password" into one opaque
 * INVALID_LOGIN_CREDENTIALS, by design: it stops an attacker probing which
 * accounts exist. That also means the owner — and support — cannot tell a
 * mistyped password from a number that was never registered, which is exactly
 * the confusion this endpoint resolves.
 *
 * It deliberately gives back the enumeration signal that protection hides, so
 * it is throttled per caller IP. Logins here are admin-provisioned business
 * numbers rather than public sign-ups, which makes the trade worthwhile, but
 * it IS a trade — see the PR description.
 *
 * Expected payload: { loginId }  (phone number or email, as typed)
 * Returns: { exists, disabled }
 */
const LOGIN_CHECK_MAX_PER_HOUR = 20;

exports.checkLoginAccount = onCall({ invoker: "public" }, async (request) => {
  const { loginId } = request.data || {};
  if (!loginId || typeof loginId !== "string") {
    throw new HttpsError("invalid-argument", "Missing loginId.");
  }

  // Throttle by caller IP so this can't be used to sweep the number space.
  const ip = request.rawRequest?.ip || "unknown";
  const bucketId = Buffer.from(ip).toString("base64url").slice(0, 128);
  const bucketRef = admin.firestore().doc(`loginCheckThrottle/${bucketId}`);
  const windowStart = Date.now() - 60 * 60 * 1000;
  try {
    const allowed = await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(bucketRef);
      const hits = (snap.exists ? snap.data().hits || [] : [])
        .filter((ms) => ms > windowStart);
      if (hits.length >= LOGIN_CHECK_MAX_PER_HOUR) return false;
      hits.push(Date.now());
      tx.set(bucketRef, { hits, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      return true;
    });
    if (!allowed) {
      logger.warn("checkLoginAccount: throttled", { ip });
      throw new HttpsError("resource-exhausted", "Too many checks. Please try again later.");
    }
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    // A throttle-store failure must not break the diagnosis; log and continue.
    logger.error("checkLoginAccount: throttle check failed", err);
  }

  // Same mapping the login form uses: a local number becomes the synthetic
  // login email, anything else is treated as an email already.
  const normalised = normalisePhone(loginId);
  const email = normalised ? `${normalised}@pitstopiq.app` : String(loginId).trim();

  try {
    const user = await admin.auth().getUserByEmail(email);
    return { exists: true, disabled: Boolean(user.disabled) };
  } catch (err) {
    if (err.code === "auth/user-not-found" || err.code === "auth/invalid-email") {
      return { exists: false, disabled: false };
    }
    logger.error("checkLoginAccount: lookup failed", { error: err.message });
    throw new HttpsError("internal", "Could not check this account.");
  }
});

/**
 * resetOwnerPassword — super admin callable to set a new password on a service
 * center owner's login and SMS it to them.
 *
 * Phone-provisioned accounts (owner logins minted by registerServiceCenter)
 * use a synthetic @pitstopiq.app email that receives no mail, so Firebase's
 * own password-reset email can never reach them. Without this there is no
 * recovery path at all: a forgotten or mistyped password locks the owner out
 * permanently, and the duplicate-phone check blocks re-registering them.
 *
 * Expected payload: { centerId, password }
 * Returns: { success, loginPhone, password }
 */
exports.resetOwnerPassword = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const adminSnap = await admin.firestore().doc(`superadmins/${request.auth.uid}`).get();
  if (!adminSnap.exists) {
    throw new HttpsError("permission-denied", "Super admin access required.");
  }

  const { centerId, password } = request.data || {};
  if (!centerId || !password) {
    throw new HttpsError("invalid-argument", "Missing centerId or password.");
  }
  if (String(password).length < 6) {
    throw new HttpsError("invalid-argument", "Password must be at least 6 characters.");
  }

  const centerSnap = await admin.firestore().doc(`servicecenters/${centerId}`).get();
  if (!centerSnap.exists) {
    throw new HttpsError("not-found", "Service center not found.");
  }
  const center = centerSnap.data();

  // Reset the owner of this center only — never an arbitrary uid from the
  // request, which would let a compromised admin session retarget any account.
  const ownerUid = center.ownerUid || center.ownerId;
  if (!ownerUid) {
    throw new HttpsError("failed-precondition", "This service center has no owner account on record.");
  }

  try {
    await admin.auth().updateUser(ownerUid, { password });
  } catch (err) {
    logger.error("resetOwnerPassword: update failed", { centerId, ownerUid, error: err.message });
    if (err.code === "auth/user-not-found") {
      throw new HttpsError(
        "not-found",
        "The owner's login account no longer exists in Firebase Auth. It has to be re-created before a password can be set."
      );
    }
    throw new HttpsError("internal", `Failed to reset password: ${err.message}`);
  }

  const normalised = normalisePhone(center.ownerPhone);
  const loginPhone = normalised ? `0${normalised}` : center.ownerPhone;

  // Best-effort: the reset has already succeeded, and the super admin is shown
  // the new password on screen regardless of whether the SMS goes out.
  try {
    const smsMessage =
      `PitStopIQ password reset.\n` +
      `Login Phone: ${loginPhone}\nNew Password: ${password}\nLog in here:\n${PUBLIC_LOGIN_URL}`;

    await admin.firestore()
      .collection(`servicecenters/${centerId}/smsLogs`)
      .add({
        phone: center.ownerPhone,
        message: smsMessage,
        messageType: "Invitation",
        customerName: center.ownerName || "Owner",
        status: "sent",
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
  } catch (err) {
    logger.error("resetOwnerPassword: failed to queue SMS", err);
  }

  logger.info("resetOwnerPassword: success", { centerId, ownerUid, adminUid: request.auth.uid });
  return { success: true, loginPhone, password };
});

exports.repairStaffLogins = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const { centerId } = request.data || {};
  if (!centerId) {
    throw new HttpsError("invalid-argument", "Missing centerId.");
  }

  const callerUid = request.auth.uid;
  const callerDoc = await admin.firestore()
    .doc(`servicecenters/${centerId}/staff/${callerUid}`)
    .get();

  if (!callerDoc.exists || callerDoc.data().role !== "Owner") {
    throw new HttpsError("permission-denied", "Only Owners can repair staff logins.");
  }

  const staffCol = admin.firestore().collection(`servicecenters/${centerId}/staff`);
  const snap = await staffCol.get();

  let repaired = 0;
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const targetUid = data.authUid;
    // A doc is broken only when it has a login uid that differs from its id.
    if (!data.hasLogin || !targetUid || targetUid === docSnap.id) continue;

    await staffCol.doc(targetUid).set({
      ...data,
      id: targetUid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    await staffCol.doc(docSnap.id).delete();

    // Keep the users index pointing this uid at the center so login resolves.
    await admin.firestore().doc(`users/${targetUid}`).set({
      centerId,
      role: data.role,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    repaired += 1;
  }

  logger.info("repairStaffLogins: done", { centerId, repaired });
  return { success: true, repaired };
});

exports.dispatchSmsLog = onDocumentCreated(
  "servicecenters/{centerId}/smsLogs/{logId}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data();
    const { centerId, logId } = event.params;

    // Skip if already terminal or queued for retry (defensive — should not happen on create).
    if (
      data.status === "delivered" ||
      data.status === "failed" ||
      data.status === "pending_blackout"
    ) {
      return;
    }

    if (!ESMS_USERNAME || !ESMS_PASSWORD) {
      logger.error("ESMS_USERNAME / ESMS_PASSWORD not configured", { logId });
      await snap.ref.update({
        status: "failed",
        errorCode: "MISSING_CONFIG",
        errorMessage: "eSMS credentials not configured on the server.",
      });
      return;
    }

    if (!data.message || !String(data.message).trim()) {
      logger.warn("Empty message body", { logId });
      await snap.ref.update({
        status: "failed",
        errorCode: "EMPTY_MESSAGE",
        errorMessage: "SMS body was empty — nothing to send.",
      });
      return;
    }

    const msisdn = normaliseMsisdn(data.phone);
    if (!msisdn) {
      logger.warn("Invalid phone number", { phone: data.phone, logId });
      await snap.ref.update({
        status: "failed",
        errorCode: "INVALID_PHONE",
        errorMessage: `Phone "${data.phone}" is not a valid Sri Lankan mobile number.`,
      });
      return;
    }

    // Use the requested mask only if it's one of the approved ones; otherwise
    // fall back to the default. Unapproved masks trigger errCode 108.
    const mask = APPROVED_MASKS.includes(data.mask) ? data.mask : ESMS_MASK;

    const transactionId = makeTransactionId();

    // Remove emoji / non-BMP characters the gateway rejects with errCode 101.
    const message = sanitizeForEsms(data.message);
    if (!message) {
      logger.warn("Message empty after sanitising", { logId });
      await snap.ref.update({
        status: "failed",
        errorCode: "EMPTY_MESSAGE",
        errorMessage: "SMS body was empty after removing unsupported characters.",
      });
      return;
    }

    const body = {
      msisdn: [{ mobile: msisdn }],
      message,
      transaction_id: transactionId,
      sourceAddress: mask,
      // 0 = pay from the eSMS wallet. Optional per the spec (defaults to 0),
      // but some accounts reject the request as invalid when it is omitted.
      payment_method: 0,
    };

    try {
      const token = await getAccessToken();

      logger.info("eSMS send attempt", {
        logId,
        msisdn,
        transactionId,
        messageLength: message.length,
        mask,
      });

      const res = await fetch(ESMS_SMS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const text = await res.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { /* keep raw */ }

      // The eSMS API returns errCode as a String (e.g. "118"). Normalise it to
      // a Number so the comparisons below behave regardless of the wire type.
      const errCode =
        parsed?.errCode != null && parsed.errCode !== ""
          ? Number(parsed.errCode)
          : null;

      if (!res.ok || (parsed && parsed.status === "failed")) {
        logger.error("eSMS send failed", {
          httpStatus: res.status,
          errCode: parsed?.errCode,
          comment: parsed?.comment,
          logId,
        });
        // If the token was rejected, clear the cache so the next call re-auths.
        if (errCode === 100 || errCode === 105 || errCode === 106) {
          _cachedToken    = null;
          _tokenExpiresAt = 0;
        }

        // errCode 118 — eSMS blackout window (8:00 PM – 8:00 AM LKT).
        // Park the message instead of failing it so a retry job can pick it up.
        if (errCode === 118) {
          await snap.ref.update({
            status: "pending_blackout",
            errorCode: "ESMS_118",
            errorMessage:
              "eSMS blackout window (8 PM – 8 AM LKT). Will retry after 8 AM.",
            retryAfter: admin.firestore.Timestamp.fromDate(nextMorningLkt()),
            providerResponse: parsed ?? text,
            senderMask: mask,
            esmsTransactionId: transactionId,
          });
          return;
        }

        const errorMessage =
          errCode === 101 || errCode === 107
            ? `eSMS rejected the request parameters (errCode ${errCode})${
                parsed?.comment ? `: ${parsed.comment}` : "."
              }`
            : errCode === 114
            ? "eSMS rejected the request (errCode 114). Not enough Dialog eSMS wallet balance to run the campaign."
            : errCode === 108
            ? "Sender mask not approved by eSMS. Clear the SMS Sender Name in settings, or register the mask with Dialog eSMS."
            : parsed?.comment || `HTTP ${res.status}`;
        await snap.ref.update({
          status: "failed",
          errorCode: errCode != null ? `ESMS_${errCode}` : `HTTP_${res.status}`,
          errorMessage,
          providerResponse: parsed ?? text,
          senderMask: mask,
          esmsTransactionId: transactionId,
        });
        return;
      }

      logger.info("eSMS send ok", { logId, campaignId: parsed?.data?.campaignId });
      await snap.ref.update({
        status: "delivered",
        providerResponse: parsed ?? text,
        deliveredAt: admin.firestore.FieldValue.serverTimestamp(),
        esmsTransactionId: transactionId,
        esmsCampaignId: parsed?.data?.campaignId ?? null,
        senderMask: mask,
      });

      // Increment SMS quota counter on the center by however many segments
      // this message actually billed as (a message over 160 GSM-7 chars /
      // 70 Unicode chars counts as 2+ credits, not 1).
      try {
        const segments = computeSmsSegments(message);
        await admin
          .firestore()
          .doc(`servicecenters/${centerId}`)
          .update({
            smsQuotaUsed: admin.firestore.FieldValue.increment(segments),
          });
      } catch (err) {
        logger.warn("Quota increment failed", err);
      }
    } catch (err) {
      logger.error("eSMS dispatch error", err);
      // Clear token cache on unexpected errors so the next attempt re-auths.
      _cachedToken    = null;
      _tokenExpiresAt = 0;
      await snap.ref.update({
        status: "failed",
        errorCode: "NETWORK_ERROR",
        errorMessage: "Network error reaching eSMS. Retry from the SMS Log.",
        providerResponse: String(err),
      });
    }
  },
);

// ── Time-based service reminders ─────────────────────────────────────────────
//
// Once a vehicle has been serviced twice we can derive how often the customer
// services that vehicle (serviceIntervalDays) and predict the next due date
// (nextServiceDate). This scheduled job runs daily, finds vehicles whose next
// service is due within REMINDER_LEAD_DAYS, and sends a reminder SMS in the
// customer's preferred language — adding real value beyond the mileage SMS.

const REMINDER_LEAD_DAYS = 3;

// Default reminder templates mirror src/lib/smsTemplates.ts. Owners may override
// per-language via the reminderSmsTemplate* fields on the service center.
// Cost-optimised reminder defaults — mirror of src/lib/smsTemplates.ts. Kept
// short and single-line, with a plain "-" (not "—") so the English variant
// stays on the cheaper GSM-7 encoding. Owners may override per language via the
// reminderSmsTemplate* fields on the service center.
const DEFAULT_REMINDER_TEMPLATES = {
  english:
    "Hi {CustomerName}, {Plate} is due for service (now {CurrentKm} km, next {NextServiceMileage} km). History: {ViewLink} - {CenterName}",
  sinhala:
    "{CustomerName}, ඔබගේ {Plate} සේවාවට නියමිතයි (දැන් {CurrentKm} km, ඊළඟ {NextServiceMileage} km). {ViewLink} - {CenterName}",
  tamil:
    "{CustomerName}, {Plate} சேவைக்கு உரியது (இப்போது {CurrentKm} km, அடுத்து {NextServiceMileage} km). {ViewLink} - {CenterName}",
};

function reminderTemplateField(lang) {
  return lang === "sinhala" ? "reminderSmsTemplateSi"
    : lang === "tamil" ? "reminderSmsTemplateTa"
    : "reminderSmsTemplate";
}

// Mirror of src/lib/shortLinks.ts. Returns a stable 7-char code for a customer,
// minting (and caching on the customer doc) one on first use. Used so reminder
// SMS carry a tiny "pitstopiq.com/v/{code}" link instead of the ~70-char URL.
const SHORTLINK_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function randomShortCode() {
  let out = "";
  for (let i = 0; i < 7; i++) {
    out += SHORTLINK_ALPHABET[Math.floor(Math.random() * SHORTLINK_ALPHABET.length)];
  }
  return out;
}

async function getOrCreateShortLink(centerId, customerId, cachedCode) {
  if (cachedCode) return cachedCode;
  const custRef = admin.firestore().doc(`servicecenters/${centerId}/customers/${customerId}`);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomShortCode();
    const linkRef = admin.firestore().doc(`links/${code}`);
    const linkSnap = await linkRef.get();
    if (linkSnap.exists) continue; // collision — retry
    await linkRef.set({
      centerId,
      customerId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await custRef.update({ shortCode: code }).catch(() => {});
    return code;
  }
  throw new Error("Could not mint a short link");
}

function resolveReminderTemplate(template, data) {
  return template
    .replace(/{CustomerName}/g, data.customerName)
    .replace(/{Plate}/g, String(data.plate || "").toUpperCase())
    .replace(/{CenterName}/g, data.centerName)
    .replace(/{CenterPhone}/g, data.centerPhone)
    .replace(/{CurrentKm}/g, data.currentKm)
    .replace(/{NextServiceMileage}/g, data.nextServiceMileage)
    .replace(/{ViewLink}/g, data.viewLink);
}

exports.sendServiceReminders = onSchedule(
  { schedule: "every day 08:30", timeZone: "Asia/Colombo" },
  async () => {
    const now = admin.firestore.Timestamp.now();
    const cutoff = admin.firestore.Timestamp.fromMillis(
      now.toMillis() + REMINDER_LEAD_DAYS * 24 * 60 * 60 * 1000,
    );

    // Collection-group query across every center's vehicles. This requires a
    // COLLECTION_GROUP-scoped single-field index on nextServiceDate (declared in
    // firestore.indexes.json) — Firestore's automatic single-field indexes are
    // collection-scoped only and do NOT satisfy a collection-group query, so
    // without the override this query throws and no reminders are ever sent.
    // reminderSent is filtered in code.
    const snap = await admin
      .firestore()
      .collectionGroup("vehicles")
      .where("nextServiceDate", "<=", cutoff)
      .get();

    logger.info("sendServiceReminders: candidates", { count: snap.size });

    let sent = 0;
    const centerCache = new Map();

    for (const vDoc of snap.docs) {
      const v = vDoc.data();
      if (v.isDeleted) continue;
      if (v.reminderSent === true) continue; // already reminded this cycle
      if (!v.customerId) continue;

      const centerId = v.centerId;
      if (!centerId) continue;

      try {
        // Load (and cache) the service center for template overrides + phone.
        let center = centerCache.get(centerId);
        if (!center) {
          const cSnap = await admin.firestore().doc(`servicecenters/${centerId}`).get();
          center = cSnap.exists ? cSnap.data() : {};
          centerCache.set(centerId, center);
        }

        // Load the customer for phone + preferred language.
        const custSnap = await admin
          .firestore()
          .doc(`servicecenters/${centerId}/customers/${v.customerId}`)
          .get();
        if (!custSnap.exists) continue;
        const cust = custSnap.data();
        const phone = cust.phone;
        if (!phone) continue;

        const lang = ["english", "sinhala", "tamil"].includes(cust.smsLanguage)
          ? cust.smsLanguage
          : "english";

        const override = center[reminderTemplateField(lang)];
        const template = (typeof override === "string" && override.trim())
          ? override
          : DEFAULT_REMINDER_TEMPLATES[lang];

        // Short link keeps the (UCS-2) Sinhala/Tamil reminder within fewer
        // segments; fall back to the full link if minting fails.
        let viewLink;
        try {
          const code = await getOrCreateShortLink(centerId, v.customerId, cust.shortCode);
          viewLink = `${SHORTLINK_HOST}/v/${code}`;
        } catch (e) {
          viewLink = `${PUBLIC_APP_BASE}/c/${centerId}/${v.customerId}`;
        }
        const message = resolveReminderTemplate(template, {
          customerName: cust.name || "Customer",
          plate: v.plateNumber || "",
          centerName: center.name || "",
          centerPhone: center.phone || "",
          currentKm: String(v.currentMileageKm ?? ""),
          nextServiceMileage: String(v.nextServiceMileageKm ?? ""),
          viewLink,
        });

        // Creating the smsLog triggers dispatchSmsLog, which sends the SMS.
        await admin
          .firestore()
          .collection(`servicecenters/${centerId}/smsLogs`)
          .add({
            customerId: v.customerId,
            customerName: cust.name || "",
            phone,
            vehicleId: vDoc.id,
            plateNumber: v.plateNumber || "",
            messageType: "Reminder",
            status: "sent",
            message,
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });

        // Mark this cycle as reminded so we don't send again until the next
        // completed service resets the flag.
        await vDoc.ref.update({
          reminderSent: true,
          reminderSentAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        sent += 1;
      } catch (err) {
        logger.error("sendServiceReminders: failed for vehicle", {
          vehicleId: vDoc.id,
          error: String(err),
        });
      }
    }

    logger.info("sendServiceReminders: done", { sent });
  },
);

// ── Daily Inspection Photo Cleanup ───────────────────────────────────────────
// Runs at 02:00 Asia/Colombo. Finds inspection docs where nextPhotoDeleteAt has
// passed, deletes the photos from Storage, and marks photosDeleted on the doc.
exports.dailyInspectionCleanup = onSchedule(
  { schedule: "every day 02:00", timeZone: "Asia/Colombo" },
  async () => {
    const now = admin.firestore.Timestamp.now();

    const snap = await admin
      .firestore()
      .collectionGroup("inspection")
      .where("nextPhotoDeleteAt", "<=", now)
      .where("photosDeleted", "!=", true)
      .get();

    logger.info("dailyInspectionCleanup: candidates", { count: snap.size });

    let cleaned = 0;
    for (const iDoc of snap.docs) {
      const data = iDoc.data();
      const reports = data.damageReports ?? [];

      // Delete each photo from Storage using the download URL path
      for (const report of reports) {
        if (!report.photoUrl || report.photosDeleted) continue;
        try {
          // Extract the storage path from the download URL
          const url = new URL(report.photoUrl);
          // URL format: .../o/PATH?...  — PATH is URL-encoded
          const match = url.pathname.match(/\/o\/(.+)/);
          if (match) {
            const storagePath = decodeURIComponent(match[1]);
            await admin.storage().bucket().file(storagePath).delete().catch(() => {});
          }
        } catch (err) {
          logger.warn("dailyInspectionCleanup: could not delete photo", {
            reportId: report.id,
            error: String(err),
          });
        }
      }

      // Clear photoUrl on each damage report and mark the inspection as cleaned
      const updatedReports = reports.map((r) => ({
        ...r,
        photoUrl: null,
        photosDeleted: true,
      }));

      await iDoc.ref.update({
        damageReports: updatedReports,
        photosDeleted: true,
      });

      cleaned += 1;
    }

    logger.info("dailyInspectionCleanup: done", { cleaned });
  },
);

// ── Cheque & Credit Reminder Push ────────────────────────────────────────────
// The owner-only "Reminders" bell in the app (src/components/NotificationsBell.tsx,
// src/lib/chequeRegister.ts:reminderEntries) reads the register live while the
// app is open. This is the same idea for when it isn't: once a day, count the
// same two things — cheques due within CHEQUE_DUE_WITHIN_DAYS (or already
// overdue) and credit that's been open CREDIT_AGING_DAYS or more — for every
// center with at least one registered device, and push a summary.
//
// Mirrors the pending/kind/due-date logic in src/lib/chequeRegister.ts; kept
// in sync by hand, the same way DEFAULT_REMINDER_TEMPLATES above mirrors
// src/lib/smsTemplates.ts.
const CHEQUE_DUE_WITHIN_DAYS = 3;
const CREDIT_AGING_DAYS = 14;

function countPaymentReminders(payments, now) {
  let cheques = 0;
  let credit = 0;
  const chequeCutoffMs = now.toMillis() + CHEQUE_DUE_WITHIN_DAYS * 24 * 60 * 60 * 1000;
  const creditCutoffMs = now.toMillis() - CREDIT_AGING_DAYS * 24 * 60 * 60 * 1000;

  for (const p of payments || []) {
    if (p.method !== "cheque" && p.method !== "credit") continue;
    if (p.clearance === "cleared" || p.clearance === "returned") continue; // not pending

    if (p.method === "cheque") {
      if (p.chequeDate && p.chequeDate.toMillis() <= chequeCutoffMs) cheques += 1;
    } else {
      const since = p.date || now;
      if (since.toMillis() <= creditCutoffMs) credit += 1;
    }
  }
  return { cheques, credit };
}

exports.sendChequeCreditReminders = onSchedule(
  { schedule: "every day 08:00", timeZone: "Asia/Colombo" },
  async () => {
    const now = admin.firestore.Timestamp.now();

    // No plain field to filter centers by, so start from whoever has a
    // device registered — no point reading a center's whole register if
    // there's nowhere to send the alert.
    const tokenSnap = await admin.firestore().collectionGroup("pushTokens").get();
    const tokensByCenter = new Map();
    for (const t of tokenSnap.docs) {
      const centerId = t.ref.parent.parent.id;
      const list = tokensByCenter.get(centerId) || [];
      list.push({ ref: t.ref, token: (t.data() || {}).token || t.id });
      tokensByCenter.set(centerId, list);
    }

    logger.info("sendChequeCreditReminders: centers with devices", { count: tokensByCenter.size });

    let notified = 0;

    for (const [centerId, tokens] of tokensByCenter) {
      try {
        const [invSnap, orderSnap, supplySnap] = await Promise.all([
          admin.firestore().collection(`servicecenters/${centerId}/invoices`).limit(500).get(),
          admin.firestore().collection(`servicecenters/${centerId}/distributorOrders`).limit(500).get(),
          admin.firestore().collection(`servicecenters/${centerId}/supplierSupplies`).limit(500).get(),
        ]);

        let cheques = 0;
        let credit = 0;
        for (const snap of [invSnap, orderSnap, supplySnap]) {
          for (const d of snap.docs) {
            const r = countPaymentReminders(d.data().payments, now);
            cheques += r.cheques;
            credit += r.credit;
          }
        }

        if (cheques === 0 && credit === 0) continue;

        const parts = [];
        if (cheques > 0) parts.push(`${cheques} cheque${cheques > 1 ? "s" : ""}`);
        if (credit > 0) parts.push(`${credit} credit tab${credit > 1 ? "s" : ""}`);

        const response = await admin.messaging().sendEachForMulticast({
          notification: {
            title: "Cheques & Credits",
            body: `${parts.join(" and ")} need your attention.`,
          },
          data: { url: "/cheques" },
          tokens: tokens.map((t) => t.token),
        });
        notified += 1;

        // Drop tokens the device revoked or uninstalled so this list stays
        // clean and the next run doesn't keep paying to retry them.
        await Promise.all(response.responses.map((r, i) => {
          if (r.success) return null;
          const code = r.error && r.error.code;
          if (code === "messaging/registration-token-not-registered"
            || code === "messaging/invalid-registration-token") {
            return tokens[i].ref.delete().catch(() => {});
          }
          return null;
        }));

        logger.info("sendChequeCreditReminders: sent", {
          centerId, cheques, credit, success: response.successCount, failure: response.failureCount,
        });
      } catch (err) {
        logger.error("sendChequeCreditReminders: failed for center", { centerId, error: String(err) });
      }
    }

    logger.info("sendChequeCreditReminders: done", { notified });
  },
);

// ── Daily Subscription Lifecycle Check ───────────────────────────────────────
// Each servicecenters doc — primary or additional branch — carries its own
// independent billing state, so this runs per-document with no special
// casing for multi-branch: one branch expiring must never affect its
// siblings. Transitions: active → grace_period (once currentPeriodEnd has
// passed) → blocked (once graceDeadline has passed). Also sends a reminder
// SMS to the owner's phone 7 days and 1 day before currentPeriodEnd.
const GRACE_PERIOD_DAYS = 7;
const REMINDER_DAYS_BEFORE = [7, 1];

exports.dailySubscriptionCheck = onSchedule(
  { schedule: "every day 09:00", timeZone: "Asia/Colombo" },
  async () => {
    const now = admin.firestore.Timestamp.now();
    const snap = await admin.firestore()
      .collection("servicecenters")
      .where("status", "in", ["active", "grace_period"])
      .get();

    logger.info("dailySubscriptionCheck: candidates", { count: snap.size });

    let transitioned = 0;
    let reminded = 0;

    for (const cDoc of snap.docs) {
      const center = cDoc.data();
      const centerId = cDoc.id;

      try {
        if (center.status === "active" && center.currentPeriodEnd) {
          if (center.currentPeriodEnd.toMillis() <= now.toMillis()) {
            const graceDeadline = admin.firestore.Timestamp.fromMillis(
              center.currentPeriodEnd.toMillis() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000,
            );
            await cDoc.ref.update({ status: "grace_period", graceDeadline });
            transitioned += 1;
            continue;
          }

          const daysLeft = Math.ceil(
            (center.currentPeriodEnd.toMillis() - now.toMillis()) / (24 * 60 * 60 * 1000),
          );
          if (REMINDER_DAYS_BEFORE.includes(daysLeft) && center.lastReminderSentFor !== daysLeft) {
            const phone = center.ownerPhone;
            if (phone) {
              const branchLabel = center.isBranch ? (center.branchName || center.name) : center.name;
              const message =
                `Hi ${center.ownerName || "there"}, your PitStopIQ subscription for ` +
                `"${branchLabel}" expires in ${daysLeft} day${daysLeft > 1 ? "s" : ""}.\n` +
                `Amount: LKR ${(center.monthlyRate || 0).toLocaleString()}\n` +
                `Log in and upload your slip.\n- Lumora Tech`;

              await admin.firestore()
                .collection(`servicecenters/${centerId}/smsLogs`)
                .add({
                  phone,
                  message,
                  messageType: "Reminder",
                  status: "sent",
                  sentAt: admin.firestore.FieldValue.serverTimestamp(),
                  createdAt: admin.firestore.FieldValue.serverTimestamp(),
                });
              await cDoc.ref.update({ lastReminderSentFor: daysLeft });
              reminded += 1;
            }
          }
        } else if (center.status === "grace_period" && center.graceDeadline) {
          if (center.graceDeadline.toMillis() <= now.toMillis()) {
            await cDoc.ref.update({ status: "blocked" });
            transitioned += 1;
          }
        }
      } catch (err) {
        logger.error("dailySubscriptionCheck: failed for center", { centerId, error: String(err) });
      }
    }

    logger.info("dailySubscriptionCheck: done", { transitioned, reminded });
  },
);

// ── Account Deletion (super-admin approved) ──────────────────────────────────
// An Owner requests deletion from Settings → Danger Zone, which creates an
// `accountDeletionRequests` doc. A super admin approves it, which calls this
// callable to permanently and irreversibly erase the WHOLE account: every
// service center document that owner has (primary + branches), all of their
// sub-collections, the Firebase Auth logins for the owner and every staff
// member, the user-index docs, related top-level request/link docs, and the
// Storage files under each center. There is no undo — the approval is final.
exports.deleteServiceCenter = onCall(async (request) => {
  // Only an authenticated super admin may run this.
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }
  const adminSnap = await admin.firestore().doc(`superadmins/${request.auth.uid}`).get();
  if (!adminSnap.exists) {
    throw new HttpsError("permission-denied", "Only super admins can delete accounts.");
  }

  const { centerId, requestId } = request.data || {};
  if (!centerId) {
    throw new HttpsError("invalid-argument", "centerId is required.");
  }

  const dbRef = admin.firestore();

  // Resolve the owner behind this center so we can delete the whole account
  // (primary center + every additional branch that owner has).
  const centerSnap = await dbRef.doc(`servicecenters/${centerId}`).get();
  if (!centerSnap.exists) {
    // The center is already gone — just settle the request and return.
    if (requestId) {
      await dbRef.doc(`accountDeletionRequests/${requestId}`).update({
        status: "completed",
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        completedBy: request.auth.uid,
      }).catch(() => {});
    }
    return { success: true, deletedCenters: [], deletedUsers: 0, alreadyGone: true };
  }
  const center = centerSnap.data();
  const ownerUid = center.ownerUid || center.ownerId || centerId;

  // Gather every center document belonging to this owner.
  const centerIds = new Set([centerId]);
  try {
    const owned = await dbRef.collection("servicecenters").where("ownerUid", "==", ownerUid).get();
    owned.docs.forEach((d) => centerIds.add(d.id));
  } catch (err) {
    logger.warn("deleteServiceCenter: ownerUid query failed", { ownerUid, error: String(err) });
  }
  // Legacy primary centers use doc id == owner uid but may lack ownerUid.
  centerIds.add(ownerUid);

  // Collect the Firebase Auth uids to remove: the owner plus every staff member
  // across all of the owner's centers.
  const authUids = new Set([ownerUid]);
  for (const cid of centerIds) {
    try {
      const staffSnap = await dbRef.collection(`servicecenters/${cid}/staff`).get();
      staffSnap.docs.forEach((s) => {
        const uid = s.data().authUid || s.id;
        if (uid) authUids.add(uid);
      });
    } catch (err) {
      logger.warn("deleteServiceCenter: staff read failed", { centerId: cid, error: String(err) });
    }
  }

  const bucket = admin.storage().bucket();
  const deletedCenters = [];

  for (const cid of centerIds) {
    // Recursively delete the center document and every sub-collection under it
    // (customers, vehicles, jobs, inspections, invoices, smsLogs, inventory,
    // staff, payments, counters, expenses, settings, …).
    try {
      await dbRef.recursiveDelete(dbRef.doc(`servicecenters/${cid}`));
      deletedCenters.push(cid);
    } catch (err) {
      logger.error("deleteServiceCenter: recursiveDelete failed", { centerId: cid, error: String(err) });
    }

    // Related top-level documents keyed by centerId.
    for (const coll of [
      "upgradeRequests",
      "paymentSlipRequests",
      "storeAddonRequests",
      "smsPackageRequests",
      "branchRequests",
      "invites",
      "links",
    ]) {
      try {
        const snap = await dbRef.collection(coll).where("centerId", "==", cid).get();
        await Promise.all(snap.docs.map((d) => d.ref.delete().catch(() => {})));
      } catch (err) {
        logger.warn("deleteServiceCenter: related cleanup failed", { coll, centerId: cid, error: String(err) });
      }
    }

    // Storage files under this center's known prefixes.
    for (const prefix of [`servicecenters/${cid}/`, `paymentSlips/${cid}/`, `inspections/${cid}/`]) {
      try {
        await bucket.deleteFiles({ prefix });
      } catch (err) {
        logger.warn("deleteServiceCenter: storage cleanup failed", { prefix, error: String(err) });
      }
    }
  }

  // Remove the Firebase Auth logins and their user-index documents.
  const uidList = [...authUids];
  let deletedUsers = 0;
  try {
    for (let i = 0; i < uidList.length; i += 1000) {
      const batch = uidList.slice(i, i + 1000);
      const res = await admin.auth().deleteUsers(batch);
      deletedUsers += batch.length - (res.failureCount || 0);
    }
  } catch (err) {
    logger.error("deleteServiceCenter: auth deletion failed", { error: String(err) });
  }
  await Promise.all(
    uidList.map((uid) => dbRef.doc(`users/${uid}`).delete().catch(() => {})),
  );

  // Settle the deletion request(s). Mark the approved one, plus any other
  // pending requests that pointed at one of the now-deleted centers.
  if (requestId) {
    await dbRef.doc(`accountDeletionRequests/${requestId}`).update({
      status: "completed",
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      completedBy: request.auth.uid,
    }).catch(() => {});
  }
  try {
    const pending = await dbRef.collection("accountDeletionRequests")
      .where("status", "==", "pending").get();
    await Promise.all(pending.docs
      .filter((d) => centerIds.has(d.data().centerId))
      .map((d) => d.ref.update({
        status: "completed",
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        completedBy: request.auth.uid,
      }).catch(() => {})));
  } catch (err) {
    logger.warn("deleteServiceCenter: settling pending requests failed", { error: String(err) });
  }

  logger.info("deleteServiceCenter: done", {
    centers: deletedCenters, deletedUsers, ownerUid,
  });
  return { success: true, deletedCenters, deletedUsers };
});

// ── Distributor portal ───────────────────────────────────────────────────────
// Distributors have no login: the owner shares a link carrying the center id,
// the distributor id and a secret token. These callables are the only way that
// link reaches data — Firestore rules keep the inventory collection staff-only,
// so nothing here can be read straight from the client. Each call re-checks the
// token, so revoking it (regenerating on the distributor doc) cuts access off
// immediately.
//
// Both are declared `invoker: "public"`: unlike every other callable here they
// are reached by someone who is not signed in, so Cloud Run has to accept the
// request before the function can check the token itself. Without that binding
// Cloud Run rejects the preflight with a 403 that carries no CORS headers, and
// the browser reports it as a CORS failure rather than as the 403 it is.

const DISTRIBUTOR_ORDER_MAX_LINES = 100;
const DISTRIBUTOR_STOCK_REQUEST_MAX_QTY = 1000000;

/**
 * What a distributor pays per unit. Mirrors distributorPriceOf in
 * src/lib/inventoryPricing.ts — an item saved before the price book existed
 * only carries unitCost.
 * @param {object} item Inventory document data.
 * @return {number} Unit price for a distributor.
 */
function distributorPriceOf(item) {
  if (item.distributorPrice != null) return item.distributorPrice;
  if (item.purchasePrice != null) return item.purchasePrice;
  return item.unitCost != null ? item.unitCost : 0;
}

/**
 * Load and authorise a distributor from a share link.
 * @param {object} data Callable payload: centerId, distributorId, token.
 * @return {Promise<object>} { centerId, distributorId, distributor, center }
 */
async function authoriseDistributor(data) {
  const centerId = String((data && data.centerId) || "");
  const distributorId = String((data && data.distributorId) || "");
  const token = String((data && data.token) || "");

  if (!centerId || !distributorId || !token) {
    throw new HttpsError("invalid-argument", "This link is incomplete.");
  }

  const [centerSnap, distSnap] = await Promise.all([
    admin.firestore().doc(`servicecenters/${centerId}`).get(),
    admin.firestore().doc(`servicecenters/${centerId}/distributors/${distributorId}`).get(),
  ]);

  if (!centerSnap.exists || !distSnap.exists) {
    throw new HttpsError("not-found", "This link is no longer valid.");
  }

  const center = centerSnap.data();
  const distributor = distSnap.data();

  // Timing-safe-enough comparison: tokens are 24 random chars, and a callable
  // round-trip swamps any timing signal.
  if (!distributor.accessToken || distributor.accessToken !== token) {
    throw new HttpsError("permission-denied", "This link has been revoked. Ask for a new one.");
  }
  if (distributor.isActive === false) {
    throw new HttpsError("permission-denied", "This account is no longer active.");
  }
  if (distributor.portalEnabled === false) {
    throw new HttpsError("failed-precondition", "The catalog is temporarily unavailable.");
  }
  if (center.isDeleted === true || center.isActive === false || center.status === "blocked") {
    throw new HttpsError("failed-precondition", "The catalog is temporarily unavailable.");
  }

  return { centerId, distributorId, distributor, center };
}

/**
 * The catalog a distributor sees, plus their own order history. Only the fields
 * a distributor is allowed to know are returned — unit cost, supplier and stock
 * logs never leave the server.
 */
exports.getDistributorPortal = onCall({ invoker: "public" }, async (request) => {
  const { centerId, distributorId, distributor, center } = await authoriseDistributor(request.data);

  const [invSnap, orderSnap, stockReqSnap] = await Promise.all([
    admin.firestore().collection(`servicecenters/${centerId}/inventory`).get(),
    admin.firestore().collection(`servicecenters/${centerId}/distributorOrders`)
      .where("distributorId", "==", distributorId)
      .get(),
    admin.firestore().collection(`servicecenters/${centerId}/distributorStockRequests`)
      .where("distributorId", "==", distributorId)
      .get(),
  ]);

  const catalog = invSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((i) => i.isArchived !== true && i.availableToDistributors !== false)
    .map((i) => ({
      id: i.id,
      name: i.name,
      category: i.category || "Other",
      unit: i.unit,
      // A distributor can only order what is actually on the shelf, so they
      // are shown the number rather than a yes/no. Cost, supplier, outlet and
      // service-center prices stay on the server — the only two figures a
      // distributor is entitled to are their own price and the MRP.
      availableQty: Math.max(0, Number(i.currentQty) || 0),
      inStock: (Number(i.currentQty) || 0) > 0,
      unitPrice: distributorPriceOf(i),
      markedPrice: i.markedPrice != null ? i.markedPrice : 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const orders = orderSnap.docs
    .map((d) => {
      const o = d.data();
      return {
        id: d.id,
        orderNumber: o.orderNumber,
        status: o.status,
        total: o.total,
        note: o.note || null,
        reviewNote: o.reviewNote || null,
        createdVia: o.createdVia || "portal",
        createdAt: o.createdAt ? o.createdAt.toMillis() : null,
        finalizedAt: o.finalizedAt ? o.finalizedAt.toMillis() : null,
        items: (o.items || []).map((l) => ({
          itemName: l.itemName,
          unit: l.unit,
          requestedQty: l.requestedQty,
          approvedQty: l.approvedQty,
          unitPrice: l.unitPrice,
          lineTotal: l.lineTotal,
        })),
        // The distributor's own account: what they paid, how, and what's left.
        // Internal fields (who keyed it in) stay on the server.
        receivedTotal: o.receivedTotal || 0,
        creditTotal: o.creditTotal || 0,
        balanceDue: o.balanceDue != null ? o.balanceDue : o.total,
        paymentStatus: o.paymentStatus || "unpaid",
        payments: (o.payments || []).map((p) => ({
          id: p.id,
          method: p.method,
          amount: p.amount,
          date: p.date ? p.date.toMillis() : null,
          note: p.note || null,
          chequeNumber: p.chequeNumber || null,
          bank: p.bank || null,
          branch: p.branch || null,
          chequeDate: p.chequeDate ? p.chequeDate.toMillis() : null,
          // Where a cheque or a credit stands. The distributor wrote the
          // cheque, so whether it cleared or bounced is theirs to know — who
          // marked it, and why, stays on the server.
          clearance: p.clearance || null,
          clearedAt: p.clearedAt ? p.clearedAt.toMillis() : null,
          returnedAt: p.returnedAt ? p.returnedAt.toMillis() : null,
          returnReason: p.returnReason || null,
        })),
      };
    })
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 30);

  // "Please stock more of this" asks the distributor has already raised, so the
  // portal can show what happened to them instead of inviting a duplicate.
  const stockRequests = stockReqSnap.docs
    .map((d) => {
      const r = d.data();
      return {
        id: d.id,
        itemId: r.itemId,
        itemName: r.itemName,
        unit: r.unit,
        requestedQty: r.requestedQty,
        status: r.status || "pending",
        note: r.note || null,
        reviewNote: r.reviewNote || null,
        createdAt: r.createdAt ? r.createdAt.toMillis() : null,
      };
    })
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 30);

  return {
    // Enough of the center's letterhead for the portal to print an invoice the
    // distributor can file — the same details that head a customer invoice.
    center: {
      name: center.name || "Service Center",
      phone: center.phone || null,
      address: center.address || null,
      district: center.district || null,
      email: center.email || null,
      businessRegistrationNumber: center.businessRegistrationNumber || null,
      logoUrl: center.logoUrl || null,
    },
    distributor: {
      name: distributor.name,
      contactPerson: distributor.contactPerson || null,
      phone: distributor.phone || null,
    },
    catalog,
    orders,
    stockRequests,
  };
});

/**
 * Accept a purchase order from the portal. Quantities are the only thing the
 * distributor controls — names, units and prices are snapshotted server-side
 * from live inventory so a tampered payload can't set its own price. Stock is
 * NOT deducted here: nothing moves until the owner finalizes the order.
 */
exports.submitDistributorOrder = onCall({ invoker: "public" }, async (request) => {
  const { centerId, distributorId, distributor } = await authoriseDistributor(request.data);

  const rawItems = Array.isArray(request.data && request.data.items) ? request.data.items : [];
  if (rawItems.length === 0) {
    throw new HttpsError("invalid-argument", "Add at least one item to your order.");
  }
  if (rawItems.length > DISTRIBUTOR_ORDER_MAX_LINES) {
    throw new HttpsError("invalid-argument", "That order has too many lines. Please split it up.");
  }

  const note = String((request.data && request.data.note) || "").trim().slice(0, 300);

  const db = admin.firestore();
  const items = [];
  for (const raw of rawItems) {
    const itemId = String((raw && raw.itemId) || "");
    const quantity = Number(raw && raw.quantity);
    if (!itemId || !isFinite(quantity) || quantity <= 0) {
      throw new HttpsError("invalid-argument", "Every line needs a positive quantity.");
    }
    const snap = await db.doc(`servicecenters/${centerId}/inventory/${itemId}`).get();
    if (!snap.exists) {
      throw new HttpsError("failed-precondition", "One of those items is no longer available.");
    }
    const item = snap.data();
    if (item.isArchived === true || item.availableToDistributors === false) {
      throw new HttpsError("failed-precondition", `${item.name} is no longer available to order.`);
    }
    const unitPrice = distributorPriceOf(item);
    const qty = Math.round(quantity * 100) / 100;
    // The shelf is the ceiling. The client caps the input too, but this is the
    // check that counts — an order for stock that isn't there would only fail
    // later, at the point the owner tries to release it.
    const available = Math.max(0, Number(item.currentQty) || 0);
    if (qty > available) {
      throw new HttpsError(
        "failed-precondition",
        available > 0
          ? `Only ${available} ${item.unit} of ${item.name} available. ` +
            "Lower the quantity or request more stock."
          : `${item.name} is out of stock. Request more stock instead.`,
      );
    }
    items.push({
      itemId,
      itemName: item.name,
      unit: item.unit,
      requestedQty: qty,
      approvedQty: qty,
      unitPrice,
      lineTotal: Math.round(qty * unitPrice * 100) / 100,
    });
  }

  const total = Math.round(items.reduce((sum, i) => sum + i.lineTotal, 0) * 100) / 100;

  // Order numbers are per-center and per-month: PO-2607-0004.
  const now = new Date();
  const prefix = `PO-${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}-`;
  const counterRef = db.doc(`servicecenters/${centerId}/counters/distributorOrders`);
  const orderRef = db.collection(`servicecenters/${centerId}/distributorOrders`).doc();

  await db.runTransaction(async (tx) => {
    const counterSnap = await tx.get(counterRef);
    const data = counterSnap.exists ? counterSnap.data() : {};
    const seq = data.prefix === prefix ? (data.seq || 0) + 1 : 1;
    tx.set(counterRef, { prefix, seq }, { merge: true });
    tx.set(orderRef, {
      orderNumber: `${prefix}${String(seq).padStart(4, "0")}`,
      distributorId,
      distributorName: distributor.name,
      distributorPhone: distributor.phone || null,
      items,
      note: note || null,
      status: "submitted",
      total,
      // Nothing settled yet — seeded so the owner's list and this distributor's
      // account read the same shape as an order that has payments on it.
      payments: [],
      receivedTotal: 0,
      creditTotal: 0,
      balanceDue: total,
      paymentStatus: "unpaid",
      createdVia: "portal",
      centerId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  const saved = await orderRef.get();
  logger.info("submitDistributorOrder: order received", {
    centerId, distributorId, orderId: orderRef.id, lines: items.length, total,
  });

  return {
    success: true,
    orderId: orderRef.id,
    orderNumber: saved.data().orderNumber,
    total,
  };
});

/**
 * "I need more of this than you have." Raised from the portal when a
 * distributor wants a quantity the shelf can't cover. It reserves nothing and
 * moves no stock — it just puts the ask in front of the workshop, who decide
 * whether to buy more in.
 */
exports.requestDistributorStock = onCall({ invoker: "public" }, async (request) => {
  const { centerId, distributorId, distributor } = await authoriseDistributor(request.data);

  const itemId = String((request.data && request.data.itemId) || "");
  const quantity = Number(request.data && request.data.quantity);
  const note = String((request.data && request.data.note) || "").trim().slice(0, 300);

  if (!itemId) {
    throw new HttpsError("invalid-argument", "Pick an item to request.");
  }
  if (!isFinite(quantity) || quantity <= 0) {
    throw new HttpsError("invalid-argument", "Enter a positive quantity.");
  }
  if (quantity > DISTRIBUTOR_STOCK_REQUEST_MAX_QTY) {
    throw new HttpsError("invalid-argument", "That quantity is too large.");
  }

  const db = admin.firestore();
  const snap = await db.doc(`servicecenters/${centerId}/inventory/${itemId}`).get();
  if (!snap.exists) {
    throw new HttpsError("failed-precondition", "That item is no longer available.");
  }
  const item = snap.data();
  if (item.isArchived === true || item.availableToDistributors === false) {
    throw new HttpsError("failed-precondition", `${item.name} is no longer available to order.`);
  }

  const qty = Math.round(quantity * 100) / 100;
  const ref = await db.collection(`servicecenters/${centerId}/distributorStockRequests`).add({
    distributorId,
    distributorName: distributor.name,
    itemId,
    itemName: item.name,
    unit: item.unit,
    requestedQty: qty,
    availableQtyAtRequest: Math.max(0, Number(item.currentQty) || 0),
    note: note || null,
    status: "pending",
    centerId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  logger.info("requestDistributorStock: request raised", {
    centerId, distributorId, itemId, quantity: qty, requestId: ref.id,
  });

  return { success: true, requestId: ref.id };
});

// ── Customer feedback ────────────────────────────────────────────────────────
// The public customer view (src/pages/public/PublicCustomerView.tsx) lets a
// customer leave a complaint or suggestion with no login — same "public
// callable, admin SDK write" shape as the distributor portal above, so the
// write goes through regardless of what firestore.rules allows a browser to
// do directly.

const CUSTOMER_FEEDBACK_MAX_LEN = 1000;

exports.submitCustomerFeedback = onCall({ invoker: "public" }, async (request) => {
  const centerId = String((request.data && request.data.centerId) || "");
  const customerId = String((request.data && request.data.customerId) || "");
  const type = String((request.data && request.data.type) || "");
  const message = String((request.data && request.data.message) || "").trim();

  if (!centerId || !customerId) {
    throw new HttpsError("invalid-argument", "This link is incomplete.");
  }
  if (type !== "complaint" && type !== "suggestion") {
    throw new HttpsError("invalid-argument", "Pick whether this is a complaint or a suggestion.");
  }
  if (!message) {
    throw new HttpsError("invalid-argument", "Enter a message before sending.");
  }
  if (message.length > CUSTOMER_FEEDBACK_MAX_LEN) {
    throw new HttpsError("invalid-argument", "That message is too long.");
  }

  const db = admin.firestore();
  const custSnap = await db.doc(`servicecenters/${centerId}/customers/${customerId}`).get();
  if (!custSnap.exists || custSnap.data().isDeleted) {
    throw new HttpsError("not-found", "This record is no longer available.");
  }
  const customer = custSnap.data();

  const ref = await db.collection(`servicecenters/${centerId}/customerFeedback`).add({
    customerId,
    customerName: customer.name || "",
    customerPhone: customer.phone || "",
    type,
    message: message.slice(0, CUSTOMER_FEEDBACK_MAX_LEN),
    status: "new",
    centerId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  logger.info("submitCustomerFeedback: feedback received", {
    centerId, customerId, type, feedbackId: ref.id,
  });

  return { success: true, feedbackId: ref.id };
});

// ── Bookings ─────────────────────────────────────────────────────────────────
// A customer requests an appointment from their no-login portal
// (src/pages/public/PublicCustomerView.tsx). Since the caller has no auth,
// this callable (Admin SDK, bypasses firestore.rules) is the only way a
// portal-side booking is created; staff-created bookings (walk-in / on
// behalf of a customer) are written directly from the app instead, where
// firestore.rules already gates them to Owner/Manager/Receptionist.

const BOOKING_MAX_SERVICES = 20;
const BOOKING_NOTES_MAX_LEN = 500;
const BOOKING_DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// Mirror of src/lib/sriLankaHolidays.ts — see that file for the maintenance
// note (lunar Poya dates shift every year; this needs a yearly refresh).
const POYA_AND_PUBLIC_HOLIDAYS = {
  2026: [
    "2026-01-01", "2026-01-14", "2026-02-04", "2026-02-01", "2026-03-03",
    "2026-04-01", "2026-04-03", "2026-04-13", "2026-04-14", "2026-05-01",
    "2026-05-02", "2026-05-30", "2026-06-29", "2026-07-28", "2026-08-27",
    "2026-09-25", "2026-10-20", "2026-10-25", "2026-11-24", "2026-12-25",
  ],
  2027: [
    "2027-01-01", "2027-01-14", "2027-01-21", "2027-02-04", "2027-02-20",
    "2027-03-22", "2027-04-02", "2027-04-13", "2027-04-14", "2027-04-20",
    "2027-04-21", "2027-05-01", "2027-05-19", "2027-06-18", "2027-07-18",
    "2027-08-16", "2027-09-15", "2027-10-14", "2027-11-08", "2027-11-13",
    "2027-12-13", "2027-12-25",
  ],
};

// Mirror of src/lib/scheduling.ts#DEFAULT_WEEKLY_HOURS — the fallback used
// when a center hasn't visited Settings -> Working Hours yet. Must match the
// client's default exactly, or the portal shows a date as bookable that the
// server then rejects as closed (or vice versa).
const DEFAULT_WEEKLY_HOURS_SERVER = {
  sun: { open: false },
  mon: { open: true, start: "08:00", end: "17:00" },
  tue: { open: true, start: "08:00", end: "17:00" },
  wed: { open: true, start: "08:00", end: "17:00" },
  thu: { open: true, start: "08:00", end: "17:00" },
  fri: { open: true, start: "08:00", end: "17:00" },
  sat: { open: true, start: "08:00", end: "13:00" },
};

/**
 * Server-side mirror of src/lib/scheduling.ts#isCenterOpen — same precedence:
 * calendarOverrides > seeded Poya/public-holiday dataset > weeklyHours.
 * @param {object} center Service center document data.
 * @param {string} isoDate "YYYY-MM-DD".
 * @return {boolean} Whether the center is open that date.
 */
function isCenterOpenServer(center, isoDate) {
  const overrides = center.calendarOverrides || {};
  if (overrides[isoDate] === "closed") return false;
  if (overrides[isoDate] === "open") return true;

  const year = Number(isoDate.slice(0, 4));
  const holidays = POYA_AND_PUBLIC_HOLIDAYS[year] || [];
  if (holidays.includes(isoDate)) return false;

  const [y, m, d] = isoDate.split("-").map(Number);
  const dayKey = BOOKING_DAY_KEYS[new Date(y, m - 1, d).getDay()];
  const weeklyHours = center.weeklyHours || DEFAULT_WEEKLY_HOURS_SERVER;
  const hours = weeklyHours[dayKey];
  return Boolean(hours && hours.open);
}

exports.submitBooking = onCall({ invoker: "public" }, async (request) => {
  const data = request.data || {};
  const centerId = String(data.centerId || "");
  const customerId = String(data.customerId || "");
  const requestedDate = String(data.requestedDate || "");
  const requestedSlot = String(data.requestedSlot || "");
  const serviceIds = Array.isArray(data.serviceIds) ? data.serviceIds.map(String) : [];
  const customServiceNotes = String(data.customServiceNotes || "").trim().slice(0, BOOKING_NOTES_MAX_LEN);

  if (!centerId || !customerId) {
    throw new HttpsError("invalid-argument", "This link is incomplete.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate) || !/^\d{2}:\d{2}$/.test(requestedSlot)) {
    throw new HttpsError("invalid-argument", "Pick a valid date and time.");
  }
  // Service selection is decided by staff when they review the request, not
  // the customer — a booking is valid with just a vehicle, date and time.
  if (serviceIds.length > BOOKING_MAX_SERVICES) {
    throw new HttpsError("invalid-argument", "That's too many services for one booking.");
  }

  const db = admin.firestore();
  const [centerSnap, custSnap] = await Promise.all([
    db.doc(`servicecenters/${centerId}`).get(),
    db.doc(`servicecenters/${centerId}/customers/${customerId}`).get(),
  ]);
  if (!centerSnap.exists) {
    throw new HttpsError("not-found", "This link is no longer valid.");
  }
  if (!custSnap.exists || custSnap.data().isDeleted) {
    throw new HttpsError("not-found", "This record is no longer available.");
  }
  const center = centerSnap.data();
  const customer = custSnap.data();

  if (!isCenterOpenServer(center, requestedDate)) {
    throw new HttpsError("failed-precondition", "The workshop is closed on that date. Please pick another day.");
  }

  // Resolve (or create) the vehicle. Either an existing vehicleId belonging
  // to this customer, or a brand-new vehicle's details — a public caller has
  // no write access to /vehicles directly, so a new one is created here.
  let vehicleId = String(data.vehicleId || "");
  let plateNumber = "";
  if (vehicleId) {
    const vehSnap = await db.doc(`servicecenters/${centerId}/vehicles/${vehicleId}`).get();
    if (!vehSnap.exists || vehSnap.data().customerId !== customerId || vehSnap.data().isDeleted) {
      throw new HttpsError("not-found", "That vehicle could not be found.");
    }
    plateNumber = vehSnap.data().plateNumber || "";
  } else if (data.newVehicle && data.newVehicle.plateNumber) {
    const nv = data.newVehicle;
    plateNumber = String(nv.plateNumber || "").trim().toUpperCase().slice(0, 20);
    if (!plateNumber) throw new HttpsError("invalid-argument", "Enter a plate number for the new vehicle.");
    const vehRef = db.collection(`servicecenters/${centerId}/vehicles`).doc();
    await vehRef.set({
      plateNumber,
      customerId,
      customerName: customer.name || "",
      make: String(nv.make || "").trim().slice(0, 60),
      model: String(nv.model || "").trim().slice(0, 60),
      vehicleType: String(nv.vehicleType || "").trim().slice(0, 40),
      currentMileageKm: 0,
      nextServiceMileageKm: 0,
      centerId,
      isDeleted: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    vehicleId = vehRef.id;
  } else {
    throw new HttpsError("invalid-argument", "Select a vehicle or add a new one.");
  }

  // Every serviceId must reference a real, active entry in this center's
  // price library — bookings never carry free-text services.
  if (serviceIds.length > 0) {
    const svcSnaps = await Promise.all(
      serviceIds.map((id) => db.doc(`servicecenters/${centerId}/servicePrices/${id}`).get()),
    );
    svcSnaps.forEach((snap) => {
      if (!snap.exists || snap.data().isActive === false) {
        throw new HttpsError("failed-precondition", "One of the selected services is no longer available.");
      }
    });
  }

  // Best-effort double-booking guard — the portal's slot picker already
  // excludes taken slots, this just protects against a race between two
  // customers submitting the same slot at once.
  const clashSnap = await db
    .collection(`servicecenters/${centerId}/bookings`)
    .where("requestedDate", "==", requestedDate)
    .where("requestedSlot", "==", requestedSlot)
    .where("status", "in", ["requested", "confirmed", "checked_in"])
    .limit(1)
    .get();
  if (!clashSnap.empty) {
    throw new HttpsError("failed-precondition", "That time was just taken. Please pick another slot.");
  }

  const ref = await db.collection(`servicecenters/${centerId}/bookings`).add({
    customerId,
    customerName: customer.name || "",
    customerPhone: customer.phone || "",
    vehicleId,
    plateNumber,
    requestedDate,
    requestedSlot,
    serviceIds,
    customServiceNotes: customServiceNotes || null,
    status: "requested",
    createdVia: "portal",
    centerId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  logger.info("submitBooking: booking received", {
    centerId, customerId, bookingId: ref.id, requestedDate, requestedSlot,
  });

  return { success: true, bookingId: ref.id };
});

// ── POS terminal ─────────────────────────────────────────────────────────────
// The real POS — the register a walk-in customer actually pays at — lives on
// its own device at the counter and carries no staff login. The owner shares a
// link carrying the center id, the outlet id and a secret token (see
// src/lib/outletsPos.ts); these callables are the only way that link reaches
// data or moves stock. Each call re-checks the token against the outlet doc,
// so regenerating it (from the Outlets page) cuts access off immediately.
//
// Declared `invoker: "public"` for the same reason as the distributor portal
// callables above: the caller is not signed in.

const POS_TERMINAL_MAX_LINES = 50;

/**
 * What the center's own outlet sells at per unit. Mirrors outletPriceOf in
 * src/lib/inventoryPricing.ts.
 * @param {object} item Inventory document data.
 * @return {number} Unit price for an outlet sale.
 */
function outletPriceOf(item) {
  if (item.outletPrice != null) return item.outletPrice;
  if (item.markedPrice != null) return item.markedPrice;
  if (item.purchasePrice != null) return item.purchasePrice;
  return item.unitCost != null ? item.unitCost : 0;
}

/**
 * Load and authorise an outlet from a POS terminal share link.
 * @param {object} data Callable payload: centerId, outletId, token.
 * @return {Promise<object>} { centerId, outletId, outlet, center }
 */
async function authorisePosOutlet(data) {
  const centerId = String((data && data.centerId) || "");
  const outletId = String((data && data.outletId) || "");
  const token = String((data && data.token) || "");

  if (!centerId || !outletId || !token) {
    throw new HttpsError("invalid-argument", "This link is incomplete.");
  }

  const [centerSnap, outletSnap] = await Promise.all([
    admin.firestore().doc(`servicecenters/${centerId}`).get(),
    admin.firestore().doc(`servicecenters/${centerId}/outlets/${outletId}`).get(),
  ]);

  if (!centerSnap.exists || !outletSnap.exists) {
    throw new HttpsError("not-found", "This link is no longer valid.");
  }

  const center = centerSnap.data();
  const outlet = outletSnap.data();

  if (!outlet.posToken || outlet.posToken !== token) {
    throw new HttpsError("permission-denied", "This link has been revoked. Ask for a new one.");
  }
  if (outlet.isActive === false) {
    throw new HttpsError("permission-denied", "This outlet is no longer active.");
  }
  if (center.isDeleted === true || center.isActive === false || center.status === "blocked") {
    throw new HttpsError("failed-precondition", "The register is temporarily unavailable.");
  }

  return { centerId, outletId, outlet, center };
}

/**
 * The catalog and outlet identity a POS terminal shows. Only what a counter
 * sale needs — outlet price and stock on hand — ever leaves the server; cost,
 * supplier and other price-book fields stay put.
 */
exports.getPosTerminal = onCall({ invoker: "public" }, async (request) => {
  const { centerId, outletId, outlet, center } = await authorisePosOutlet(request.data);

  const invSnap = await admin.firestore().collection(`servicecenters/${centerId}/inventory`).get();
  const catalog = invSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((i) => i.isArchived !== true && (Number(i.currentQty) || 0) > 0)
    .map((i) => ({
      id: i.id,
      name: i.name,
      unit: i.unit,
      currentQty: Number(i.currentQty) || 0,
      unitPrice: outletPriceOf(i),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    center: { name: center.name || "Service Center", logoUrl: center.logoUrl || null },
    outlet: {
      id: outletId,
      name: outlet.name,
      assignedCashierName: outlet.assignedCashierName || null,
    },
    catalog,
  };
});

/**
 * Ring up a counter sale from the terminal: deduct every line's stock and
 * write the sale in one transaction, exactly like recordPosSale in
 * src/lib/posSales.ts, except run with the Admin SDK (the terminal has no
 * staff auth for Firestore rules to check) after the token above has proven
 * the request belongs to this outlet.
 */
exports.recordPosTerminalSale = onCall({ invoker: "public" }, async (request) => {
  const { centerId, outletId, outlet } = await authorisePosOutlet(request.data);

  const rawLines = Array.isArray(request.data && request.data.lines) ? request.data.lines : [];
  if (rawLines.length === 0) {
    throw new HttpsError("invalid-argument", "Add at least one item to the cart.");
  }
  if (rawLines.length > POS_TERMINAL_MAX_LINES) {
    throw new HttpsError("invalid-argument", "That sale has too many lines. Please split it up.");
  }

  const discount = Math.max(0, Math.round((Number(request.data && request.data.discount) || 0) * 100) / 100);
  const paymentMethod = String((request.data && request.data.paymentMethod) || "cash");
  if (!["cash", "card", "bank_transfer"].includes(paymentMethod)) {
    throw new HttpsError("invalid-argument", "Unknown payment method.");
  }
  const amountTenderedRaw = request.data && request.data.amountTendered;
  const amountTendered = amountTenderedRaw != null && isFinite(Number(amountTenderedRaw))
    ? Math.round(Number(amountTenderedRaw) * 100) / 100
    : null;

  const lines = [];
  for (const raw of rawLines) {
    const itemId = String((raw && raw.itemId) || "");
    const quantity = Number(raw && raw.quantity);
    if (!itemId || !isFinite(quantity) || quantity <= 0) {
      throw new HttpsError("invalid-argument", "Every line needs a positive quantity.");
    }
    lines.push({ itemId, quantity: Math.round(quantity * 100) / 100 });
  }

  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();

  const prefix = (() => {
    const d = new Date();
    return `POS-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}-`;
  })();
  const counterRef = db.doc(`servicecenters/${centerId}/counters/posSales`);
  const saleRef = db.collection(`servicecenters/${centerId}/posSales`).doc();
  const itemRefs = lines.map((l) => db.doc(`servicecenters/${centerId}/inventory/${l.itemId}`));

  const { saleNumber, saleLines, subtotal, total, changeDue } = await db.runTransaction(async (tx) => {
    const [counterSnap, ...itemSnaps] = await Promise.all([
      tx.get(counterRef), ...itemRefs.map((ref) => tx.get(ref)),
    ]);

    const builtLines = [];
    itemSnaps.forEach((snap, i) => {
      const line = lines[i];
      if (!snap.exists) throw new HttpsError("failed-precondition", "One of those items is no longer in inventory.");
      const item = snap.data();
      const available = Number(item.currentQty) || 0;
      if (available < line.quantity) {
        throw new HttpsError(
          "failed-precondition",
          `Only ${available} ${item.unit} of ${item.name} left in stock.`,
        );
      }
      const unitPrice = outletPriceOf(item);
      builtLines.push({
        itemId: line.itemId,
        itemName: item.name,
        unit: item.unit,
        quantity: line.quantity,
        unitPrice,
        lineTotal: Math.round(line.quantity * unitPrice * 100) / 100,
        currentQtyBefore: available,
      });
    });

    itemSnaps.forEach((snap, i) => {
      const item = snap.data();
      tx.update(itemRefs[i], {
        currentQty: Math.round((Number(item.currentQty) - lines[i].quantity) * 100) / 100,
        updatedAt: now,
      });
    });

    const counterData = counterSnap.exists ? counterSnap.data() : {};
    const seq = counterData.prefix === prefix ? (counterData.seq || 0) + 1 : 1;
    const saleNum = `${prefix}${String(seq).padStart(4, "0")}`;
    tx.set(counterRef, { prefix, seq }, { merge: true });

    const sub = Math.round(builtLines.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100;
    const tot = Math.max(0, Math.round((sub - discount) * 100) / 100);
    const change = paymentMethod === "cash" && amountTendered != null
      ? Math.max(0, Math.round((amountTendered - tot) * 100) / 100)
      : null;

    tx.set(saleRef, {
      saleNumber: saleNum,
      outletId,
      outletName: outlet.name,
      items: builtLines.map(({ currentQtyBefore, ...l }) => l),
      subtotal: sub,
      discount,
      total: tot,
      paymentMethod,
      ...(amountTendered != null ? { amountTendered } : {}),
      ...(change != null ? { changeDue: change } : {}),
      status: "completed",
      soldBy: "pos-terminal",
      soldByName: outlet.assignedCashierName || `${outlet.name} Terminal`,
      createdVia: "terminal",
      centerId,
      createdAt: now,
    });

    return { saleNumber: saleNum, saleLines: builtLines, subtotal: sub, total: tot, changeDue: change };
  });

  await Promise.all(saleLines.map((line) => db.collection(`servicecenters/${centerId}/inventoryMovements`).add({
    centerId,
    itemId: line.itemId,
    itemName: line.itemName,
    unit: line.unit,
    type: "pos_sale",
    qtyChange: -line.quantity,
    qtyBefore: line.currentQtyBefore,
    qtyAfter: Math.round((line.currentQtyBefore - line.quantity) * 100) / 100,
    outletId,
    outletName: outlet.name,
    refId: saleRef.id,
    refLabel: saleNumber,
    performedBy: "pos-terminal",
    performedByName: outlet.assignedCashierName || `${outlet.name} Terminal`,
    createdAt: now,
  }).catch(() => {})));

  logger.info("recordPosTerminalSale: sale recorded", {
    centerId, outletId, saleId: saleRef.id, saleNumber, total, lines: saleLines.length,
  });

  return { saleNumber, total, subtotal, changeDue };
});
