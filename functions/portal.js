/**
 * Customer portal callables — the Admin-SDK replacement for the anonymous
 * Firestore reads PublicCustomerView / PublicInvoiceView used to make.
 * Handler logic lives in portalCore.js; this file is only the wiring.
 * Loaded from index.js with one line, like inspectionReports.js.
 *
 * Same region as every other callable (the project default — none of them sets
 * one). Instances are capped well below the global 10 and each instance takes
 * several requests at once, so a flood costs a bounded amount: the portal is
 * public, and "cheap per call, capped in total" is the whole abuse budget.
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { Timestamp } = require("firebase-admin/firestore");
const { createPortal } = require("./portalCore");
const { isMissingIndexError } = require("./shared/inspectionHelpers.mjs");

const PORTAL_OPTIONS = {
  invoker: "public",
  memory: "512MiB",
  cpu: 1,              // concurrency > 1 needs a full CPU
  concurrency: 20,
  maxInstances: 5,
  timeoutSeconds: 30,
};

const portal = createPortal({
  db: admin.firestore(), // index.js has already run initializeApp() by the time this loads
  logger,
  toTimestamp: (ms) => Timestamp.fromMillis(ms),
});

/** Unexpected failures become a retryable "unavailable"; only the message and code are logged. */
function logged(name, handler) {
  return async (request) => {
    try {
      return await handler(request);
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      const missingIndex = isMissingIndexError(err);
      logger.error(`${name} failed${missingIndex ? ": MISSING FIRESTORE INDEX — deploy firestore.indexes.json and wait for it to build" : ""}`, {
        error: String(err && err.message ? err.message : err), code: err && err.code,
      });
      throw new HttpsError("unavailable", "This couldn't be loaded right now. Please try again in a few minutes.");
    }
  };
}

exports.getPortalData = onCall(PORTAL_OPTIONS, logged("getPortalData", portal.getPortalData));
exports.getPublicInvoice = onCall(PORTAL_OPTIONS, logged("getPublicInvoice", portal.getPublicInvoice));
exports.getBookingSlots = onCall(PORTAL_OPTIONS, logged("getBookingSlots", portal.getBookingSlots));
