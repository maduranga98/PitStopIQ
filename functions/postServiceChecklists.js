/**
 * Post-service checklists — server side: the report PDF.
 *
 * generatePostServiceChecklistPdf renders a SIGNED-OFF checklist (a standalone
 * record, or the one on a job card) to PDF, stores it, and records
 * pdfUrl / pdfPath / pdfGeneratedAt on the record. It mirrors the inspection
 * report PDF (inspectionReports.js): PDFKit, written to Storage with the Admin
 * SDK, and a tokened download URL — the token is the credential a customer
 * link carries, so the Storage rules never need to open reads to the public.
 *
 * There is no generateInvoicePdf in this codebase (invoices print in the
 * browser), so this follows the one server-side PDF that does exist.
 *
 * Loaded from index.js with one line, so none of the existing functions are
 * touched. The rules refuse client writes to the PDF fields on both kinds of
 * record, so this is the only way they get set.
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const crypto = require("crypto");
const { renderChecklistPdf } = require("./postServiceChecklistPdf");
const { reportFromRecord } = require("./postServiceChecklistReport");

const CALLABLE_OPTIONS = { memory: "512MiB", timeoutSeconds: 120 };
// The roles that can open a checklist at all — Cashier and Receptionist never see one.
const VIEW_ROLES = ["Owner", "Manager", "Technician"];

const db = () => admin.firestore();

// Mirrors src/lib/postServiceChecklistPdf.ts and the Storage rule for this folder.
const recordKey = (kind, id) => `${kind === "job" ? "job" : "standalone"}-${id}`;
const pdfPath = (centerId, kind, id) => `postServiceChecklists/${centerId}/${recordKey(kind, id)}/report.pdf`;

/** Same shape getDownloadURL() returns on the client; the token is the credential. */
function buildDownloadUrl(bucketName, filePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
}

function recordRef(centerId, kind, id) {
  return kind === "job"
    ? db().doc(`servicecenters/${centerId}/jobs/${id}/postServiceChecklist/main`)
    : db().doc(`servicecenters/${centerId}/postServiceChecklists/${id}`);
}

// PDFKit takes JPEG/PNG only; logos are often WebP or SVG. (Same helper as the
// inspection report PDF, which does not export its own.)
async function fetchLogo(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return await require("sharp")(Buffer.from(await res.arrayBuffer()))
      .resize({ width: 240, height: 240, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  } catch (err) {
    logger.warn("checklist pdf: logo unavailable", { error: String(err) });
    return null;
  }
}

/** A signed-in, active Owner / Manager / Technician of a Pro centre that has the module on. */
async function requireViewer(request, centerId) {
  if (!request.auth) throw new HttpsError("unauthenticated", "You must be signed in.");
  const [staffSnap, centerSnap] = await Promise.all([
    db().doc(`servicecenters/${centerId}/staff/${request.auth.uid}`).get(),
    db().doc(`servicecenters/${centerId}`).get(),
  ]);
  const staff = staffSnap.exists ? staffSnap.data() : null;
  if (!staff || staff.active === false || !VIEW_ROLES.includes(staff.role)) {
    throw new HttpsError("permission-denied", "You don't have access to post-service checklists.");
  }
  const center = centerSnap.exists ? centerSnap.data() : null;
  if (!center || center.plan !== "pro" || center.postServiceChecklistEnabled !== true) {
    throw new HttpsError("failed-precondition", "Post-Service Checklist is switched off for this centre.");
  }
  return center;
}

const staffName = (s) => (s && (s.fullName || s.displayName || s.email)) || "";

async function generateAndStorePdf(centerId, kind, id, center) {
  const ref = recordRef(centerId, kind, id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Checklist not found.");
  const record = snap.data();
  if (!record.completedAt) throw new HttpsError("failed-precondition", "Only a signed-off checklist has a report.");

  const get = async (path) => { const d = await db().doc(path).get(); return d.exists ? d.data() : null; };
  const base = `servicecenters/${centerId}`;
  const [signer, job, customer, vehicle] = await Promise.all([
    record.completedBy ? get(`${base}/staff/${record.completedBy}`) : null,
    kind === "job" ? get(`${base}/jobs/${id}`) : null,
    kind === "standalone" && record.customerId ? get(`${base}/customers/${record.customerId}`) : null,
    kind === "standalone" && record.vehicleId ? get(`${base}/vehicles/${record.vehicleId}`) : null,
  ]);

  const buffer = await renderChecklistPdf({
    report: reportFromRecord({ kind, record, job, customer, vehicle, signerName: staffName(signer) }),
    center: { name: center.name || "Service Center", phone: center.phone || "", logo: await fetchLogo(center.logoUrl) },
  });

  // Keep the token across regenerations so a link to the PDF already sent stays valid.
  const previous = typeof record.pdfUrl === "string" ? new URL(record.pdfUrl).searchParams.get("token") : null;
  const token = previous || crypto.randomUUID();
  const bucket = admin.storage().bucket();
  const path = pdfPath(centerId, kind, id);
  await bucket.file(path).save(buffer, {
    resumable: false,
    metadata: { contentType: "application/pdf", cacheControl: "private, max-age=0", metadata: { firebaseStorageDownloadTokens: token } },
  });
  const pdfUrl = buildDownloadUrl(bucket.name, path, token);
  await ref.update({ pdfUrl, pdfPath: path, pdfGeneratedAt: FieldValue.serverTimestamp() });
  return pdfUrl;
}

/**
 * data: { centerId, kind: "standalone" | "job", id, regenerate?: boolean }
 * `id` is the standalone record id, or the job id for a job's checklist.
 * Returns the existing PDF unless `regenerate` is set — a signed-off record
 * never changes, so asking twice should not render twice.
 */
exports.generatePostServiceChecklistPdf = onCall(CALLABLE_OPTIONS, async (request) => {
  const centerId = String(request.data?.centerId || "").trim();
  const id = String(request.data?.id || "").trim();
  const kind = request.data?.kind === "job" ? "job" : request.data?.kind === "standalone" ? "standalone" : "";
  if (!centerId || !id || !kind) throw new HttpsError("invalid-argument", "Missing centerId, kind or id.");
  const center = await requireViewer(request, centerId);

  if (request.data?.regenerate !== true) {
    const snap = await recordRef(centerId, kind, id).get();
    const existing = snap.exists ? snap.data() : null;
    if (existing?.completedAt && typeof existing.pdfUrl === "string" && existing.pdfUrl) {
      return { pdfUrl: existing.pdfUrl, cached: true };
    }
  }
  try {
    return { pdfUrl: await generateAndStorePdf(centerId, kind, id, center), cached: false };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("generatePostServiceChecklistPdf failed", { centerId, kind, id, error: String(err) });
    throw new HttpsError("internal", "Couldn't generate the PDF. Please try again.");
  }
});
