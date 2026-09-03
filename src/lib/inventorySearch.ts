// Shared inventory item search for pickers that let staff pull a part onto a
// job (NewServicePage, ServiceDetailPage) — matches on the item's name OR its
// part/item code, since a technician often has the code off a box or invoice
// but not the exact product name.
import { collection, getDocs } from "firebase/firestore";
import { db } from "../config/firebase";
import type { InventoryItem } from "../types/auth";

// How many matches the picker shows — inventory search is a quick-pick
// dropdown, not a full browse, so this just keeps a very generic term (e.g.
// "oil") from dumping the whole catalog into the list.
const MAX_RESULTS = 20;

/**
 * Case-insensitive substring search of inventory by name and by partNumber.
 *
 * This used to be a Firestore prefix-range query (`name >= term && name <=
 * term + ""`), which only matches values starting with `term` in the
 * exact case stored — typing "oil" would never find an item saved as "Oil
 * Filter", and vice versa. Firestore has no case-insensitive query, so this
 * fetches the center's inventory and filters client-side instead, same as
 * the main Inventory list's search already does.
 */
export async function searchInventoryItems(centerId: string, term: string): Promise<InventoryItem[]> {
  const trimmed = term.trim().toLowerCase();
  if (!trimmed) return [];
  const snap = await getDocs(collection(db, "servicecenters", centerId, "inventory"));
  const matches = snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as InventoryItem))
    .filter((item) => !item.isArchived)
    .filter((item) =>
      item.name.toLowerCase().includes(trimmed) ||
      (item.partNumber ?? "").toLowerCase().includes(trimmed));
  return matches.slice(0, MAX_RESULTS);
}
