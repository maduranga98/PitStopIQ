/**
 * Inspection Reports: 12-month image retention.
 *
 * Finalizing a report stamps `mediaDeleteAt` on each image (photos and image
 * attachments) and the earliest of them on the report as `nextMediaDeleteAt`.
 * This deletes images whose date has passed from Storage, clears their `url`,
 * and marks them `mediaDeleted: true` — the app and the PDF then show
 * "Photo expired". Report text and the generated PDF are kept permanently, and
 * PDF attachments never expire (they carry no `mediaDeleteAt`).
 *
 * Separate from dailyInspectionCleanup (the job-card inspection's 30-day photo
 * purge), which is untouched. Lives in its own file so it can be run directly
 * in tests; the schedule is declared in inspectionReports.js.
 */
const admin = require("firebase-admin");
const { Timestamp } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

const PAGE_SIZE = 100;
const MAX_PAGES = 50; // bounds a run; whatever is left is picked up tomorrow

// Mirrors inspectionMediaStoragePath in src/lib/inspectionReports/paths.ts.
const mediaPath = (centerId, reportId, fileId) => `inspectionReports/${centerId}/${reportId}/${fileId}`;

async function runStandaloneInspectionCleanup(now = new Date(), bucket = admin.storage().bucket()) {
  const db = admin.firestore();
  const due = Timestamp.fromDate(now);
  const seen = new Set();
  let reports = 0;
  let expired = 0;
  let failed = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const snap = await db.collectionGroup("inspectionReports").where("nextMediaDeleteAt", "<=", due).limit(PAGE_SIZE).get();
    const fresh = snap.docs.filter((d) => !seen.has(d.ref.path));
    // Everything returned was already handled this run (a delete kept failing
    // and the report stayed due): stop, tomorrow's run retries.
    if (fresh.length === 0) break;

    for (const doc of fresh) {
      seen.add(doc.ref.path);
      const r = doc.data();
      const centerId = doc.ref.parent.parent.id;
      const patch = {};
      let nextDue = null;
      const keepDue = (at) => { if (!nextDue || at < nextDue) nextDue = at; };

      for (const [id, m] of Object.entries(r.media || {})) {
        if (!m || m.mediaDeleted === true) continue;
        const at = m.mediaDeleteAt && m.mediaDeleteAt.toDate ? m.mediaDeleteAt.toDate() : null;
        if (!at) continue;
        if (at > now) { keepDue(at); continue; }
        try {
          await bucket.file(mediaPath(centerId, doc.id, id)).delete({ ignoreNotFound: true });
          patch[`media.${id}.url`] = null;
          patch[`media.${id}.mediaDeleted`] = true;
          expired += 1;
        } catch (err) {
          // Leave it marked due so the next run retries it.
          failed += 1;
          keepDue(at);
          logger.warn("inspection cleanup: could not delete image", { path: doc.ref.path, mediaId: id, error: String(err) });
        }
      }
      patch.nextMediaDeleteAt = nextDue ? Timestamp.fromDate(nextDue) : null;
      await doc.ref.update(patch);
      reports += 1;
    }
  }
  logger.info("dailyStandaloneInspectionCleanup: done", { reports, expired, failed });
  return { reports, expired, failed };
}

module.exports = { runStandaloneInspectionCleanup };
