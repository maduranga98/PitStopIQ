// Shared inventory item search for pickers that let staff pull a part onto a
// job (NewServicePage, ServiceDetailPage) — matches on the item's name OR its
// part/item code, since a technician often has the code off a box or invoice
// but not the exact product name.
import { collection, getDocs } from "firebase/firestore";
import { db } from "../config/firebase";
import { cachedFetch } from "./refCache";
import { invalidateRefData, refKey } from "./refData";
import type { InventoryItem } from "../types/auth";

// How many matches the picker shows — inventory search is a quick-pick
// dropdown, not a full browse, so this just keeps a very generic term (e.g.
// "oil") from dumping the whole catalog into the list.
const MAX_RESULTS = 20;

// Firestore cannot do case-insensitive or substring matching, so the catalog
// has to be filtered client-side (see the search notes below). That makes the
// catalog itself the unit worth caching: one fetch serves every keystroke in a
// search session and every picker opened afterwards, instead of re-reading —
// and re-billing — the whole collection each time. 5 minutes is well inside how
// often a parts catalog actually changes, and the write paths that DO change it
// call invalidateInventoryCache() below.
const CATALOG_TTL_MS = 5 * 60_000;

// Shares the canonical reference-cache key scheme (`${centerId}:inventory`) so
// that every inventory write going through firestoreWrite.ts drops this catalog
// automatically, on top of the explicit invalidation below.
const catalogKey = (centerId: string) => refKey(centerId, "inventory");

/** Load the center's inventory catalog, from cache when it is still fresh. */
async function loadCatalog(centerId: string): Promise<InventoryItem[]> {
  return cachedFetch(
    catalogKey(centerId),
    async () => {
      const snap = await getDocs(collection(db, "servicecenters", centerId, "inventory"));
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryItem));
    },
    CATALOG_TTL_MS,
  );
}

/**
 * Drop the cached catalog for a center. Call this after any write that changes
 * what the picker should show — adding, editing, archiving, or restocking an
 * item — so the next search reflects it immediately instead of waiting out the
 * TTL.
 */
export function invalidateInventoryCache(centerId: string): void {
  invalidateRefData(centerId, "inventory");
}

/**
 * Case-insensitive substring search of inventory by name and by partNumber.
 *
 * This used to be a Firestore prefix-range query (`name >= term && name <=
 * term + ""`), which only matches values starting with `term` in the
 * exact case stored — typing "oil" would never find an item saved as "Oil
 * Filter", and vice versa. Firestore has no case-insensitive query, so this
 * filters the center's catalog client-side instead, same as the main Inventory
 * list's search already does. The catalog comes from the cache above, so a
 * burst of keystrokes costs one read set rather than one per query.
 */
export async function searchInventoryItems(centerId: string, term: string): Promise<InventoryItem[]> {
  const trimmed = term.trim().toLowerCase();
  if (!trimmed) return [];
  const catalog = await loadCatalog(centerId);
  const matches = catalog
    .filter((item) => !item.isArchived)
    .filter((item) =>
      item.name.toLowerCase().includes(trimmed) ||
      (item.partNumber ?? "").toLowerCase().includes(trimmed));
  return matches.slice(0, MAX_RESULTS);
}
