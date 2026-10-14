/**
 * One-off backfill for the `belowThreshold` flag now maintained by the
 * maintainInventoryBelowThresholdFlag Cloud Function trigger (see
 * ../index.js).
 *
 * The trigger only fires on future writes, so parts that are already at or
 * under their reorder threshold right now (i.e. haven't had a quantity
 * change since the fix shipped) would otherwise stay invisible to the
 * dashboard's bounded `where("belowThreshold", "==", true)` query until
 * their stock next moves. Run this once after deploying the function to
 * backfill every existing inventory item across every center.
 *
 * Usage (from functions/):
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
 *     node scripts/backfill-inventory-threshold-flags.js
 *
 * Or, if you're already `firebase login`'d with access to the pitstopiq
 * project, application-default credentials work too:
 *   gcloud auth application-default login
 *   node scripts/backfill-inventory-threshold-flags.js
 */

const admin = require("firebase-admin");

admin.initializeApp();

async function main() {
  const db = admin.firestore();
  const snap = await db.collectionGroup("inventory").get();

  console.log(`Found ${snap.size} inventory items across all centers.`);

  let batch = db.batch();
  let batchCount = 0;
  let updated = 0;
  let lowCount = 0;

  for (const doc of snap.docs) {
    const item = doc.data();
    const belowThreshold =
      typeof item.currentQty === "number" &&
      typeof item.threshold === "number" &&
      item.currentQty <= item.threshold;

    if (item.belowThreshold === belowThreshold) continue; // already correct

    batch.update(doc.ref, { belowThreshold });
    batchCount += 1;
    updated += 1;
    if (belowThreshold) lowCount += 1;

    if (batchCount === 400) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) await batch.commit();

  console.log(`Backfilled belowThreshold on ${updated} inventory items (${lowCount} currently low).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
