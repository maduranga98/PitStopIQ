/**
 * Customer portal — handler logic (no Cloud Functions wiring; see portal.js).
 *
 * The portal pages used to read jobs, invoices, vehicles, bookings and
 * customerFeedback straight from Firestore because those collections were
 * `allow read: if true`. These handlers replace those reads: they run as the
 * Admin SDK, authorise by the same thing the page always did (possession of
 * the customer id in the URL), and return whitelist projections only — see
 * shared/portalProjections.mjs for what is never included.
 *
 * Kept separate from the onCall wiring so tests can drive the handlers
 * against the Firestore emulator with an injected clock.
 *
 * Behaviour rules shared by all three handlers:
 *  - "No such link" is ONE answer, {found:false}, whether the center, the
 *    customer, the invoice or the id's very shape is wrong, so the endpoint is
 *    not an oracle for which ids exist.
 *  - Throttling counts MISSES per IP separately from total calls (see
 *    shared/portalThrottle.mjs). A throttle-store failure never blocks a real
 *    customer.
 *  - Nothing here logs a phone number, a name or a payload. Throttle logs carry
 *    a hash of the caller's IP and the scope, nothing else.
 */
const { HttpsError } = require("firebase-functions/v2/https");
const crypto = require("crypto");
const {
  projectPortalCenter, projectInvoiceCenter, projectPortalCustomer, projectPortalVehicle,
  projectPortalJob, projectSharedNote, projectInvoiceSummary, projectPublicInvoice,
  projectPortalBooking, projectPortalFeedback, isInvoiceReleased,
} = require("./shared/portalProjections.mjs");
const { LIMITS, WINDOW_MS, reserve, recordMiss } = require("./shared/portalThrottle.mjs");

const PAGE_SIZE = 50;            // jobs and invoices per page
const MAX_PAGE_QUERIES = 3;      // refills when soft-deleted/unreleased rows are filtered out
const MAX_VEHICLES = 50;
const MAX_NOTE_VEHICLES = 20;
const NOTES_PER_VEHICLE = 20;
const MAX_NOTES = 40;
const MAX_BOOKINGS = 50;
const MAX_FEEDBACK = 50;
// Same set the portal's booking flow has always treated as "slot taken".
const ACTIVE_BOOKING_STATUSES = ["requested", "confirmed", "checked_in"];

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const NOT_FOUND = Object.freeze({ found: false });

function createPortal({ db, now = () => Date.now(), logger = console, toTimestamp }) {
  const ts = toTimestamp || ((ms) => require("firebase-admin/firestore").Timestamp.fromMillis(ms));

  // ── Throttle ────────────────────────────────────────────────────────────────

  const hash = (s) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 32);
  const ipBucket = (request) => `portalThrottle/ip_${hash(request.rawRequest?.ip || "unknown")}`;
  const customerBucket = (centerId, customerId) => `portalThrottle/c_${hash(`${centerId}/${customerId}`)}`;
  const expireAt = () => ts(now() + 2 * WINDOW_MS);

  /**
   * Reserve one call against the caller's IP bucket and, when there is a
   * customer to speak of, that customer's bucket. Throws resource-exhausted if
   * either is full. Store failures fail OPEN.
   */
  async function throttle(request, centerId, customerId) {
    const ipRef = db.doc(ipBucket(request));
    const custRef = customerId ? db.doc(customerBucket(centerId, customerId)) : null;
    let refused = null;
    try {
      await db.runTransaction(async (tx) => {
        const [ipSnap, custSnap] = await Promise.all([tx.get(ipRef), custRef ? tx.get(custRef) : null]);
        const t = now();
        const ip = reserve(ipSnap.exists ? ipSnap.data() : null, t, { maxTotal: LIMITS.ipTotal, maxMisses: LIMITS.ipMisses });
        if (!ip.allowed) { refused = "ip"; return; }
        let cust = null;
        if (custRef) {
          cust = reserve(custSnap.exists ? custSnap.data() : null, t, { maxTotal: LIMITS.customerTotal });
          if (!cust.allowed) { refused = "customer"; return; }
        }
        tx.set(ipRef, { ...ip.state, expireAt: expireAt() });
        if (custRef) tx.set(custRef, { ...cust.state, expireAt: expireAt() });
      });
    } catch (err) {
      logger.error("portal: throttle store failed (failing open)", { code: err && err.code });
      return;
    }
    if (refused) {
      logger.warn("portal: throttled", { scope: refused, ip: hash(request.rawRequest?.ip || "unknown").slice(0, 8) });
      throw new HttpsError("resource-exhausted", "Too many requests. Please try again later.");
    }
  }

  /** Count a lookup that found nothing against the caller's IP. Best effort. */
  async function noteMiss(request) {
    const ref = db.doc(ipBucket(request));
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        tx.set(ref, { ...recordMiss(snap.exists ? snap.data() : null, now()), expireAt: expireAt() });
      });
    } catch (err) {
      logger.error("portal: miss counter failed", { code: err && err.code });
    }
  }

  async function miss(request) {
    await noteMiss(request);
    return NOT_FOUND;
  }

  // ── Input ───────────────────────────────────────────────────────────────────

  /** Missing / non-string → client bug (invalid-argument). Wrong shape → "no such link". */
  function readId(data, key) {
    const v = data ? data[key] : undefined;
    if (typeof v !== "string" || !v.trim()) throw new HttpsError("invalid-argument", "This link is incomplete.");
    const id = v.trim();
    return ID_RE.test(id) ? id : null;
  }

  // ── Shared lookups ──────────────────────────────────────────────────────────

  const centerPath = (centerId) => `servicecenters/${centerId}`;

  async function loadCenterAndCustomer(centerId, customerId) {
    const [centerSnap, custSnap] = await Promise.all([
      db.doc(centerPath(centerId)).get(),
      db.doc(`${centerPath(centerId)}/customers/${customerId}`).get(),
    ]);
    if (!centerSnap.exists || !custSnap.exists || custSnap.data().isDeleted === true) return null;
    return { center: centerSnap.data(), customer: custSnap.data() };
  }

  /**
   * One page of a customer's documents, newest first, resumable from the id of
   * the last document scanned. Soft-deleted / unreleased rows are filtered
   * after the query, so it refills (a few times) to keep pages full.
   */
  async function fetchPage(collection, centerId, customerId, cursorId, keep) {
    const base = db.collection(`${centerPath(centerId)}/${collection}`)
      .where("customerId", "==", customerId)
      .orderBy("createdAt", "desc");
    let after = null;
    if (cursorId) {
      const snap = await db.doc(`${centerPath(centerId)}/${collection}/${cursorId}`).get();
      if (!snap.exists || snap.data().customerId !== customerId) {
        throw new HttpsError("invalid-argument", "That page marker is no longer valid.");
      }
      after = snap;
    }
    const docs = [];
    let last = null;
    let exhausted = false;
    for (let q = 0; q < MAX_PAGE_QUERIES && docs.length < PAGE_SIZE && !exhausted; q++) {
      const need = PAGE_SIZE - docs.length;
      const snap = await (after ? base.startAfter(after) : base).limit(need).get();
      for (const d of snap.docs) {
        last = d;
        if (keep(d.data())) docs.push(d);
      }
      after = last;
      if (snap.size < need) exhausted = true;
    }
    return { docs, next: exhausted || !last ? null : last.id };
  }

  const pageJobs = (centerId, customerId, cursor) =>
    fetchPage("jobs", centerId, customerId, cursor, (j) => j.isDeleted !== true)
      .then((p) => ({ list: p.docs.map((d) => projectPortalJob(d.id, d.data())), next: p.next }));

  const pageInvoices = (centerId, customerId, cursor) =>
    fetchPage("invoices", centerId, customerId, cursor, isInvoiceReleased)
      .then((p) => ({ list: p.docs.map((d) => projectInvoiceSummary(d.id, d.data())), next: p.next }));

  async function sharedNotes(centerId, vehicles) {
    const perVehicle = await Promise.all(vehicles.slice(0, MAX_NOTE_VEHICLES).map(async (v) => {
      try {
        const snap = await db.collection(`${centerPath(centerId)}/vehicles/${v.id}/logs`)
          .where("customerVisible", "==", true)
          .orderBy("createdAt", "desc")
          .limit(NOTES_PER_VEHICLE)
          .get();
        return snap.docs.map((d) => projectSharedNote(d.id, d.data(), v.plateNumber));
      } catch {
        // Same as the page today: one vehicle's notes failing must not fail the page.
        return [];
      }
    }));
    return perVehicle.flat()
      .sort((a, b) => (b.createdAtMillis ?? 0) - (a.createdAtMillis ?? 0))
      .slice(0, MAX_NOTES);
  }

  // ── getPortalData ───────────────────────────────────────────────────────────

  /**
   * { centerId, customerId }                      → the whole portal, first page.
   * { centerId, customerId, before:{jobs?,invoices?} } → only the older page(s)
   *   of the lists named, from the id of the last row already shown. Used by
   *   the "Load older" buttons; skips everything else.
   * `next.jobs` / `next.invoices` is the cursor for the following page, or null
   * when that list is exhausted.
   */
  async function getPortalData(request) {
    const data = request.data || {};
    const centerId = readId(data, "centerId");
    const customerId = readId(data, "customerId");
    if (!centerId || !customerId) {
      await throttle(request, null, null);
      return miss(request);
    }
    await throttle(request, centerId, customerId);

    const before = data.before && typeof data.before === "object" ? data.before : null;
    const cursor = (k) => {
      const v = before ? before[k] : undefined;
      if (v === undefined || v === null) return undefined;
      if (typeof v !== "string" || !ID_RE.test(v)) throw new HttpsError("invalid-argument", "That page marker is not valid.");
      return v;
    };
    const jobsCursor = cursor("jobs");
    const invoicesCursor = cursor("invoices");

    const base = await loadCenterAndCustomer(centerId, customerId);
    if (!base) return miss(request);

    if (before) {
      const [jobs, invoices] = await Promise.all([
        jobsCursor ? pageJobs(centerId, customerId, jobsCursor) : { list: [], next: null },
        invoicesCursor ? pageInvoices(centerId, customerId, invoicesCursor) : { list: [], next: null },
      ]);
      return { found: true, jobs: jobs.list, invoices: invoices.list, next: { jobs: jobs.next, invoices: invoices.next } };
    }

    const [vehSnap, jobs, invoices, bookSnap, fbSnap] = await Promise.all([
      db.collection(`${centerPath(centerId)}/vehicles`).where("customerId", "==", customerId).limit(MAX_VEHICLES).get(),
      pageJobs(centerId, customerId),
      pageInvoices(centerId, customerId),
      db.collection(`${centerPath(centerId)}/bookings`).where("customerId", "==", customerId)
        .orderBy("createdAt", "desc").limit(MAX_BOOKINGS).get(),
      db.collection(`${centerPath(centerId)}/customerFeedback`).where("customerId", "==", customerId)
        .orderBy("createdAt", "desc").limit(MAX_FEEDBACK).get(),
    ]);
    const vehicles = vehSnap.docs
      .filter((d) => d.data().isDeleted !== true)
      .map((d) => projectPortalVehicle(d.id, d.data()));

    return {
      found: true,
      customer: projectPortalCustomer(customerId, base.customer),
      center: projectPortalCenter(base.center),
      vehicles,
      jobs: jobs.list,
      invoices: invoices.list,
      next: { jobs: jobs.next, invoices: invoices.next },
      sharedNotes: await sharedNotes(centerId, vehicles),
      bookings: bookSnap.docs.map((d) => projectPortalBooking(d.id, d.data())),
      feedback: fbSnap.docs.map((d) => projectPortalFeedback(d.id, d.data())),
    };
  }

  // ── getPublicInvoice ────────────────────────────────────────────────────────

  /** { centerId, customerId, invoiceId } → { found, invoice, center } */
  async function getPublicInvoice(request) {
    const data = request.data || {};
    const centerId = readId(data, "centerId");
    const customerId = readId(data, "customerId");
    const invoiceId = readId(data, "invoiceId");
    if (!centerId || !customerId || !invoiceId) {
      await throttle(request, null, null);
      return miss(request);
    }
    await throttle(request, centerId, customerId);

    const [invSnap, centerSnap] = await Promise.all([
      db.doc(`${centerPath(centerId)}/invoices/${invoiceId}`).get(),
      db.doc(centerPath(centerId)).get(),
    ]);
    // The invoice must belong to the customer in the URL, exactly as the page checked.
    if (!centerSnap.exists || !invSnap.exists
      || invSnap.data().customerId !== customerId || !isInvoiceReleased(invSnap.data())) {
      return miss(request);
    }
    return {
      found: true,
      invoice: projectPublicInvoice(invSnap.id, invSnap.data()),
      center: projectInvoiceCenter(centerSnap.data()),
    };
  }

  // ── getBookingSlots ─────────────────────────────────────────────────────────

  /** { centerId, customerId, date } → { found, takenSlots }. Slots only — no names, no customers. */
  async function getBookingSlots(request) {
    const data = request.data || {};
    const centerId = readId(data, "centerId");
    const customerId = readId(data, "customerId");
    const date = typeof data.date === "string" ? data.date.trim() : "";
    if (!DATE_RE.test(date)) throw new HttpsError("invalid-argument", "Pick a valid date.");
    if (!centerId || !customerId) {
      await throttle(request, null, null);
      return miss(request);
    }
    await throttle(request, centerId, customerId);

    const base = await loadCenterAndCustomer(centerId, customerId);
    if (!base) return miss(request);

    const snap = await db.collection(`${centerPath(centerId)}/bookings`)
      .where("requestedDate", "==", date)
      .where("status", "in", ACTIVE_BOOKING_STATUSES)
      .get();
    const taken = new Set();
    for (const d of snap.docs) {
      const s = d.data().requestedSlot;
      if (typeof s === "string" && /^\d{2}:\d{2}$/.test(s)) taken.add(s);
    }
    return { found: true, takenSlots: [...taken].sort() };
  }

  return { getPortalData, getPublicInvoice, getBookingSlots };
}

module.exports = { createPortal, PAGE_SIZE, ACTIVE_BOOKING_STATUSES };
