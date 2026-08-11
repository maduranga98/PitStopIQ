import {
  arrayUnion, collection, doc, getDocs, limit, orderBy, query, updateDoc, where, Timestamp,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { safeSetDoc, safeUpdateDoc } from "./firestoreWrite";
import { logMovement } from "./inventoryMovements";
import type { InventoryItem, Supplier, SupplyLine, VehicleType } from "../types/auth";

// Buying stock in is one action with two results: the shelf goes up, and the
// price book for what arrived is (re)set. Both happen here so a delivery can
// never restock an item while leaving its prices stale.

/** LK mobile: 07XXXXXXXX or +94XXXXXXXXX. */
export function validateLKMobile(phone: string): boolean {
  return /^(\+94|0)\d{9}$/.test(phone.replace(/\s/g, ""));
}

export function round2(n: number): number {
  return parseFloat(n.toFixed(2));
}

/**
 * Next goods-received number for a center, e.g. GRN-2607-0004. Mirrors the
 * purchase-order numbering: read the highest number under this month's prefix
 * and add one.
 */
export async function nextSupplyNumber(centerId: string): Promise<string> {
  const now = new Date();
  const prefix = `GRN-${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}-`;
  let seq = 1;
  try {
    const snap = await getDocs(query(
      collection(db, "servicecenters", centerId, "supplierSupplies"),
      where("supplyNumber", ">=", prefix),
      where("supplyNumber", "<=", prefix + "￿"),
      orderBy("supplyNumber", "desc"),
      limit(1),
    ));
    if (!snap.empty) {
      const last = snap.docs[0].data().supplyNumber as string;
      const parsed = parseInt(last.slice(prefix.length), 10);
      if (!isNaN(parsed)) seq = parsed + 1;
    }
  } catch {
    // Index missing or offline — a timestamp suffix beats risking a duplicate.
    return `${prefix}${String(now.getTime()).slice(-5)}`;
  }
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

export function supplyTotal(lines: { lineTotal: number }[]): number {
  return round2(lines.reduce((sum, l) => sum + l.lineTotal, 0));
}

/** The five prices a delivery can set. Any left blank keep their old value. */
export interface PriceBookInput {
  purchasePrice: number;
  distributorPrice?: number;
  outletPrice?: number;
  serviceCenterPrice?: number;
  markedPrice?: number;
}

/** A line as the supply form holds it, before anything is written. */
export interface SupplyDraftLine extends PriceBookInput {
  /** Empty for a brand-new item; the existing item's id otherwise. */
  itemId: string;
  itemName: string;
  unit: string;
  quantity: number;
  /** New items only — an existing item keeps the category/threshold it has. */
  category?: string;
  threshold?: number;
  availableToDistributors?: boolean;
  /** Manufacturer part / serial number, set or refreshed on the item itself. */
  partNumber?: string;
  /** Overrides the supplier's default brand for just this line/item. */
  brand?: string;
  /** Which vehicles this part fits, recorded on the supply line, not the item. */
  vehicleType?: VehicleType;
}

export interface SupplyActor {
  centerId: string;
  uid: string;
  userName: string;
}

/** Only the prices the user actually filled in, so blanks never wipe a figure. */
function priceUpdates(line: PriceBookInput): Record<string, number> {
  const out: Record<string, number> = {
    purchasePrice: round2(line.purchasePrice),
    // Legacy readers (CSV export, older job cards) still look at unitCost.
    unitCost: round2(line.purchasePrice),
  };
  if (line.distributorPrice != null)   out.distributorPrice = round2(line.distributorPrice);
  if (line.outletPrice != null)        out.outletPrice = round2(line.outletPrice);
  if (line.serviceCenterPrice != null) out.serviceCenterPrice = round2(line.serviceCenterPrice);
  if (line.markedPrice != null)        out.markedPrice = round2(line.markedPrice);
  return out;
}

/**
 * Book a delivery in: restock (or create) every item on it, refresh their
 * prices, and file the goods-received record. Returns the GRN number.
 *
 * Writes are per-item rather than batched so that a delivery of thirty lines
 * doesn't fail as a whole when one item has been deleted mid-entry — the same
 * trade-off releaseOrder makes on the way out.
 */
export async function recordSupply({
  supplier, lines, existingItems, invoiceRef, note, actor,
}: {
  supplier: Supplier;
  lines: SupplyDraftLine[];
  /** Live copies of the items being restocked, keyed by id. */
  existingItems: Map<string, InventoryItem>;
  invoiceRef?: string;
  note?: string;
  actor: SupplyActor;
}): Promise<{ supplyNumber: string; total: number }> {
  const now = Timestamp.now();
  const supplyNumber = await nextSupplyNumber(actor.centerId);

  const saved: SupplyLine[] = [];

  for (const line of lines) {
    const qty = round2(line.quantity);
    const prices = priceUpdates(line);
    const partNumber = line.partNumber?.trim();
    // A supplier can carry more than one brand, so a line's own brand (e.g.
    // read off an imported price list) wins over the supplier's default one.
    const lineBrand = line.brand?.trim() || supplier.brand || "";
    const supplierFields = {
      supplierId: supplier.id,
      supplierName: supplier.name,
      supplierCompany: supplier.companyName,
      supplierBrand: lineBrand || null,
      supplierPhone: supplier.mobile,
    };
    const restockEntry = {
      addedQty: qty,
      addedBy: actor.userName,
      timestamp: now,
      note: `${supplyNumber} · ${supplier.companyName}${invoiceRef ? ` · ${invoiceRef}` : ""}`,
    };

    let itemId = line.itemId;
    const existing = itemId ? existingItems.get(itemId) : undefined;

    if (existing) {
      const qtyAfter = round2(existing.currentQty + qty);
      await safeUpdateDoc(doc(db, "servicecenters", actor.centerId, "inventory", itemId), {
        ...prices,
        ...supplierFields,
        ...(partNumber ? { partNumber } : {}),
        currentQty: qtyAfter,
        restockLog: arrayUnion(restockEntry),
        updatedAt: now,
      });
      logMovement({
        centerId: actor.centerId,
        itemId,
        itemName: line.itemName,
        unit: line.unit,
        type: "restock",
        qtyChange: qty,
        qtyBefore: existing.currentQty,
        qtyAfter,
        refId: supplyNumber,
        refLabel: `${supplyNumber} · ${supplier.companyName}`,
        performedBy: actor.uid,
        performedByName: actor.userName,
      }).catch(() => {});
    } else {
      const ref = doc(collection(db, "servicecenters", actor.centerId, "inventory"));
      itemId = ref.id;
      await safeSetDoc(ref, {
        name: line.itemName,
        category: line.category || "Other",
        unit: line.unit,
        currentQty: qty,
        threshold: line.threshold ?? 0,
        ...prices,
        ...supplierFields,
        ...(partNumber ? { partNumber } : {}),
        availableToDistributors: line.availableToDistributors !== false,
        isArchived: false,
        restockLog: [restockEntry],
        deductionLog: [],
        centerId: actor.centerId,
        createdAt: now,
        updatedAt: now,
      });
      logMovement({
        centerId: actor.centerId,
        itemId,
        itemName: line.itemName,
        unit: line.unit,
        type: "restock",
        qtyChange: qty,
        qtyBefore: 0,
        qtyAfter: qty,
        refId: supplyNumber,
        refLabel: `${supplyNumber} · ${supplier.companyName} · new item`,
        performedBy: actor.uid,
        performedByName: actor.userName,
      }).catch(() => {});
    }

    saved.push({
      itemId,
      itemName: line.itemName,
      unit: line.unit,
      quantity: qty,
      purchasePrice: round2(line.purchasePrice),
      lineTotal: round2(qty * line.purchasePrice),
      ...(line.distributorPrice != null ? { distributorPrice: round2(line.distributorPrice) } : {}),
      ...(line.outletPrice != null ? { outletPrice: round2(line.outletPrice) } : {}),
      ...(line.serviceCenterPrice != null ? { serviceCenterPrice: round2(line.serviceCenterPrice) } : {}),
      ...(line.markedPrice != null ? { markedPrice: round2(line.markedPrice) } : {}),
      ...(partNumber ? { partNumber } : {}),
      ...(lineBrand && lineBrand !== supplier.brand ? { brand: lineBrand } : {}),
      ...(line.vehicleType ? { vehicleType: line.vehicleType } : {}),
      isNewItem: !existing,
    });
  }

  const total = supplyTotal(saved);
  await safeSetDoc(doc(collection(db, "servicecenters", actor.centerId, "supplierSupplies")), {
    supplyNumber,
    supplierId: supplier.id,
    supplierName: supplier.name,
    supplierCompany: supplier.companyName,
    supplierBrand: supplier.brand || null,
    items: saved,
    total,
    invoiceRef: invoiceRef?.trim() || null,
    note: note?.trim() || null,
    centerId: actor.centerId,
    createdAt: now,
    createdBy: actor.uid,
    createdByName: actor.userName,
  });

  // Best-effort: keeps the "last supply" column on the supplier list honest.
  updateDoc(doc(db, "servicecenters", actor.centerId, "suppliers", supplier.id), {
    lastSupplyAt: now,
  }).catch(() => {});

  return { supplyNumber, total };
}
