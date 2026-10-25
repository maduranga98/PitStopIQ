/**
 * One-off backfill for the invoice `financeFinalized` flag.
 *
 * `financeFinalized` is set when "Finalize & Send SMS" is clicked and gates
 * Mark as Partial / Mark as Paid. An invoice finalized before the flag existed
 * (`finalized: true`) must stay payable, so this stamps it on every such
 * invoice across every center.
 *
 * Invoices only: the matching job cards are NOT touched, so already-finalized
 * jobs are not retroactively frozen (status / technicians stay editable as
 * before until their invoice is finalized again under the new flow).
 *
 * Usage (from functions/):
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
 *     node scripts/backfill-finance-finalized.js [--dry-run]
 */

const admin = require("firebase-admin");

admin.initializeApp();

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const db = admin.firestore();
  const snap = await db.collectionGroup("invoices").where("finalized", "==", true).get();

  console.log(`Found ${snap.size} finalized invoices across all centers.`);

  let batch = db.batch();
  let batchCount = 0;
  let updated = 0;

  for (const doc of snap.docs) {
    if (doc.data().financeFinalized === true) continue; // already correct

    updated += 1;
    if (DRY_RUN) continue;
    batch.update(doc.ref, { financeFinalized: true });
    batchCount += 1;
    if (batchCount === 400) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) await batch.commit();

  console.log(`${DRY_RUN ? "Would backfill" : "Backfilled"} financeFinalized on ${updated} invoices.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
