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
const PUBLIC_APP_BASE  = "https://pitstopiq.web.app";
const PUBLIC_LOGIN_URL = `${PUBLIC_APP_BASE}/login`;

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

/**
 * Strip characters the Dialog eSMS gateway cannot handle. Emoji and other
 * astral-plane (non-BMP, 4-byte UTF-8) characters make the gateway return a
 * generic HTTP 500 / errCode 101 ("Error occurred"). BMP text — including
 * Sinhala and Tamil — is unaffected. We also drop zero-width joiners and
 * variation selectors that are only meaningful as part of emoji sequences.
 */
function sanitizeForEsms(raw) {
  let out = "";
  for (const ch of String(raw || "")) {
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

  const loginEmail = `${normalised}@pitstopiq.app`;

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
      const existing = await admin.auth().getUserByEmail(loginEmail);
      uid = existing.uid;
      await admin.auth().updateUser(uid, { password, displayName: ownerName });
    } else {
      logger.error("registerServiceCenter: auth create failed", err);
      throw new HttpsError("internal", `Failed to create account: ${err.message}`);
    }
  }

  // centerId == ownerUid (matches existing convention)
  const centerId = uid;

  const smsQuotaLimit = plan === "pro" ? 1000 : 200;

  // Generate a short unique payment reference code (e.g. PSQ-AB12C)
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "PSQ-";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];

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

  const smsMessage = `PitStopIQ Login Credentials:\nUsername: ${localPhone}\nPassword: ${password}\n\nLog in here:\n${PUBLIC_LOGIN_URL}\n\n- Lumora Ventures`;

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
const DEFAULT_REMINDER_TEMPLATES = {
  english:
    "Hi {CustomerName}, your vehicle {Plate} is due for a service soon!\n\nCurrent: {CurrentKm} km | Next service: {NextServiceMileage} km\n\nView your service history:\n{ViewLink}\n\n— {CenterName}",
  sinhala:
    "ආයුබෝවන් {CustomerName}, ඔබගේ වාහනය {Plate} ඉක්මනින් සේවාවට නියමිතයි!\n\nවර්තමාන: {CurrentKm} km | ඊළඟ සේවාව: {NextServiceMileage} km\n\nසේවා ඉතිහාසය බලන්න:\n{ViewLink}\n\n— {CenterName}",
  tamil:
    "வணக்கம் {CustomerName}, உங்கள் வாகனம் {Plate} விரைவில் சேவைக்கு உரியது!\n\nதற்போதைய: {CurrentKm} km | அடுத்த சேவை: {NextServiceMileage} km\n\nசேவை வரலாற்றைப் பார்க்க:\n{ViewLink}\n\n— {CenterName}",
};

function reminderTemplateField(lang) {
  return lang === "sinhala" ? "reminderSmsTemplateSi"
    : lang === "tamil" ? "reminderSmsTemplateTa"
    : "reminderSmsTemplate";
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

    // Collection-group query across every center's vehicles. A single-field
    // index on nextServiceDate covers this; reminderSent is filtered in code.
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

        const viewLink = `${PUBLIC_APP_BASE}/c/${centerId}/${v.customerId}`;
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
