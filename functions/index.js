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
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();
setGlobalOptions({ maxInstances: 10 });

const ESMS_LOGIN_URL = "https://esms.dialog.lk/api/v2/user/login";
const ESMS_SMS_URL   = "https://e-sms.dialog.lk/api/v2/sms";

const ESMS_USERNAME = process.env.ESMS_USERNAME || "";
const ESMS_PASSWORD = process.env.ESMS_PASSWORD || "";
// Leave blank to let eSMS use the account's registered default mask.
// Setting an unapproved mask triggers errCode 108.
const ESMS_MASK     = process.env.ESMS_MASK     || "";

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

    // Resolve sender mask: center-level override → global env default.
    // If no mask is configured we omit sourceAddress entirely so eSMS falls
    // back to the account's registered default mask (avoids errCode 108).
    let mask = ESMS_MASK;
    try {
      const centerSnap = await admin
        .firestore()
        .doc(`servicecenters/${centerId}`)
        .get();
      if (centerSnap.exists) {
        const c = centerSnap.data();
        if (c.smsSenderName && c.smsSenderName.trim()) mask = c.smsSenderName.trim();
      }
    } catch (err) {
      logger.warn("Failed to fetch center for mask lookup", err);
    }

    const transactionId = makeTransactionId(logId);

    const body = {
      msisdn: [{ mobile: msisdn }],
      message: data.message,
      transaction_id: transactionId,
      payment_method: 0, // wallet payment (default)
    };

    // Only set sourceAddress when a mask is explicitly configured; omitting it
    // lets eSMS use the account's registered default (prevents errCode 108).
    if (mask) body.sourceAddress = mask;

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
          });
          return;
        }

        const errorMessage =
          parsed?.errCode === 108
            ? "Sender mask not approved by eSMS. Clear the SMS Sender Name in settings, or register the mask with Dialog eSMS."
            : parsed?.comment || `HTTP ${res.status}`;
        await snap.ref.update({
          status: "failed",
          errorCode: parsed?.errCode ? `ESMS_${parsed.errCode}` : `HTTP_${res.status}`,
          errorMessage,
          providerResponse: parsed ?? text,
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
