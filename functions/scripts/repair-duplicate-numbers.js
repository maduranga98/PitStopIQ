/**
 * repair-duplicate-numbers.js — find, and optionally renumber, invoices and job
 * cards that share a number.
 *
 * Numbers are allocated on the client so a bill can be written up with no
 * connection (see flagDuplicateInvoiceNumber in ../index.js). The cost is that
 * two devices, or one working offline, can mint the same number. The trigger
 * flags the later document; this is the tool for clearing them up once a human
 * has decided it is safe.
 *
 * The earliest document always keeps its number. Only the later one is
 * renumbered, and its original number is recorded on it so the change is
 * traceable — a renumbered invoice that was already printed can still be
 * matched to the paper copy.
 *
 * DRY RUN BY DEFAULT. Nothing is written unless you pass --apply.
 *
 * Usage (from functions/):
 *   node scripts/repair-duplicate-numbers.js                      # every centre, dry run
 *   node scripts/repair-duplicate-numbers.js --center <centerId>  # one centre
 *   node scripts/repair-duplicate-numbers.js --apply              # renumber
 */

const admin = require("firebase-admin");

admin.initializeApp();

const COLLECTIONS = [
  { subcol: "invoices", field: "invoiceNumber", originalField: "originalInvoiceNumber" },
  { subcol: "jobs", field: "jobNumber", originalField: "originalJobNumber" },
];

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

/** Groups of documents sharing a number, earliest first within each group. */
function findDuplicates(docs, field) {
  const byNumber = new Map();
  for (const d of docs) {
    const value = d.data()[field];
    if (!value || typeof value !== "string") continue;
    if (!byNumber.has(value)) byNumber.set(value, []);
    byNumber.get(value).push(d);
  }
  const groups = [];
  for (const [value, group] of byNumber) {
    if (group.length < 2) continue;
    group.sort((a, b) => {
      const at = a.data().createdAt?.toMillis?.() ?? 0;
      const bt = b.data().createdAt?.toMillis?.() ?? 0;
      return at === bt ? a.id.localeCompare(b.id) : at - bt;
    });
    groups.push({ value, group });
  }
  return groups;
}

/**
 * The next free number after `taken`, keeping the same prefix.
 * "INV-2026-09-0017" -> "INV-2026-09-0018", skipping anything already used.
 */
function nextFreeNumber(value, taken) {
  const m = value.match(/^(.*?)(\d+)$/);
  if (!m) return null;
  const [, prefix, digits] = m;
  let n = parseInt(digits, 10);
  for (let guard = 0; guard < 10000; guard++) {
    n += 1;
    const candidate = prefix + String(n).padStart(digits.length, "0");
    if (!taken.has(candidate)) return candidate;
  }
  return null;
}

async function repairCenter(centerId, centerName, apply) {
  let found = 0;
  let repaired = 0;

  for (const { subcol, field, originalField } of COLLECTIONS) {
    const snap = await admin.firestore()
      .collection(`servicecenters/${centerId}/${subcol}`)
      .get();
    const taken = new Set(snap.docs.map((d) => d.data()[field]).filter(Boolean));
    const groups = findDuplicates(snap.docs, field);
    if (groups.length === 0) continue;

    console.log(`\n  ${centerName} (${centerId}) — ${subcol}`);
    for (const { value, group } of groups) {
      found += group.length - 1;
      const [keeper, ...losers] = group;
      console.log(`    ${value}  (${group.length} documents)`);
      console.log(`      keep     ${keeper.id}  created ${keeper.data().createdAt?.toDate?.()?.toISOString() ?? "?"}`);
      for (const loser of losers) {
        const replacement = nextFreeNumber(value, taken);
        if (!replacement) {
          console.log(`      SKIP     ${loser.id}  — could not derive a free number from "${value}"`);
          continue;
        }
        taken.add(replacement);
        console.log(`      renumber ${loser.id}  ${value} -> ${replacement}`);
        if (apply) {
          await loser.ref.update({
            [field]: replacement,
            [originalField]: value,
            numberConflict: false,
            numberConflictWith: admin.firestore.FieldValue.delete(),
            renumberedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          repaired += 1;
        }
      }
    }
  }
  return { found, repaired };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const only = arg("--center");
  const db = admin.firestore();

  const centers = only
    ? [await db.doc(`servicecenters/${only}`).get()]
    : (await db.collection("servicecenters").get()).docs;

  let found = 0;
  let repaired = 0;
  for (const c of centers) {
    if (!c.exists) {
      console.error(`✗ No such centre: ${only}`);
      process.exit(1);
    }
    const r = await repairCenter(c.id, c.data().name ?? "(unnamed)", apply);
    found += r.found;
    repaired += r.repaired;
  }

  console.log("\n" + "─".repeat(60));
  if (found === 0) {
    console.log("  No duplicate numbers found.");
    return;
  }
  console.log(`  ${found} duplicate-numbered document${found === 1 ? "" : "s"} found.`);
  if (apply) {
    console.log(`  ${repaired} renumbered. Their previous numbers are recorded on each document.`);
  } else {
    console.log("  DRY RUN — nothing was written. Re-run with --apply to renumber.");
    console.log("  Check first whether any of these have already been printed and given out.");
  }
}

main().catch((err) => {
  console.error("repair-duplicate-numbers failed:", err);
  process.exit(1);
});
