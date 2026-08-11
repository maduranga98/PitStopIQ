import * as XLSX from "xlsx";

// Reading a supplier's initial stock list in from a spreadsheet. A center
// gets these as a CSV export or an Excel sheet with whatever headers the
// supplier happened to use, so parsing is deliberately dumb (just rows of
// cells) and column matching is a best-effort guess the user can correct.

export interface ParsedSheet {
  headers: string[];
  /** Every non-empty row after the header, as raw cell strings. */
  rows: string[][];
}

/** Reads a .csv, .xls or .xlsx file into a header row plus data rows. */
export async function parseSpreadsheet(file: File): Promise<ParsedSheet> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" });

  const toCell = (v: unknown): string => (v == null ? "" : String(v).trim());
  const all = raw.map(row => row.map(toCell)).filter(row => row.some(c => c !== ""));
  if (all.length === 0) return { headers: [], rows: [] };

  const [headerRow, ...dataRows] = all;
  return { headers: headerRow, rows: dataRows };
}

export type ImportField = "itemName" | "partNumber" | "brand" | "price" | "quantity" | "vehicleType";

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  itemName: "Item Name",
  partNumber: "Part / Serial No.",
  brand: "Brand",
  price: "Price",
  quantity: "Quantity",
  vehicleType: "Vehicle Type",
};

/** Which fields must be mapped before rows can be previewed. */
export const REQUIRED_IMPORT_FIELDS: ImportField[] = ["itemName", "price", "quantity"];

const FIELD_HINTS: Record<ImportField, string[]> = {
  itemName: ["item", "name", "part name", "description", "product"],
  partNumber: ["number", "part no", "part number", "serial", "code", "sku"],
  brand: ["brand", "make"],
  price: ["price", "cost", "rate", "unit price"],
  quantity: ["qty", "quantity", "available", "stock", "total"],
  vehicleType: ["vehicle", "vehicle type", "fits", "application"],
};

/** Best-effort header → field guess, so the mapping step starts pre-filled. */
export function guessColumnMap(headers: string[]): Partial<Record<ImportField, number>> {
  const map: Partial<Record<ImportField, number>> = {};
  const used = new Set<number>();
  (Object.keys(FIELD_HINTS) as ImportField[]).forEach(field => {
    const hints = FIELD_HINTS[field];
    let best = -1;
    headers.forEach((h, idx) => {
      if (used.has(idx)) return;
      const lower = h.toLowerCase();
      if (hints.some(hint => lower.includes(hint)) && best === -1) best = idx;
    });
    if (best !== -1) {
      map[field] = best;
      used.add(best);
    }
  });
  return map;
}

/** Parses a locale-ish number cell like "13,340" or "1,240.50" into a float. */
export function parseNumberCell(raw: string): number | undefined {
  const cleaned = raw.replace(/[^\d.-]/g, "");
  if (!cleaned) return undefined;
  const n = parseFloat(cleaned);
  return isNaN(n) ? undefined : n;
}
