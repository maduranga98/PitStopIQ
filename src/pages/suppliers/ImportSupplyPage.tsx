import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { collection, doc, getDoc, onSnapshot } from "firebase/firestore";
import {
  Upload, FileSpreadsheet, AlertTriangle, Check, Trash2, Building2, ArrowLeft, ArrowRight,
} from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import { LoadingBlock } from "../../components/LoadingProgress";
import type { InventoryItem, Supplier, VehicleType } from "../../types/auth";
import { buildCategoryList, buildUnitList } from "../../lib/inventoryOptions";
import { DEFAULT_VEHICLE_TYPES } from "../../lib/vehicleOptions";
import { formatLKR } from "../../lib/inventoryPricing";
import { recordSupply, round2, type SupplyDraftLine } from "../../lib/suppliers";
import {
  guessColumnMap, parseNumberCell, parseSpreadsheet,
  IMPORT_FIELD_LABELS, REQUIRED_IMPORT_FIELDS, IMPORT_TEMPLATE_HEADERS,
  type ImportField, type ParsedSheet,
} from "../../lib/importSupply";
import { downloadCSV } from "../../lib/csvExport";

// Setting up a supplier's stock from the price list they already hand over —
// a CSV export or a photographed sheet turned into Excel. Three steps: pick
// the file and tell us which column is which, review what got read (fixing
// anything the guesswork got wrong and choosing which vehicles each part
// fits), then book it in exactly like a normal delivery.

const inputClass =
  "w-full bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-3 py-2 text-white placeholder-gray-600 text-sm transition";
const selectClass = `${inputClass} appearance-none`;

// "any" isn't a real vehicle type — it means the part fits everything, saved
// as no vehicleType at all (same convention the service price catalog uses).
const VEHICLE_TYPE_CHOICES = ["any", ...DEFAULT_VEHICLE_TYPES];

let rowSeq = 0;

interface DraftRow {
  key: string;
  include: boolean;
  itemName: string;
  partNumber: string;
  brand: string;
  price: string;
  distributorPrice: string;
  outletPrice: string;
  servicePrice: string;
  mrp: string;
  quantity: string;
  vehicleType: string; // "any" or one of DEFAULT_VEHICLE_TYPES
  category: string;
  unit: string;
}

function downloadImportTemplate() {
  downloadCSV(
    "supplier-stock-list-template.csv",
    IMPORT_TEMPLATE_HEADERS.map(h => h.header),
    [["Brake Pad Set", "BP-1234", "Bosch", "10", "1200", "1400", "1600", "1800", "2000", "any"]],
  );
}

type Step = "upload" | "map" | "preview" | "done";

export default function ImportSupplyPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const centerId = currentUser?.centerId ?? "";
  const canRecord = usePermission("suppliers.recordSupply");

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [customUnits, setCustomUnits] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [supplierId, setSupplierId] = useState(searchParams.get("supplierId") ?? "");
  const [invoiceRef, setInvoiceRef] = useState("");

  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [colMap, setColMap] = useState<Partial<Record<ImportField, number>>>({});
  const [parseError, setParseError] = useState("");

  const [rows, setRows] = useState<DraftRow[]>([]);
  const [bulkVehicleType, setBulkVehicleType] = useState("any");
  const [bulkBrand, setBulkBrand] = useState("");
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkUnit, setBulkUnit] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ supplyNumber: string; total: number; lines: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!centerId || !canRecord) return;
    return onSnapshot(collection(db, "servicecenters", centerId, "suppliers"), snap => {
      setSuppliers(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() } as Supplier))
          .filter(s => s.isActive !== false)
          .sort((a, b) => a.companyName.localeCompare(b.companyName)),
      );
      setLoading(false);
    }, () => setLoading(false));
  }, [centerId, canRecord]);

  useEffect(() => {
    if (!centerId || !canRecord) return;
    return onSnapshot(collection(db, "servicecenters", centerId, "inventory"), snap => {
      setItems(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() } as InventoryItem))
          .filter(i => !i.isArchived),
      );
    }, () => setItems([]));
  }, [centerId, canRecord]);

  useEffect(() => {
    if (!centerId) return;
    getDoc(doc(db, "servicecenters", centerId)).then(snap => {
      const data = snap.data() as {
        customInventoryCategories?: string[];
        customInventoryUnits?: string[];
      } | undefined;
      setCustomCategories(data?.customInventoryCategories ?? []);
      setCustomUnits(data?.customInventoryUnits ?? []);
    }).catch(() => { /* the built-in lists are enough */ });
  }, [centerId]);

  const categories = useMemo(
    () => buildCategoryList(customCategories, items.map(i => i.category)),
    [customCategories, items],
  );
  const units = useMemo(
    () => buildUnitList(customUnits, items.map(i => i.unit)),
    [customUnits, items],
  );

  const supplier = suppliers.find(s => s.id === supplierId);

  const itemsByName = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    items.forEach(i => map.set(i.name.trim().toLowerCase(), i));
    return map;
  }, [items]);
  const itemsByPartNumber = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    items.forEach(i => { if (i.partNumber) map.set(i.partNumber.trim().toLowerCase(), i); });
    return map;
  }, [items]);

  // The same item name can cover several distinct parts (e.g. many rows named
  // "Oil Filter", each its own serial number), so a part number — when the
  // row has one — is the real identity. Only fall back to matching by name
  // when the row carries no part number to go on.
  function matchExisting(row: DraftRow): InventoryItem | undefined {
    const pn = row.partNumber.trim().toLowerCase();
    if (pn) return itemsByPartNumber.get(pn);
    return itemsByName.get(row.itemName.trim().toLowerCase());
  }

  // ── Step 1: upload ──────────────────────────────────────────────────────────

  async function handleFile(file: File) {
    setParseError("");
    setFileName(file.name);
    try {
      const parsed = await parseSpreadsheet(file);
      if (parsed.headers.length === 0) {
        setParseError("Couldn't find any rows in that file. Check it has a header row followed by data.");
        return;
      }
      setSheet(parsed);
      setColMap(guessColumnMap(parsed.headers));
      setStep("map");
    } catch {
      setParseError("Couldn't read that file. Export it as .csv or .xlsx and try again.");
    }
  }

  // ── Step 2 → 3: apply the column map, build preview rows ───────────────────

  function buildRows() {
    if (!sheet) return;
    const defaultCategory = categories[0] ?? "Other";
    const defaultUnit = units[0] ?? "Pieces";
    const built: DraftRow[] = sheet.rows.map(cells => {
      rowSeq += 1;
      const get = (field: ImportField) => {
        const idx = colMap[field];
        return idx != null ? (cells[idx] ?? "") : "";
      };
      const priceNum = parseNumberCell(get("price"));
      const qtyNum = parseNumberCell(get("quantity"));
      const distributorPriceNum = parseNumberCell(get("distributorPrice"));
      const outletPriceNum = parseNumberCell(get("outletPrice"));
      const servicePriceNum = parseNumberCell(get("servicePrice"));
      const mrpNum = parseNumberCell(get("mrp"));
      const rawVehicle = get("vehicleType").trim().toLowerCase();
      const vehicleType = DEFAULT_VEHICLE_TYPES.includes(rawVehicle) ? rawVehicle : "any";
      return {
        key: `row-${rowSeq}`,
        include: true,
        itemName: get("itemName").trim(),
        partNumber: get("partNumber").trim(),
        brand: get("brand").trim(),
        price: priceNum != null ? String(priceNum) : "",
        distributorPrice: distributorPriceNum != null ? String(distributorPriceNum) : "",
        outletPrice: outletPriceNum != null ? String(outletPriceNum) : "",
        servicePrice: servicePriceNum != null ? String(servicePriceNum) : "",
        mrp: mrpNum != null ? String(mrpNum) : "",
        quantity: qtyNum != null ? String(qtyNum) : "",
        vehicleType,
        category: defaultCategory,
        unit: defaultUnit,
      };
    }).filter(r => r.itemName);
    setRows(built);
    setStep("preview");
  }

  function setRow(key: string, patch: Partial<DraftRow>) {
    setRows(prev => prev.map(r => (r.key === key ? { ...r, ...patch } : r)));
    setError("");
  }

  function applyBulkVehicleType() {
    setRows(prev => prev.map(r => (r.include ? { ...r, vehicleType: bulkVehicleType } : r)));
  }
  function applyBulkBrand() {
    if (!bulkBrand.trim()) return;
    setRows(prev => prev.map(r => (r.include ? { ...r, brand: bulkBrand.trim() } : r)));
  }
  function applyBulkCategory() {
    if (!bulkCategory) return;
    setRows(prev => prev.map(r => (r.include ? { ...r, category: bulkCategory } : r)));
  }
  function applyBulkUnit() {
    if (!bulkUnit) return;
    setRows(prev => prev.map(r => (r.include ? { ...r, unit: bulkUnit } : r)));
  }

  const includedRows = rows.filter(r => r.include);
  const lineTotals = includedRows.map(r => round2((parseFloat(r.price) || 0) * (parseFloat(r.quantity) || 0)));
  const total = round2(lineTotals.reduce((s, n) => s + n, 0));

  function validateRows(): string | null {
    if (!supplier) return "Pick the supplier this stock list came from.";
    if (includedRows.length === 0) return "Include at least one row to import.";
    const seen = new Set<string>();
    for (const row of includedRows) {
      const label = row.itemName || "(unnamed row)";
      const price = parseFloat(row.price);
      if (isNaN(price) || price < 0) return `Enter a valid price for ${label}.`;
      const qty = parseFloat(row.quantity);
      if (isNaN(qty) || qty <= 0) return `Enter a positive quantity for ${label}.`;
      const existing = matchExisting(row);
      // New rows are only the same item if both name AND part number match —
      // same-named rows with different part numbers (e.g. several distinct
      // "Oil Filter" parts) are different items, not duplicates.
      const dedupeKey = existing
        ? existing.id
        : `new:${label.toLowerCase()}|${row.partNumber.trim().toLowerCase()}`;
      if (seen.has(dedupeKey)) return `${label} appears more than once — combine it into one row.`;
      seen.add(dedupeKey);
    }
    return null;
  }

  async function handleImport() {
    const problem = validateRows();
    if (problem) { setError(problem); return; }
    if (!supplier) return;

    setSaving(true);
    setError("");
    try {
      const draft: SupplyDraftLine[] = includedRows.map(row => {
        const existing = matchExisting(row);
        return {
          itemId: existing?.id ?? "",
          itemName: row.itemName,
          unit: row.unit,
          quantity: parseFloat(row.quantity),
          purchasePrice: parseFloat(row.price),
          distributorPrice: row.distributorPrice ? parseFloat(row.distributorPrice) : undefined,
          outletPrice: row.outletPrice ? parseFloat(row.outletPrice) : undefined,
          serviceCenterPrice: row.servicePrice ? parseFloat(row.servicePrice) : undefined,
          markedPrice: row.mrp ? parseFloat(row.mrp) : undefined,
          category: row.category,
          threshold: 0,
          availableToDistributors: true,
          partNumber: row.partNumber || undefined,
          brand: row.brand || undefined,
          vehicleType: row.vehicleType === "any" ? undefined : (row.vehicleType as VehicleType),
        };
      });

      const result = await recordSupply({
        supplier,
        lines: draft,
        existingItems: new Map(items.map(i => [i.id, i])),
        invoiceRef,
        note: `Imported from ${fileName}`,
        actor: {
          centerId,
          uid: currentUser?.uid ?? "",
          userName: currentUser?.displayName ?? currentUser?.email ?? "Staff",
        },
      });
      setDone({ ...result, lines: draft.length });
    } catch {
      setError("Could not import the stock list. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setStep("upload");
    setFileName("");
    setSheet(null);
    setColMap({});
    setRows([]);
    setParseError("");
    setError("");
    setDone(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  if (!canRecord) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <FileSpreadsheet className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-gray-400">You don't have permission to record supplies.</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-[#0B1120] text-white">
        <PageHeader icon={<FileSpreadsheet className="w-5 h-5" />} title="Import Stock List" />
        <div className="max-w-xl mx-auto px-4 sm:px-6 py-16 text-center">
          <div className="w-14 h-14 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center mx-auto mb-4">
            <Check className="h-7 w-7 text-green-400" />
          </div>
          <h2 className="text-lg font-bold text-white">Supply {done.supplyNumber} recorded</h2>
          <p className="text-sm text-gray-400 mt-2">
            {done.lines === 1 ? "1 item" : `${done.lines} items`} imported at {formatLKR(done.total)}. Stock levels
            are updated.
          </p>
          <div className="flex gap-3 mt-8">
            <button
              onClick={reset}
              className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 px-4 rounded-xl transition text-sm"
            >
              Import Another File
            </button>
            <button
              onClick={() => navigate("/inventory")}
              className="flex-1 bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold py-2.5 px-4 rounded-xl transition text-sm"
            >
              View Inventory
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <PageHeader icon={<FileSpreadsheet className="w-5 h-5" />} title="Import Stock List" />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-5">
        {loading ? (
          <LoadingBlock className="py-20" />
        ) : suppliers.length === 0 ? (
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-16 flex flex-col items-center gap-3 text-center">
            <Building2 className="h-12 w-12 text-gray-700" />
            <p className="text-gray-400 font-medium">No active suppliers yet</p>
            <p className="text-sm text-gray-500 max-w-sm">
              Add the supplier first — an import is booked in against whoever's price list it is.
            </p>
            <button
              onClick={() => navigate("/suppliers")}
              className="mt-2 flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold px-4 py-2 rounded-xl transition text-sm"
            >
              Add a Supplier
            </button>
          </div>
        ) : (
          <>
            {/* Supplier — needed at every step */}
            <div className="bg-[#162032] border border-white/10 rounded-2xl p-5 space-y-4">
              <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Supplier</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">
                    Stock list from <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={supplierId}
                    onChange={e => { setSupplierId(e.target.value); setError(""); }}
                    className={selectClass}
                  >
                    <option value="">Select supplier…</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.companyName} — {s.brand} ({s.name})
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1.5">
                    A single supplier can still carry more than one brand — set the brand per row below if this
                    list mixes brands.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">
                    Supplier Invoice / Bill No <span className="text-gray-600 font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={invoiceRef}
                    onChange={e => setInvoiceRef(e.target.value)}
                    placeholder="e.g. INV-2341"
                    maxLength={60}
                    className={inputClass}
                  />
                </div>
              </div>
            </div>

            {step === "upload" && (
              <div className="bg-[#162032] border border-dashed border-white/15 rounded-2xl p-10 flex flex-col items-center text-center gap-3">
                <Upload className="h-10 w-10 text-gray-600" />
                <p className="text-white font-medium">Upload the supplier's stock list</p>
                <p className="text-sm text-gray-500 max-w-md">
                  A .csv, .xls or .xlsx file with one row per item — name, part/serial number, prices and quantity.
                  You'll get to check the columns and pick a vehicle type per item before anything is saved.
                </p>
                <button
                  type="button"
                  onClick={downloadImportTemplate}
                  className="text-xs text-gray-400 hover:text-[#F97316] underline underline-offset-2 transition"
                >
                  Download a blank CSV template
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xls,.xlsx"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                  className="hidden"
                  id="import-file-input"
                />
                <label
                  htmlFor="import-file-input"
                  className="mt-2 cursor-pointer flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold px-4 py-2.5 rounded-xl transition text-sm"
                >
                  <Upload className="h-4 w-4" /> Choose File
                </label>
                {parseError && (
                  <p className="text-sm text-red-400 flex items-center gap-1.5 mt-2">
                    <AlertTriangle className="h-4 w-4" /> {parseError}
                  </p>
                )}
              </div>
            )}

            {step === "map" && sheet && (
              <div className="bg-[#162032] border border-white/10 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
                    Match Columns — {fileName}
                  </h2>
                  <span className="text-xs text-gray-500">{sheet.rows.length} rows found</span>
                </div>
                <p className="text-xs text-gray-500">
                  We've guessed which column is which — check them, especially Item Name, Price and Quantity.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {(Object.keys(IMPORT_FIELD_LABELS) as ImportField[]).map(field => (
                    <div key={field}>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">
                        {IMPORT_FIELD_LABELS[field]}
                        {REQUIRED_IMPORT_FIELDS.includes(field) && <span className="text-red-400 ml-1">*</span>}
                      </label>
                      <select
                        value={colMap[field] ?? ""}
                        onChange={e => setColMap(prev => ({
                          ...prev,
                          [field]: e.target.value === "" ? undefined : Number(e.target.value),
                        }))}
                        className={selectClass}
                      >
                        <option value="">Not in this file</option>
                        {sheet.headers.map((h, idx) => (
                          <option key={idx} value={idx}>{h || `Column ${idx + 1}`}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={reset}
                    className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 px-4 rounded-xl transition text-sm"
                  >
                    <ArrowLeft className="h-4 w-4" /> Choose a different file
                  </button>
                  <button
                    type="button"
                    disabled={REQUIRED_IMPORT_FIELDS.some(f => colMap[f] == null)}
                    onClick={buildRows}
                    className="flex-1 flex items-center justify-center gap-1.5 bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-50 text-white font-semibold py-2.5 px-4 rounded-xl transition text-sm"
                  >
                    Preview Rows <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {step === "preview" && (
              <>
                <div className="bg-[#162032] border border-white/10 rounded-2xl p-5 space-y-3">
                  <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
                    Apply to All Selected Rows
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="flex gap-2">
                      <select
                        value={bulkVehicleType}
                        onChange={e => setBulkVehicleType(e.target.value)}
                        className={selectClass}
                      >
                        {VEHICLE_TYPE_CHOICES.map(v => (
                          <option key={v} value={v}>{v === "any" ? "Any vehicle" : v}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={applyBulkVehicleType}
                        className="flex-shrink-0 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-medium px-3 rounded-lg transition"
                      >
                        Set vehicle
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={bulkBrand}
                        onChange={e => setBulkBrand(e.target.value)}
                        placeholder="Brand for all rows…"
                        className={inputClass}
                      />
                      <button
                        type="button"
                        onClick={applyBulkBrand}
                        className="flex-shrink-0 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-medium px-3 rounded-lg transition"
                      >
                        Set brand
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <select
                        value={bulkCategory}
                        onChange={e => setBulkCategory(e.target.value)}
                        className={selectClass}
                      >
                        <option value="">Category…</option>
                        {categories.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <button
                        type="button"
                        onClick={applyBulkCategory}
                        className="flex-shrink-0 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-medium px-3 rounded-lg transition"
                      >
                        Set category
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <select
                        value={bulkUnit}
                        onChange={e => setBulkUnit(e.target.value)}
                        className={selectClass}
                      >
                        <option value="">Unit…</option>
                        {units.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                      <button
                        type="button"
                        onClick={applyBulkUnit}
                        className="flex-shrink-0 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-medium px-3 rounded-lg transition"
                      >
                        Set unit
                      </button>
                    </div>
                  </div>
                </div>

                <div className="bg-[#162032] border border-white/10 rounded-2xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/10 text-left text-xs text-gray-400 uppercase tracking-wider">
                          <th className="px-3 py-2 w-8"></th>
                          <th className="px-3 py-2 min-w-[160px]">Item</th>
                          <th className="px-3 py-2 min-w-[110px]">Part No.</th>
                          <th className="px-3 py-2 min-w-[110px]">Brand</th>
                          <th className="px-3 py-2 min-w-[100px]">Purchase Price</th>
                          <th className="px-3 py-2 min-w-[100px]">Distributor Price</th>
                          <th className="px-3 py-2 min-w-[100px]">Outlet Price</th>
                          <th className="px-3 py-2 min-w-[100px]">Service Price</th>
                          <th className="px-3 py-2 min-w-[100px]">MRP</th>
                          <th className="px-3 py-2 min-w-[80px]">Qty</th>
                          <th className="px-3 py-2 min-w-[120px]">Vehicle</th>
                          <th className="px-3 py-2 min-w-[130px]">Category</th>
                          <th className="px-3 py-2 min-w-[100px]">Unit</th>
                          <th className="px-3 py-2 min-w-[90px]">Status</th>
                          <th className="px-3 py-2 w-8"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(row => {
                          const existing = matchExisting(row);
                          return (
                            <tr
                              key={row.key}
                              className={`border-b border-white/5 ${row.include ? "" : "opacity-40"}`}
                            >
                              <td className="px-3 py-1.5">
                                <input
                                  type="checkbox"
                                  checked={row.include}
                                  onChange={e => setRow(row.key, { include: e.target.checked })}
                                  className="h-4 w-4 rounded border-white/20 bg-[#0B1120] accent-[#F97316]"
                                />
                              </td>
                              <td className="px-3 py-1.5">
                                <input
                                  type="text"
                                  value={row.itemName}
                                  onChange={e => setRow(row.key, { itemName: e.target.value })}
                                  className={`${inputClass} py-1.5`}
                                />
                              </td>
                              <td className="px-3 py-1.5">
                                <input
                                  type="text"
                                  value={row.partNumber}
                                  onChange={e => setRow(row.key, { partNumber: e.target.value })}
                                  className={`${inputClass} py-1.5`}
                                />
                              </td>
                              <td className="px-3 py-1.5">
                                <input
                                  type="text"
                                  value={row.brand}
                                  onChange={e => setRow(row.key, { brand: e.target.value })}
                                  placeholder={supplier?.brand}
                                  className={`${inputClass} py-1.5`}
                                />
                              </td>
                              <td className="px-3 py-1.5">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={row.price}
                                  onChange={e => setRow(row.key, { price: e.target.value })}
                                  className={`${inputClass} py-1.5`}
                                />
                              </td>
                              <td className="px-3 py-1.5">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={row.distributorPrice}
                                  onChange={e => setRow(row.key, { distributorPrice: e.target.value })}
                                  className={`${inputClass} py-1.5`}
                                />
                              </td>
                              <td className="px-3 py-1.5">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={row.outletPrice}
                                  onChange={e => setRow(row.key, { outletPrice: e.target.value })}
                                  className={`${inputClass} py-1.5`}
                                />
                              </td>
                              <td className="px-3 py-1.5">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={row.servicePrice}
                                  onChange={e => setRow(row.key, { servicePrice: e.target.value })}
                                  className={`${inputClass} py-1.5`}
                                />
                              </td>
                              <td className="px-3 py-1.5">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={row.mrp}
                                  onChange={e => setRow(row.key, { mrp: e.target.value })}
                                  className={`${inputClass} py-1.5`}
                                />
                              </td>
                              <td className="px-3 py-1.5">
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  value={row.quantity}
                                  onChange={e => setRow(row.key, { quantity: e.target.value })}
                                  className={`${inputClass} py-1.5`}
                                />
                              </td>
                              <td className="px-3 py-1.5">
                                <select
                                  value={row.vehicleType}
                                  onChange={e => setRow(row.key, { vehicleType: e.target.value })}
                                  className={`${selectClass} py-1.5`}
                                >
                                  {VEHICLE_TYPE_CHOICES.map(v => (
                                    <option key={v} value={v}>{v === "any" ? "Any vehicle" : v}</option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-3 py-1.5">
                                <select
                                  value={row.category}
                                  onChange={e => setRow(row.key, { category: e.target.value })}
                                  className={`${selectClass} py-1.5`}
                                >
                                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                              </td>
                              <td className="px-3 py-1.5">
                                <select
                                  value={row.unit}
                                  onChange={e => setRow(row.key, { unit: e.target.value })}
                                  className={`${selectClass} py-1.5`}
                                >
                                  {units.map(u => <option key={u} value={u}>{u}</option>)}
                                </select>
                              </td>
                              <td className="px-3 py-1.5">
                                <span className={`text-[11px] font-medium px-2 py-1 rounded-full border whitespace-nowrap ${
                                  existing
                                    ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
                                    : "bg-[#F97316]/15 text-[#F97316] border-[#F97316]/30"
                                }`}>
                                  {existing ? "Restock" : "New item"}
                                </span>
                              </td>
                              <td className="px-3 py-1.5">
                                <button
                                  type="button"
                                  onClick={() => setRows(prev => prev.filter(r => r.key !== row.key))}
                                  className="p-1 text-gray-600 hover:text-red-400 transition"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="bg-[#162032] border border-white/10 rounded-2xl p-5 flex items-center justify-between">
                  <span className="text-sm text-gray-400">
                    {includedRows.length} of {rows.length} rows selected · total at cost
                  </span>
                  <span className="text-lg font-bold text-white">{formatLKR(total)}</span>
                </div>

                {error && (
                  <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                    <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-400">{error}</p>
                  </div>
                )}

                <div className="flex gap-3 pb-8">
                  <button
                    type="button"
                    onClick={() => setStep("map")}
                    className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-3 px-4 rounded-xl transition text-sm"
                  >
                    <ArrowLeft className="h-4 w-4" /> Back
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleImport}
                    className="flex-1 bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-60 text-white font-semibold py-3 px-4 rounded-xl transition text-sm"
                  >
                    {saving ? "Importing…" : `Import ${includedRows.length} Item${includedRows.length === 1 ? "" : "s"}`}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
