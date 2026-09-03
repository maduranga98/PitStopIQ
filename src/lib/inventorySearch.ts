// Shared inventory item search for pickers that let staff pull a part onto a
// job (NewServicePage, ServiceDetailPage) — matches on the item's name OR its
// part/item code, since a technician often has the code off a box or invoice
// but not the exact product name.
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../config/firebase";
import type { InventoryItem } from "../types/auth";

// Firestore's standard prefix-range trick: this sorts after any normal
// Unicode character, so `field >= term && field <= term + PREFIX_END`
// matches every value starting with `term`.
const PREFIX_END = "";

/**
 * Prefix-searches inventory by name and by partNumber and merges the results
 * (deduped by id). Firestore range queries only match a prefix on one field,
 * so this runs two queries rather than trying to OR across both server-side.
 */
export async function searchInventoryItems(centerId: string, term: string): Promise<InventoryItem[]> {
  const trimmed = term.trim();
  if (!trimmed) return [];
  const inventoryRef = collection(db, "servicecenters", centerId, "inventory");
  const [byName, byCode] = await Promise.all([
    getDocs(query(inventoryRef, where("name", ">=", trimmed), where("name", "<=", trimmed + PREFIX_END))),
    getDocs(query(inventoryRef, where("partNumber", ">=", trimmed), where("partNumber", "<=", trimmed + PREFIX_END))),
  ]);
  const byId = new Map<string, InventoryItem>();
  for (const d of [...byName.docs, ...byCode.docs]) {
    byId.set(d.id, { id: d.id, ...d.data() } as InventoryItem);
  }
  return Array.from(byId.values());
}
