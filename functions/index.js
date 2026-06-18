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
function makeTransactionId() {
  return Date.now(); // 13-digit integer, well within the 18-digit maximum
}

exports.dispatchSmsLog = onDocumentCreated(
  "servicecenters/{centerId}/smsLogs/{logId}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data();
    const { centerId, logId } = event.params;

    // Skip if already delivered/failed (defensive — should not happen on create).
    if (data.deliveryStatus === "delivered" || data.deliveryStatus === "failed") {
      return;
    }

    if (!ESMS_USERNAME || !ESMS_PASSWORD) {
      logger.error("ESMS_USERNAME / ESMS_PASSWORD not configured", { logId });
      await snap.ref.update({
        deliveryStatus: "failed",
        errorCode: "MISSING_CONFIG",
      });
      return;
    }

    const msisdn = normaliseMsisdn(data.phone);
    if (!msisdn) {
      logger.warn("Invalid phone number", { phone: data.phone, logId });
      await snap.ref.update({ deliveryStatus: "failed", errorCode: "INVALID_PHONE" });
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

    const transactionId = makeTransactionId();

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
        const errorMessage =
          parsed?.errCode === 108
            ? "Sender mask not approved by eSMS. Clear the SMS Sender Name in settings, or register the mask with Dialog eSMS."
            : parsed?.comment || `HTTP ${res.status}`;
        await snap.ref.update({
          deliveryStatus: "failed",
          errorCode: parsed?.errCode ? `ESMS_${parsed.errCode}` : `HTTP_${res.status}`,
          errorMessage,
          providerResponse: parsed ?? text,
        });
        return;
      }

      logger.info("eSMS send ok", { logId, campaignId: parsed?.data?.campaignId });
      await snap.ref.update({
        deliveryStatus: "delivered",
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
        deliveryStatus: "failed",
        errorCode: "NETWORK_ERROR",
        providerResponse: String(err),
      });
    }
  },
);
