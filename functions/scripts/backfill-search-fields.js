/**
 * backfill-search-fields.js — populate searchPlate and searchName on records
 * that existed before the maintainVehicleSearchFields /
 * maintainCustomerSearchFields triggers shipped.
 *
 * The triggers only fire on future writes, so without this a centre's existing
 * vehicles and customers are invisible to any query that filters on those
 * fields — which would be worse than not having the feature at all, because the
 * search would silently return nothing for records that plainly exist.
 *
 * DRY RUN BY DEFAULT. Nothing is written unless you pass --apply.
 *
 * Usage (from functions/):
 *   node scripts/backfill-search-fields.js                      # every centre, dry run
 *   node scripts/backfill-search-fields.js --center <centerId>
 *   node scripts/backfill-search-fields.js --apply
 *
 * Safe to re-run: records already carrying the correct value are skipped, so a
 * second run writes nothing.
 */

const admin = require("firebase-admin");

admin.initializeApp();

const BATCH_LIMIT = 400; // Firestore's cap is 500; leave headroom.

function toSearchPlate(plate) {
  return String(plate || "").toLowerCase().replace(/[\s\-/.]/g, "");
}

function toSearchName(name) {
  return String(name || "").toLowerCase().trim().replace(/\s+/g, " ");
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function backfill(centerId, subcol, sourceField, targetField, derive, apply) {
  const col = admin.firestore().collection(`servicecenters/${centerId}/${subcol}`);
  const snap = await col.get();

  let batch = admin.firestore().batch();
  let inBatch = 0;
  let updated = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const value = derive(data[sourceField]);
    if (data[targetField] === value) continue; // already correct
    updated += 1;
    if (!apply) continue;
    batch.update(doc.ref, { [targetField]: value });
    inBatch += 1;
    if (inBatch >= BATCH_LIMIT) {
      await batch.commit();
      batch = admin.firestore().batch();
      inBatch = 0;
    }
  }
  if (apply && inBatch > 0) await batch.commit();

  return { scanned: snap.size, updated };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const only = arg("--center");
  const db = admin.firestore();

  const centers = only
    ? [await db.doc(`servicecenters/${only}`).get()]
    : (await db.collection("servicecenters").get()).docs;

  let totalUpdated = 0;
  for (const c of centers) {
    if (!c.exists) {
      console.error(`✗ No such centre: ${only}`);
      process.exit(1);
    }
    const name = c.data().name ?? "(unnamed)";
    const v = await backfill(c.id, "vehicles", "plateNumber", "searchPlate", toSearchPlate, apply);
    const cu = await backfill(c.id, "customers", "name", "searchName", toSearchName, apply);
    totalUpdated += v.updated + cu.updated;
    console.log(
      `  ${name} (${c.id}): ` +
      `vehicles ${v.updated}/${v.scanned}, customers ${cu.updated}/${cu.scanned}`
    );
  }

  console.log("\n" + "─".repeat(60));
  console.log(`  ${totalUpdated} record${totalUpdated === 1 ? "" : "s"} need${totalUpdated === 1 ? "s" : ""} a search field.`);
  if (apply) {
    console.log("  Written.");
  } else {
    console.log("  DRY RUN — nothing was written. Re-run with --apply.");
  }
  console.log("  This only adds a derived field; no existing data is modified.");
}

main().catch((err) => {
  console.error("backfill-search-fields failed:", err);
  process.exit(1);
});
