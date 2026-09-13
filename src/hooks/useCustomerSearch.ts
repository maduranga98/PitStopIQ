// ── Customer picker search ─────────────────────────────────────────────────────
// The "Select customer…" dropdown on New Service, New Invoice and New
// Quotation. All three used to run the same search inline, and all three ran
// it the same expensive way:
//
//   allCustomers.filter(c =>
//     c.name.includes(q) || phoneMatches(c.phone, q) ||
//     allVehicles.some(v => v.customerId === c.id && v.plateNumber.includes(q)))
//
// That inner `some` walks the WHOLE vehicle list once per customer, so the cost
// is customers × vehicles — about 12 million string comparisons for a center
// with 3,000 customers and 4,000 vehicles. It then ran a second time, as a
// `.find`, to work out which plate to show under each matching row. None of it
// was memoised, so it re-ran on every render, and it ran synchronously inside
// the input's onChange — so it ran again on every keystroke, blocking the very
// keypress that triggered it. On a counter tablet that is a multi-second freeze
// per character typed, which reads as "the customer dropdown has hung".
//
// This hook fixes the shape of the problem rather than shaving constants off it:
//
//  1. Plates are indexed by customerId ONCE (a Map), so the per-customer plate
//     lookup is O(1) instead of O(vehicles). Cost drops from customers × vehicles
//     to customers + vehicles.
//  2. Each customer's searchable text is lower-cased once, when the list loads,
//     instead of on every comparison of every keystroke.
//  3. The filter runs against a deferred term (React 19's useDeferredValue), so
//     it can never block the keystroke that triggered it — React renders the
//     typed character first and abandons an in-progress filter when the next
//     key arrives.
//  4. The result is capped at MAX_RESULTS. Nobody picks a name out of 3,000 rows
//     — they type. Rendering every match meant building thousands of DOM nodes
//     the moment the dropdown opened, which was its own freeze on top of the
//     filtering.
import { useDeferredValue, useMemo } from "react";
import { phoneMatches } from "../lib/utils";
import type { Customer } from "../types/auth";

/** Rows the dropdown will render. Beyond this the answer is "type more", not
 *  "scroll further" — and the DOM stays small enough to open instantly. */
export const MAX_RESULTS = 50;

/** The subset of a vehicle the picker needs. Matches what the pages already
 *  keep in state, so nothing extra is read or held. */
export interface PickerVehicle {
  customerId: string;
  plateNumber: string;
}

export interface CustomerMatch {
  customer: Customer;
  /** The plate that matched the search, shown under the name so staff can tell
   *  two same-named customers apart. Undefined when the match wasn't by plate. */
  matchedPlate?: string;
}

export interface CustomerSearchResult {
  /** Capped, ready to render. */
  matches: CustomerMatch[];
  /** How many matched in total, so the UI can say "showing 50 of 214". */
  totalMatches: number;
  /** True when totalMatches exceeds what `matches` carries. */
  truncated: boolean;
}

/** One customer, with its searchable text pre-lowered and its plates attached. */
interface IndexedCustomer {
  customer: Customer;
  name: string;
  plates: { raw: string; lower: string }[];
}

/**
 * Search a center's customers by name, phone or vehicle plate.
 *
 * @param customers  Every customer (from the reference cache — see lib/refData).
 * @param vehicles   Every vehicle, used to match by plate number.
 * @param search     The raw, undebounced input value.
 */
export function useCustomerSearch(
  customers: Customer[],
  vehicles: PickerVehicle[],
  search: string,
): CustomerSearchResult {
  // useDeferredValue rather than a setTimeout debounce: React keeps rendering
  // the typed character at high priority and re-runs the filter below at low
  // priority, interrupting and restarting it if another key arrives first. So
  // the input never waits on the list, there is no fixed delay to tune, and a
  // fast typist pays for one pass instead of one per character.
  const term = useDeferredValue(search.trim().toLowerCase());

  // Built once per data load, not per keystroke. This is the whole trick: the
  // plate lookup below is a Map hit rather than a scan of every vehicle.
  const index = useMemo<IndexedCustomer[]>(() => {
    const platesByCustomer = new Map<string, { raw: string; lower: string }[]>();
    for (const v of vehicles) {
      if (!v.customerId || !v.plateNumber) continue;
      const entry = { raw: v.plateNumber, lower: v.plateNumber.toLowerCase() };
      const existing = platesByCustomer.get(v.customerId);
      if (existing) existing.push(entry);
      else platesByCustomer.set(v.customerId, [entry]);
    }
    return customers.map((customer) => ({
      customer,
      name: (customer.name ?? "").toLowerCase(),
      plates: platesByCustomer.get(customer.id) ?? [],
    }));
  }, [customers, vehicles]);

  return useMemo(() => {
    // No search term: the dropdown has just been opened. Show the first page
    // of the (already name-sorted) list rather than all of it.
    if (!term) {
      return {
        matches: index.slice(0, MAX_RESULTS).map((e) => ({ customer: e.customer })),
        totalMatches: index.length,
        truncated: index.length > MAX_RESULTS,
      };
    }

    const matches: CustomerMatch[] = [];
    let totalMatches = 0;

    for (const entry of index) {
      // The plate is resolved in the same pass that decides whether the row
      // matches at all — the old code searched once to filter and a second
      // time to find the plate to display.
      const plate = entry.plates.find((p) => p.lower.includes(term));
      const hit =
        entry.name.includes(term) ||
        phoneMatches(entry.customer.phone, term) ||
        plate !== undefined;
      if (!hit) continue;
      totalMatches++;
      // Keep scanning past the cap so the count stays honest, but stop building
      // rows — the expensive part is what React has to render, not the loop.
      if (matches.length < MAX_RESULTS) {
        matches.push({ customer: entry.customer, matchedPlate: plate?.raw });
      }
    }

    return { matches, totalMatches, truncated: totalMatches > matches.length };
  }, [index, term]);
}
