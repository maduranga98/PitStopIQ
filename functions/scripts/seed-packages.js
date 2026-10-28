/**
 * Seeds the fixed sales packages used for caller commission.
 *
 *   packages/basic  { name: "Basic", price: 4999, commissionRate: 0.20 }
 *   packages/pro    { name: "Pro",   price: 7999, commissionRate: 0.20 }
 *
 * The rules deny every client write to packages/, so this script (or the
 * Firebase Console) is the only way to change them.
 *
 * Changing a price or rate later: edit PACKAGES below and re-run with --force.
 * Leads already converted keep the commissionAmount they were stamped with —
 * it is a snapshot taken at conversion, so a price change is never retroactive.
 *
 * Existing docs are skipped unless --force is passed, so re-running is safe.
 *
 * Usage (from functions/):
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
 *     node scripts/seed-packages.js [--dry-run] [--force]
 */

const admin = require("firebase-admin");

admin.initializeApp();

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

const PACKAGES = {
  basic: { name: "Basic", price: 4999, commissionRate: 0.2 },
  pro: { name: "Pro", price: 7999, commissionRate: 0.2 },
};

async function main() {
  const db = admin.firestore();

  for (const [id, data] of Object.entries(PACKAGES)) {
    const ref = db.collection("packages").doc(id);
    const exists = (await ref.get()).exists;

    if (exists && !FORCE) {
      console.log(`packages/${id} exists — skipped (use --force to overwrite).`);
      continue;
    }

    console.log(
      `${DRY_RUN ? "Would write" : "Writing"} packages/${id}: ${JSON.stringify(data)}`
    );
    if (!DRY_RUN) await ref.set(data);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
