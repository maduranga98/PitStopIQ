import type { InventoryItem } from "../types/auth";

// One item carries five figures: what it cost to buy, and the four ways it can
// leave the building. Which one applies is decided by who is looking:
//
//   purchase       — the workshop's own cost. Never shown outside the office.
//   serviceCenter  — billed when a technician uses the part on a job.
//   distributor    — what a distributor pays through their portal.
//   outlet         — what the center's own retail counter sells at.
//   marked         — the MRP printed on the item; the distributor's ceiling.
//
// Items created before the price book existed only have `unitCost`, so every
// read goes through here rather than touching the fields directly.

export type PriceAudience =
  | "purchase"
  | "serviceCenter"
  | "distributor"
  | "outlet"
  | "marked";

type PricedItem = Partial<
  Pick<
    InventoryItem,
    | "purchasePrice"
    | "unitCost"
    | "distributorPrice"
    | "outletPrice"
    | "serviceCenterPrice"
    | "markedPrice"
  >
>;

/** What the center paid per unit. */
export function purchasePriceOf(item: PricedItem): number {
  return item.purchasePrice ?? item.unitCost ?? 0;
}

/**
 * What a job card bills per unit. Falls back to the marked price, then to cost
 * — a part is never given away for free just because the price book is thin.
 */
export function serviceCenterPriceOf(item: PricedItem): number {
  return item.serviceCenterPrice ?? item.markedPrice ?? purchasePriceOf(item);
}

/** What a distributor pays per unit. */
export function distributorPriceOf(item: PricedItem): number {
  return item.distributorPrice ?? purchasePriceOf(item);
}

/** What the center's own outlet sells at per unit. */
export function outletPriceOf(item: PricedItem): number {
  return item.outletPrice ?? item.markedPrice ?? purchasePriceOf(item);
}

/** The MRP. Zero means "not recorded" — callers show a dash, not LKR 0.00. */
export function markedPriceOf(item: PricedItem): number {
  return item.markedPrice ?? 0;
}

export function priceFor(item: PricedItem, audience: PriceAudience): number {
  switch (audience) {
    case "purchase":      return purchasePriceOf(item);
    case "serviceCenter": return serviceCenterPriceOf(item);
    case "distributor":   return distributorPriceOf(item);
    case "outlet":        return outletPriceOf(item);
    case "marked":        return markedPriceOf(item);
  }
}

/**
 * The price book as the item form renders it, so the field list, the labels and
 * the help text stay in one place instead of being retyped per screen.
 */
export const PRICE_FIELDS: {
  audience: PriceAudience;
  field: keyof Pick<
    InventoryItem,
    "purchasePrice" | "distributorPrice" | "outletPrice" | "serviceCenterPrice" | "markedPrice"
  >;
  label: string;
  hint: string;
}[] = [
  {
    audience: "purchase",
    field: "purchasePrice",
    label: "Purchase Price",
    hint: "What you pay the supplier. Used for cost and margin reporting — never shown to a distributor.",
  },
  {
    audience: "distributor",
    field: "distributorPrice",
    label: "Distributor Price",
    hint: "What a distributor pays through their portal.",
  },
  {
    audience: "outlet",
    field: "outletPrice",
    label: "Outlet Price",
    hint: "What your own retail outlet sells this at over the counter.",
  },
  {
    audience: "serviceCenter",
    field: "serviceCenterPrice",
    label: "Service Center Price",
    hint: "Billed on the job card when a technician uses this part.",
  },
  {
    audience: "marked",
    field: "markedPrice",
    label: "Marked Price (MRP)",
    hint: "The price printed on the item. Shown to distributors alongside their own price.",
  },
];

export function formatLKR(amount: number): string {
  return `LKR ${amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Money for display where a missing figure should read as a dash, not zero. */
export function formatPrice(amount: number): string {
  return amount > 0 ? formatLKR(amount) : "—";
}

/** Margin between what a part cost and what it's being sold for, as a %. */
export function marginPercent(cost: number, price: number): number | null {
  if (cost <= 0 || price <= 0) return null;
  return Math.round(((price - cost) / cost) * 100);
}
