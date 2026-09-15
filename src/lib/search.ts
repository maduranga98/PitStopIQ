// ── Server-side prefix search ─────────────────────────────────────────────────
//
// Firestore cannot match case-insensitively or on a substring. It CAN range-scan
// an indexed string, which gives a case-insensitive PREFIX match against a
// field stored already-lowercased — see maintainVehicleSearchFields and
// maintainCustomerSearchFields in functions/index.js, which maintain those
// mirrors, and scripts/backfill-search-fields.js for existing records.
//
// The range trick: every string beginning with `term` sorts between `term` and
// `term + ""`, because  is close to the top of the Basic
// Multilingual Plane. So a >= / <= pair is a prefix query.
//
// ── What this can and cannot replace ──────────────────────────────────────────
//
// PLATES: a straight win. "Find CAB-1234" is the commonest lookup at a counter,
// it is naturally a prefix question, and searchPlate has its separators stripped
// so "cab1234", "CAB-1234" and "CAB 1234" all match the same vehicle.
//
// NAMES: only a partial answer, and the reason the customer list has NOT been
// switched over to this. The list searches by substring today — typing "kumara"
// finds "Nimal Kumara" — and a prefix query cannot do that. Swapping it would
// make customers staff currently find unfindable, which is a worse bug than the
// one it would fix. searchName is maintained and queryable here for the cases
// where a prefix is the right question (an autocomplete, a large centre), but
// choosing it has to be a deliberate decision per screen, not a blanket swap.
import { collection, query, where, orderBy, limit as fsLimit } from "firebase/firestore";
import { db } from "../config/firebase";
import { boundedGetDocs } from "./firestoreRead";
import type { Customer, Vehicle } from "../types/auth";

/** Sorts above any character that can realistically follow a prefix. */
const HIGH_CODEPOINT = "";

/** Default cap. Nobody picks a row out of hundreds — they type more. */
export const SEARCH_LIMIT = 25;

/** The plate mirror's normalisation. Must match toSearchPlate in functions/index.js. */
export function toSearchPlate(plate: string): string {
  return String(plate ?? "").toLowerCase().replace(/[\s\-/.]/g, "");
}

/** The name mirror's normalisation. Must match toSearchName in functions/index.js. */
export function toSearchName(name: string): string {
  return String(name ?? "").toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Vehicles whose plate starts with `term`, ignoring case and separators.
 *
 * Returns an empty array for a blank term rather than the whole collection —
 * an empty search box must never turn into an unbounded read.
 */
export async function searchVehiclesByPlate(
  centerId: string,
  term: string,
  max = SEARCH_LIMIT,
): Promise<Vehicle[]> {
  const prefix = toSearchPlate(term);
  if (!prefix) return [];

  const snap = await boundedGetDocs(
    query(
      collection(db, "servicecenters", centerId, "vehicles"),
      where("searchPlate", ">=", prefix),
      where("searchPlate", "<=", prefix + HIGH_CODEPOINT),
      orderBy("searchPlate"),
      fsLimit(max),
    ),
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as Vehicle))
    .filter((v) => !v.isDeleted);
}

/**
 * Customers whose name starts with `term`, ignoring case.
 *
 * PREFIX ONLY — see the module header before reaching for this in place of an
 * existing substring search.
 */
export async function searchCustomersByNamePrefix(
  centerId: string,
  term: string,
  max = SEARCH_LIMIT,
): Promise<Customer[]> {
  const prefix = toSearchName(term);
  if (!prefix) return [];

  const snap = await boundedGetDocs(
    query(
      collection(db, "servicecenters", centerId, "customers"),
      where("searchName", ">=", prefix),
      where("searchName", "<=", prefix + HIGH_CODEPOINT),
      orderBy("searchName"),
      fsLimit(max),
    ),
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as Customer))
    .filter((c) => !c.isDeleted);
}
