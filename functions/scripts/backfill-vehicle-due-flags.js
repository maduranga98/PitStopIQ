/**
 * One-off backfill for the `dueForService` flag now maintained by the
 * maintainVehicleDueFlag Cloud Function trigger (see ../index.js).
 *
 * The trigger only fires on future writes, so vehicles that are already
 * overdue right now (i.e. haven't had a mileage update since the fix
 * shipped) would otherwise stay invisible to the dashboard's bounded
 * `where("dueForService", "==", true)` query until their next service.
 * Run this once after deploying the function to backfill every existing
 * vehicle across every center.
 *
 * Usage (from functions/):
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
 *     node scripts/backfill-vehicle-due-flags.js
 *
 * Or, if you're already `firebase login`'d with access to the pitstopiq
 * project, application-default credentials work too:
 *   gcloud auth application-default login
 *   node scripts/backfill-vehicle-due-flags.js
 */

const admin = require("firebase-admin");

admin.initializeApp();

async function main() {
  const db = admin.firestore();
  const snap = await db.collectionGroup("vehicles").get();

  console.log(`Found ${snap.size} vehicles across all centers.`);

  let batch = db.batch();
  let batchCount = 0;
  let updated = 0;
  let dueCount = 0;

  for (const doc of snap.docs) {
    const v = doc.data();
    const dueForService =
      typeof v.nextServiceMileageKm === "number" &&
      typeof v.currentMileageKm === "number" &&
      v.nextServiceMileageKm - v.currentMileageKm <= 0;

    if (v.dueForService === dueForService) continue; // already correct

    batch.update(doc.ref, { dueForService });
    batchCount += 1;
    updated += 1;
    if (dueForService) dueCount += 1;

    if (batchCount === 400) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) await batch.commit();

  console.log(`Backfilled dueForService on ${updated} vehicles (${dueCount} currently due).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
