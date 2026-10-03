/**
 * Inspection Reports — server side (finalize, PDF, reopen).
 *
 * Also the public share-link door (getPublicInspectionReport,
 * trackInspectionReportView) and the Owner's revoke switch. Those mirror the
 * diagnostic-report module: nothing grants an unauthenticated client a read of
 * an inspection report, so the public page is served by callables running as
 * the Admin SDK, keyed by the report's unguessable shareToken.
 *
 * Independent of the job-card inspection module and of dailyInspectionCleanup,
 * and of the diagnostic-report module. Loaded from index.js with one line.
 *
 * Why callables and not client writes: finalizing assigns the report number in
 * an Admin SDK transaction (atomic per centre per year — a guarantee the
 * client-side invoice numbering does not have), locks the report, and
 * generates the PDF. The rules refuse client writes to every field touched
 * here (status, reportNumber, finalizedAt, pdfUrl, pdfPath, pdfGeneratedAt,
 * nextMediaDeleteAt), so these are the only way in. All of it needs a
 * connection; drafts do not.
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { Timestamp, FieldValue } = require("firebase-admin/firestore");
const crypto = require("crypto");
const {
  finalizeBlockers, formatReportNumber, yearInZone, mediaDeleteAt, needsRepairCount,
} = require("./shared/inspectionHelpers.mjs");
const { renderInspectionPdf } = require("./inspectionPdf");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { runStandaloneInspectionCleanup } = require("./inspectionCleanup");
const { inspectionPermission } = require("./shared/inspectionPermissions.mjs");

// PDFs embed photos; the default 256 MiB is tight for a report with dozens.
const CALLABLE_OPTIONS = { memory: "512MiB", timeoutSeconds: 120 };

const db = () => admin.firestore();
const reportRef = (centerId, reportId) => db().doc(`servicecenters/${centerId}/inspectionReports/${reportId}`);
// Mirrors inspectionMediaStoragePath / inspectionPdfStoragePath in src/lib/inspectionReports/paths.ts.
const mediaPath = (centerId, reportId, fileId) => `inspectionReports/${centerId}/${reportId}/${fileId}`;
const pdfPath = (centerId, reportId) => mediaPath(centerId, reportId, "report.pdf");

/** Same shape getDownloadURL() returns on the client; the token is the credential. */
function buildDownloadUrl(bucketName, filePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
}

function ids(request) {
  const centerId = String(request.data?.centerId || "").trim();
  const reportId = String(request.data?.reportId || "").trim();
  if (!centerId || !reportId) throw new HttpsError("invalid-argument", "Missing centerId or reportId.");
  return { centerId, reportId };
}

/**
 * Owner or Manager of the centre, optionally holding an `inspectionReports`
 * permission (resolved exactly as firestore.rules and the app do — see
 * shared/inspectionPermissions.mjs). `needModule` (default) also requires the
 * centre's Inspection Reports switch to be on.
 */
async function requireManager(request, centerId, { needModule = true, permission = null } = {}) {
  if (!request.auth) throw new HttpsError("unauthenticated", "You must be signed in.");
  const [staffSnap, centerSnap] = await Promise.all([
    db().doc(`servicecenters/${centerId}/staff/${request.auth.uid}`).get(),
    db().doc(`servicecenters/${centerId}`).get(),
  ]);
  const staff = staffSnap.exists ? staffSnap.data() : null;
  if (!staff || staff.active === false || (staff.role !== "Owner" && staff.role !== "Manager")) {
    throw new HttpsError("permission-denied", "Only the Owner or a Manager can do this.");
  }
  if (needModule && (!centerSnap.exists || centerSnap.data().standaloneInspectionEnabled !== true)) {
    throw new HttpsError("failed-precondition", "Inspection Reports is switched off for this centre.");
  }
  const center = centerSnap.exists ? centerSnap.data() : {};
  if (permission) {
    const isPro = center.plan === "pro";
    let customRole = null;
    let rolePermissions = null;
    if (isPro && staff.role !== "Owner") {
      if (staff.customRoleId) {
        const cr = await db().doc(`servicecenters/${centerId}/customRoles/${staff.customRoleId}`).get();
        customRole = cr.exists ? cr.data() : null;
      }
      if (!customRole) {
        const rp = await db().doc(`servicecenters/${centerId}/settings/rolePermissions`).get();
        rolePermissions = rp.exists ? rp.data() : null;
      }
    }
    if (!inspectionPermission({ role: staff.role, isPro, customRole, rolePermissions }, permission)) {
      throw new HttpsError("permission-denied", "You don't have permission to do this. Ask the Owner to change your access.");
    }
  }
  return { uid: request.auth.uid, role: staff.role, center };
}

// ── PDF ──────────────────────────────────────────────────────────────────────

async function fetchLogo(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    // PDFKit takes JPEG/PNG only; logos are often WebP or SVG.
    return await require("sharp")(Buffer.from(await res.arrayBuffer()))
      .resize({ width: 240, height: 240, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  } catch (err) {
    logger.warn("inspection pdf: logo unavailable", { error: String(err) });
    return null;
  }
}

/** Renders the report to PDF, stores it, and records pdfUrl/pdfPath/pdfGeneratedAt. */
async function generateAndStorePdf(centerId, reportId) {
  const snap = await reportRef(centerId, reportId).get();
  if (!snap.exists) throw new HttpsError("not-found", "Report not found.");
  const r = snap.data();
  const centerSnap = await db().doc(`servicecenters/${centerId}`).get();
  const center = centerSnap.exists ? centerSnap.data() : {};
  const bucket = admin.storage().bucket();

  // Photos are read one at a time and not retained: a report can carry dozens.
  const loadImage = async (m) => {
    if (!m || !m.url || m.mediaDeleted) return null;
    try {
      const [buf] = await bucket.file(mediaPath(centerId, reportId, m.id)).download();
      return buf;
    } catch (err) {
      logger.warn("inspection pdf: image unavailable", { centerId, reportId, mediaId: m.id, error: String(err) });
      return null;
    }
  };

  const buffer = await renderInspectionPdf({
    report: {
      ...r,
      reportDate: r.reportDate?.toDate?.() ?? null,
      finalizedAt: r.finalizedAt?.toDate?.() ?? null,
    },
    center: { name: center.name || "Service Center", phone: center.phone || "", logo: await fetchLogo(center.logoUrl) },
    loadImage,
  });

  // Keep the token across regenerations so a link to the PDF already sent stays valid.
  const previous = typeof r.pdfUrl === "string" ? new URL(r.pdfUrl).searchParams.get("token") : null;
  const token = previous || crypto.randomUUID();
  const path = pdfPath(centerId, reportId);
  await bucket.file(path).save(buffer, {
    resumable: false,
    metadata: { contentType: "application/pdf", cacheControl: "private, max-age=0", metadata: { firebaseStorageDownloadTokens: token } },
  });
  const pdfUrl = buildDownloadUrl(bucket.name, path, token);
  await reportRef(centerId, reportId).update({
    pdfUrl, pdfPath: path, pdfGeneratedAt: FieldValue.serverTimestamp(),
  });
  return pdfUrl;
}

// ── Finalize ─────────────────────────────────────────────────────────────────

exports.finalizeInspectionReport = onCall(CALLABLE_OPTIONS, async (request) => {
  const { centerId, reportId } = ids(request);
  const { uid } = await requireManager(request, centerId, { permission: "finalize" });
  const ref = reportRef(centerId, reportId);

  const outcome = await db().runTransaction(async (tx) => {
    // All reads first: the report and (if it needs a number) this year's counter.
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Report not found.");
    const r = snap.data();
    // A second tap, or a retry after a dropped response: already done.
    if (r.status === "finalized") return { reportNumber: r.reportNumber, already: true };

    const blockers = finalizeBlockers(r);
    if (blockers.length) throw new HttpsError("failed-precondition", blockers.join(" "));

    const now = new Date();
    let reportNumber = r.reportNumber;
    let counterUpdate = null;
    if (!reportNumber) {
      // First finalize. A report reopened and finalized again keeps its number.
      const year = yearInZone(now);
      const counterRef = db().doc(`servicecenters/${centerId}/inspectionCounters/${year}`);
      const counter = await tx.get(counterRef);
      const seq = (counter.exists ? Number(counter.data().seq) || 0 : 0) + 1;
      reportNumber = formatReportNumber(year, seq);
      counterUpdate = { ref: counterRef, data: { year, seq } };
    }

    // Retention: images expire MEDIA_RETENTION_MONTHS after finalization.
    const patch = {
      status: "finalized",
      reportNumber,
      finalizedAt: Timestamp.fromDate(now),
      finalizedBy: uid,
      updatedAt: FieldValue.serverTimestamp(),
    };
    let nextExpiry = null;
    for (const [id, m] of Object.entries(r.media || {})) {
      if (!m || m.mediaDeleted) continue;
      const at = mediaDeleteAt(m, now);
      if (!at) continue;
      patch[`media.${id}.mediaDeleteAt`] = Timestamp.fromDate(at);
      if (!nextExpiry || at < nextExpiry) nextExpiry = at;
    }
    patch.nextMediaDeleteAt = nextExpiry ? Timestamp.fromDate(nextExpiry) : null;

    if (counterUpdate) tx.set(counterUpdate.ref, counterUpdate.data);
    tx.update(ref, patch);
    return { reportNumber, already: false };
  });

  // The number is committed; a PDF failure must not undo that, so it is reported
  // and retryable (regenerateInspectionReportPdf) instead of failing the call.
  let pdfUrl = null;
  try {
    pdfUrl = await generateAndStorePdf(centerId, reportId);
  } catch (err) {
    logger.error("finalizeInspectionReport: PDF failed", { centerId, reportId, error: String(err) });
  }
  logger.info("finalizeInspectionReport", { centerId, reportId, reportNumber: outcome.reportNumber, already: outcome.already, pdf: !!pdfUrl });
  return { reportNumber: outcome.reportNumber, pdfUrl, pdfReady: !!pdfUrl };
});

// ── Regenerate PDF ───────────────────────────────────────────────────────────

exports.regenerateInspectionReportPdf = onCall(CALLABLE_OPTIONS, async (request) => {
  const { centerId, reportId } = ids(request);
  await requireManager(request, centerId, { permission: "finalize" });
  const snap = await reportRef(centerId, reportId).get();
  if (!snap.exists) throw new HttpsError("not-found", "Report not found.");
  if (snap.data().status !== "finalized") throw new HttpsError("failed-precondition", "Only a finalized report has a PDF.");
  try {
    return { pdfUrl: await generateAndStorePdf(centerId, reportId) };
  } catch (err) {
    logger.error("regenerateInspectionReportPdf failed", { centerId, reportId, error: String(err) });
    throw new HttpsError("internal", "Couldn't generate the PDF. Please try again.");
  }
});

// ── Reopen ───────────────────────────────────────────────────────────────────

/**
 * Owner/Manager only. Back to draft; keeps the report number, and revokes
 * nothing (share link and portal visibility are untouched). The PDF is
 * regenerated the next time the report is finalized.
 */
exports.reopenInspectionReport = onCall(CALLABLE_OPTIONS, async (request) => {
  const { centerId, reportId } = ids(request);
  await requireManager(request, centerId, { permission: "finalize" });
  const ref = reportRef(centerId, reportId);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Report not found.");
    if (snap.data().status !== "finalized") return; // already a draft: nothing to do
    tx.update(ref, { status: "draft", updatedAt: FieldValue.serverTimestamp() });
  });
  return { ok: true };
});

// ── Sharing ──────────────────────────────────────────────────────────────────
//
// Same model as the diagnostic reports' /r/:shareToken: the token on the report
// is the key; the callable can tell "no such token" from "revoked" (a rules-gated
// client query could not); only whitelisted fields leave the server, and the
// customer's phone is not among them. Switching the module off does NOT stop
// these — links already sent keep working. Revoking is the Owner's switch.

const TOKEN_RE = /^[A-Za-z0-9]{32}$/;

async function findReportByToken(shareToken) {
  if (!TOKEN_RE.test(shareToken)) return null;
  const snap = await db().collectionGroup("inspectionReports").where("shareToken", "==", shareToken).limit(1).get();
  return snap.empty ? null : snap.docs[0];
}

/** The fields a customer may see. Media is limited to what the report references. */
function toPublicReport(r) {
  const referenced = new Set([...(r.attachmentIds || [])]);
  for (const res of Object.values(r.results || {})) for (const id of (res && res.photoIds) || []) referenced.add(id);
  const media = {};
  for (const id of referenced) {
    const m = (r.media || {})[id];
    if (!m) continue;
    media[id] = {
      id, kind: m.kind, name: m.name, mimeType: m.mimeType, sizeBytes: m.sizeBytes || 0,
      mediaDeleted: m.mediaDeleted === true, url: m.mediaDeleted === true ? null : (m.url || null),
    };
  }
  const results = {};
  for (const [id, res] of Object.entries(r.results || {})) {
    results[id] = { status: (res && res.status) || null, remark: (res && res.remark) || "", photoIds: (res && res.photoIds) || [] };
  }
  const h = r.header || {};
  return {
    reportNumber: r.reportNumber,
    type: r.type,
    title: r.title || "",
    findings: r.findings || "",
    reportDateMillis: r.reportDate && r.reportDate.toMillis ? r.reportDate.toMillis() : null,
    finalizedAtMillis: r.finalizedAt && r.finalizedAt.toMillis ? r.finalizedAt.toMillis() : null,
    mileage: r.mileage == null ? null : r.mileage,
    inspectorName: r.inspectorName || "",
    signatureName: r.signatureName || "",
    observations: r.observations || "",
    recommendations: r.recommendations || "",
    disclaimer: r.disclaimer || "",
    templateSnapshot: r.templateSnapshot || [],
    reportOnlyItems: r.reportOnlyItems || [],
    results,
    media,
    attachmentIds: r.attachmentIds || [],
    pdfUrl: r.pdfUrl || null,
    vehicle: { plateNumber: h.plateNumber || "", make: h.make || "", model: h.model || "", vehicleType: h.vehicleType || "" },
    customerName: h.customerName || "",
  };
}

exports.getPublicInspectionReport = onCall({ invoker: "public" }, async (request) => {
  const shareToken = String(request.data?.shareToken || "").trim();
  if (!shareToken) throw new HttpsError("invalid-argument", "Missing shareToken.");
  const doc = await findReportByToken(shareToken);
  if (!doc) return { found: false };
  const r = doc.data();
  const centerSnap = await db().doc(`servicecenters/${doc.ref.parent.parent.id}`).get();
  const c = centerSnap.exists ? centerSnap.data() : {};
  const center = { name: c.name || "Service Center", logoUrl: c.logoUrl || null, phone: c.phone || null };

  if (r.shareRevoked === true) return { found: true, state: "revoked", center };
  // Never finalized: nothing to show a customer yet.
  if (!r.reportNumber) return { found: true, state: "notReady", center };
  // Reopened for edits: the draft isn't shown. The last issued PDF stays available.
  if (r.status !== "finalized") {
    return { found: true, state: "updating", center, reportNumber: r.reportNumber, pdfUrl: r.pdfUrl || null };
  }
  return { found: true, state: "ready", center, report: toPublicReport(r) };
});

// Per-token throttle for view tracking, warm-instance scoped (same reasoning as
// trackReportView): the aim is to keep a reload loop or a bot from inflating
// viewCount, not a hard global limit.
const viewThrottle = new Map();
const VIEW_THROTTLE_MS = 30 * 1000;

exports.trackInspectionReportView = onCall({ invoker: "public" }, async (request) => {
  const shareToken = String(request.data?.shareToken || "").trim();
  if (!TOKEN_RE.test(shareToken)) return { tracked: false };
  const last = viewThrottle.get(shareToken);
  const now = Date.now();
  if (last && now - last < VIEW_THROTTLE_MS) return { tracked: false };
  viewThrottle.set(shareToken, now);

  const doc = await findReportByToken(shareToken);
  if (!doc) return { tracked: false };
  const r = doc.data();
  if (r.shareRevoked === true || !r.reportNumber) return { tracked: false };
  await doc.ref.update({
    viewCount: FieldValue.increment(1),
    lastViewedAt: FieldValue.serverTimestamp(),
    // First view only.
    viewedAt: r.viewedAt || FieldValue.serverTimestamp(),
  });
  return { tracked: true };
});

/** Owner only. `revoked: false` restores the link. Works even with the module off. */
exports.revokeInspectionReportLink = onCall(CALLABLE_OPTIONS, async (request) => {
  const { centerId, reportId } = ids(request);
  const { role } = await requireManager(request, centerId, { needModule: false });
  if (role !== "Owner") throw new HttpsError("permission-denied", "Only the Owner can revoke or restore a report link.");
  const ref = reportRef(centerId, reportId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Report not found.");
  const revoked = request.data?.revoked !== false;
  await ref.update({ shareRevoked: revoked, updatedAt: FieldValue.serverTimestamp() });
  return { shareRevoked: revoked };
});

// ── Customer portal list ─────────────────────────────────────────────────────
//
// The portal (/c/:centerId/:customerId) is an unauthenticated page whose only
// credential is knowing those two ids. Reports can't be publicly readable, so
// its "Reports" tab is fed by this callable: finalized, customer-visible,
// not-revoked reports for that customer, newest first, one page at a time.
// Row ids are the reports' share tokens — the same key the /i/ page uses — so
// nothing else about a report is exposed here. Hidden entirely (enabled: false)
// while the centre has the module switched off.

const PORTAL_PAGE_SIZE = 20;
const PORTAL_MAX_QUERIES = 4; // revoked reports are filtered after the query

exports.getPortalInspectionReports = onCall({ invoker: "public" }, async (request) => {
  const centerId = String(request.data?.centerId || "").trim();
  const customerId = String(request.data?.customerId || "").trim();
  const cursorId = String(request.data?.cursor || "").trim();
  if (!centerId || !customerId) throw new HttpsError("invalid-argument", "Missing centerId or customerId.");

  const [centerSnap, customerSnap] = await Promise.all([
    db().doc(`servicecenters/${centerId}`).get(),
    db().doc(`servicecenters/${centerId}/customers/${customerId}`).get(),
  ]);
  if (!centerSnap.exists || centerSnap.data().standaloneInspectionEnabled !== true) {
    return { enabled: false, reports: [], cursor: null, hasMore: false };
  }
  if (!customerSnap.exists || customerSnap.data().isDeleted === true) {
    return { enabled: true, reports: [], cursor: null, hasMore: false };
  }

  const base = db().collection(`servicecenters/${centerId}/inspectionReports`)
    .where("customerId", "==", customerId)
    .where("status", "==", "finalized")
    .where("visibleToCustomer", "==", true)
    .orderBy("finalizedAt", "desc");

  let after = null;
  if (cursorId) {
    const c = await db().doc(`servicecenters/${centerId}/inspectionReports/${cursorId}`).get();
    if (c.exists) after = c;
  }

  const reports = [];
  let last = null;
  let exhausted = false;
  for (let q = 0; q < PORTAL_MAX_QUERIES && reports.length < PORTAL_PAGE_SIZE && !exhausted; q++) {
    const need = PORTAL_PAGE_SIZE - reports.length;
    const snap = await (after ? base.startAfter(after) : base).limit(need).get();
    for (const d of snap.docs) {
      last = d;
      const r = d.data();
      if (r.shareRevoked === true) continue;
      reports.push({
        shareToken: r.shareToken,
        reportNumber: r.reportNumber,
        type: r.type,
        plateNumber: (r.header && r.header.plateNumber) || "",
        finalizedAtMillis: r.finalizedAt && r.finalizedAt.toMillis ? r.finalizedAt.toMillis() : null,
        needsRepair: needsRepairCount(r),
      });
    }
    after = last;
    if (snap.size < need) exhausted = true;
  }
  return { enabled: true, reports, cursor: last ? last.id : null, hasMore: !exhausted };
});

// ── Retention ────────────────────────────────────────────────────────────────

// 02:30 Colombo, half an hour after the job-card inspection's own cleanup
// (dailyInspectionCleanup, 02:00), which is a separate function and untouched.
exports.dailyStandaloneInspectionCleanup = onSchedule(
  { schedule: "every day 02:30", timeZone: "Asia/Colombo", memory: "256MiB", timeoutSeconds: 540 },
  async () => { await runStandaloneInspectionCleanup(); },
);
