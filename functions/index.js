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
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();
setGlobalOptions({ maxInstances: 10 });

const ESMS_LOGIN_URL = "https://esms.dialog.lk/api/v2/user/login";
const ESMS_SMS_URL   = "https://e-sms.dialog.lk/api/v2/sms";

const ESMS_USERNAME = process.env.ESMS_USERNAME || "";
const ESMS_PASSWORD = process.env.ESMS_PASSWORD || "";
// Hardcoded: the only sender mask approved for this account with Dialog eSMS.
// Per-center overrides are intentionally ignored to prevent errCode 108.
const ESMS_MASK     = "Lumora Tech";

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
 * for per-document dispatches.
 */
function makeTransactionId(logId) {
  // Combine the current ms with a 4-char-suffix of the Firestore logId so
  // two documents created in the same millisecond cannot collide.
  const suffix = parseInt((logId || "").slice(-4), 36) % 10000;
  const padded = String(suffix).padStart(4, "0");
  return Number(`${Date.now()}${padded}`.slice(0, 18));
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
      // Fetch existing user
      const existing = await admin.auth().getUserByEmail(staffEmail);
      uid = existing.uid;
      // Update their password in case it was reset
      await admin.auth().updateUser(uid, { password, displayName: fullName });
    } else {
      logger.error("createStaffAccount: auth create failed", err);
      throw new HttpsError("internal", `Failed to create account: ${err.message}`);
    }
  }

  // Create/update the users index document
  await admin.firestore().doc(`users/${uid}`).set({
    centerId,
    role,
    email: staffEmail,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  // Update the staff document with the auth uid
  await admin.firestore()
    .doc(`servicecenters/${centerId}/staff/${staffId}`)
    .update({
      authUid: uid,
      hasLogin: true,
      loginPhone: phone,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

  // Also create a users index pointing this uid to the center
  await admin.firestore().doc(`users/${uid}`).set({
    centerId,
    role,
    email: staffEmail,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  // Send login credentials via SMS using existing smsLogs infrastructure
  const localPhone = phone.replace(/\D/g, "").startsWith("94")
    ? `0${phone.replace(/\D/g, "").slice(2)}`
    : phone.replace(/\D/g, "").startsWith("7") && phone.replace(/\D/g, "").length === 9
      ? `0${phone.replace(/\D/g, "")}`
      : phone;

  const smsMessage = `PitStopIQ Login Credentials:\nUsername: ${localPhone}\nPassword: ${password}\nLogin at your service center's PitStopIQ system.\n- Lumora Ventures`;

  await admin.firestore()
    .collection(`servicecenters/${centerId}/smsLogs`)
    .add({
      phone,
      message: smsMessage,
      type: "staff_credentials",
      status: "pending",
      staffId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

  logger.info("createStaffAccount: success", { staffId, uid, centerId });
  return { success: true, uid };
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

    // Always use the approved "Lumora Tech" mask. Per-center overrides are
    // intentionally ignored — unapproved masks trigger errCode 108.
    const mask = ESMS_MASK;

    const transactionId = makeTransactionId(logId);

    const body = {
      msisdn: [{ mobile: msisdn }],
      message: data.message,
      transaction_id: transactionId,
      sourceAddress: mask,
    };

    try {
      const token = await getAccessToken();

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

      if (!res.ok || (parsed && parsed.status === "failed")) {
        logger.error("eSMS send failed", {
          httpStatus: res.status,
          errCode: parsed?.errCode,
          comment: parsed?.comment,
          logId,
        });
        // If the token was rejected, clear the cache so the next call re-auths.
        if (parsed?.errCode === 100 || parsed?.errCode === 105 || parsed?.errCode === 106) {
          _cachedToken    = null;
          _tokenExpiresAt = 0;
        }

        // errCode 118 — eSMS blackout window (8:00 PM – 8:00 AM LKT).
        // Park the message instead of failing it so a retry job can pick it up.
        if (parsed?.errCode === 118) {
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
          parsed?.errCode === 101
            ? "eSMS rejected the request (errCode 101). Check Dialog eSMS wallet balance and that the account is active."
            : parsed?.errCode === 108
            ? "Sender mask not approved by eSMS. Clear the SMS Sender Name in settings, or register the mask with Dialog eSMS."
            : parsed?.comment || `HTTP ${res.status}`;
        await snap.ref.update({
          status: "failed",
          errorCode: parsed?.errCode ? `ESMS_${parsed.errCode}` : `HTTP_${res.status}`,
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

      // Increment SMS quota counter on the center.
      try {
        await admin
          .firestore()
          .doc(`servicecenters/${centerId}`)
          .update({
            smsQuotaUsed: admin.firestore.FieldValue.increment(1),
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
