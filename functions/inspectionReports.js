/**
 * Inspection Reports — server side (finalize, PDF, reopen).
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
  finalizeBlockers, formatReportNumber, yearInZone, mediaDeleteAt,
} = require("./shared/inspectionHelpers.mjs");
const { renderInspectionPdf } = require("./inspectionPdf");

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

/** Owner or Manager of the centre, with the module switched on. */
async function requireManager(request, centerId) {
  if (!request.auth) throw new HttpsError("unauthenticated", "You must be signed in.");
  const [staffSnap, centerSnap] = await Promise.all([
    db().doc(`servicecenters/${centerId}/staff/${request.auth.uid}`).get(),
    db().doc(`servicecenters/${centerId}`).get(),
  ]);
  const staff = staffSnap.exists ? staffSnap.data() : null;
  if (!staff || staff.active === false || (staff.role !== "Owner" && staff.role !== "Manager")) {
    throw new HttpsError("permission-denied", "Only the Owner or a Manager can do this.");
  }
  if (!centerSnap.exists || centerSnap.data().standaloneInspectionEnabled !== true) {
    throw new HttpsError("failed-precondition", "Inspection Reports is switched off for this centre.");
  }
  return { uid: request.auth.uid, role: staff.role, center: centerSnap.data() };
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
  const { uid } = await requireManager(request, centerId);
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
  await requireManager(request, centerId);
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
  await requireManager(request, centerId);
  const ref = reportRef(centerId, reportId);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Report not found.");
    if (snap.data().status !== "finalized") return; // already a draft: nothing to do
    tx.update(ref, { status: "draft", updatedAt: FieldValue.serverTimestamp() });
  });
  return { ok: true };
});
