/**
 * PitStop IQ Cloud Functions
 *
 * Triggers on smsLogs documents created by the app and dispatches the
 * SMS through Dialog eSMS (https://esms.dialog.lk/).
 *
 * Config — set in functions/.env (gitignored) or via Firebase secrets:
 *   ESMS_API_URL    Send-SMS endpoint URL
 *   ESMS_BEARER     URL Message Key (JWT)
 *   ESMS_MASK       Default sender mask (e.g. "Lumora Tech")
 *
 * .env.example shows the defaults. To deploy the JWT as a secret instead:
 *   firebase functions:secrets:set ESMS_BEARER
 */

const { setGlobalOptions } = require("firebase-functions");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();
setGlobalOptions({ maxInstances: 10 });

const ESMS_API_URL = process.env.ESMS_API_URL || "https://esms.dialog.lk/api/v1/sms/send";
const ESMS_BEARER = process.env.ESMS_BEARER || "";
const ESMS_MASK = process.env.ESMS_MASK || "Lumora Tech";

/**
 * Convert +94XXXXXXXXX / 07XXXXXXXX / 94XXXXXXXXX into the 94XXXXXXXXX
 * form Dialog eSMS expects.
 */
function normaliseMsisdn(raw) {
  const s = String(raw || "").replace(/[\s\-()+]/g, "");
  if (/^94\d{9}$/.test(s)) return s;
  if (/^0\d{9}$/.test(s)) return "94" + s.slice(1);
  if (/^\d{9}$/.test(s)) return "94" + s;
  return s;
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

    if (!ESMS_BEARER) {
      logger.error("ESMS_BEARER not configured — cannot dispatch SMS", { logId });
      await snap.ref.update({
        deliveryStatus: "failed",
        errorCode: "MISSING_CONFIG",
      });
      return;
    }

    const msisdn = normaliseMsisdn(data.phone);
    if (!msisdn) {
      await snap.ref.update({ deliveryStatus: "failed", errorCode: "INVALID_PHONE" });
      return;
    }

    // Pull the center's sender mask if set; otherwise fall back to the
    // global default.
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

    const body = {
      msisdn: [{ mobile: msisdn }],
      sourceAddress: mask,
      message: data.message,
      transaction_id: logId,
      campaignName: data.messageType || "PitStopIQ",
    };

    try {
      const res = await fetch(ESMS_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ESMS_BEARER}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { /* keep raw text */ }

      if (!res.ok) {
        logger.error("eSMS send failed", { status: res.status, body: text });
        await snap.ref.update({
          deliveryStatus: "failed",
          errorCode: `HTTP_${res.status}`,
          providerResponse: parsed ?? text,
        });
        return;
      }

      logger.info("eSMS send ok", { logId, response: parsed });
      await snap.ref.update({
        deliveryStatus: "delivered",
        providerResponse: parsed ?? text,
        deliveredAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Bump quota counter on the center
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
      logger.error("eSMS network error", err);
      await snap.ref.update({
        deliveryStatus: "failed",
        errorCode: "NETWORK_ERROR",
        providerResponse: String(err),
      });
    }
  },
);
