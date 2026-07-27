import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { collection, doc, getDoc, onSnapshot } from "firebase/firestore";
import {
  PackagePlus, Plus, Search, AlertTriangle, Check, Trash2, Package, Building2,
} from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import { LoadingBlock } from "../../components/LoadingProgress";
import type { InventoryItem, Supplier } from "../../types/auth";
import {
  buildCategoryList, buildUnitList,
} from "../../lib/inventoryOptions";
import {
  PRICE_FIELDS, formatLKR, marginPercent, purchasePriceOf,
} from "../../lib/inventoryPricing";
import { recordSupply, round2, type SupplyDraftLine } from "../../lib/suppliers";

// Booking a delivery in. One screen does both halves of the job: the stock goes
// up, and the five prices that item will be sold at are set at the same time —
// which is the only moment the person entering it actually knows them.

const inputClass =
  "w-full bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-3 py-2 text-white placeholder-gray-600 text-sm transition";
const selectClass = `${inputClass} appearance-none`;

// A line as the form holds it: every number is a string until it's submitted,
// so a half-typed "1." doesn't get parsed into something surprising.
interface DraftLine {
  key: string;
  itemId: string;          // "" = a new item
  itemName: string;
  unit: string;
  category: string;
  threshold: string;
  availableToDistributors: boolean;
  quantity: string;
  purchasePrice: string;
  distributorPrice: string;
  outletPrice: string;
  serviceCenterPrice: string;
  markedPrice: string;
}

let lineSeq = 0;
function emptyLine(): DraftLine {
  lineSeq += 1;
  return {
    key: `line-${lineSeq}`,
    itemId: "",
    itemName: "",
    unit: "",
    category: "",
    threshold: "",
    availableToDistributors: true,
    quantity: "",
    purchasePrice: "",
    distributorPrice: "",
    outletPrice: "",
    serviceCenterPrice: "",
    markedPrice: "",
  };
}

function num(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? undefined : parsed;
}

// ── Item picker ───────────────────────────────────────────────────────────────

function ItemPicker({
  items, onPick, onNew,
}: {
  items: InventoryItem[];
  onPick: (item: InventoryItem) => void;
  onNew: (name: string) => void;
}) {
  const [search, setSearch] = useState("");

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items.slice(0, 6);
    return items.filter(i => i.name.toLowerCase().includes(q)).slice(0, 6);
  }, [items, search]);

  const exactMatch = matches.some(i => i.name.toLowerCase() === search.trim().toLowerCase());

  return (
    <div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
        <input
          type="text"
          autoFocus
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search inventory, or type a new item name…"
          className={`${inputClass} pl-9`}
        />
      </div>
      <div className="mt-2 space-y-1 max-h-52 overflow-y-auto">
        {matches.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => onPick(item)}
            className="w-full text-left bg-[#0B1120] hover:bg-white/5 border border-white/5 rounded-lg px-3 py-2 transition"
          >
            <p className="text-sm text-white truncate">{item.name}</p>
            <p className="text-xs text-gray-500">
              {item.category} · {item.currentQty} {item.unit} in stock · bought at {formatLKR(purchasePriceOf(item))}
            </p>
          </button>
        ))}
        {search.trim() && !exactMatch && (
          <button
            type="button"
            onClick={() => onNew(search.trim())}
            className="w-full text-left bg-[#F97316]/10 hover:bg-[#F97316]/20 border border-[#F97316]/20 rounded-lg px-3 py-2 transition"
          >
            <p className="text-sm text-[#F97316] flex items-center gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Add "{search.trim()}" as a new item
            </p>
            <p className="text-xs text-gray-500 mt-0.5">It will be created in inventory when you save.</p>
          </button>
        )}
        {matches.length === 0 && !search.trim() && (
          <p className="text-xs text-gray-500 px-1 py-2">Search for an item, or type a name to create one.</p>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RecordSupplyPage() {
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
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ supplyNumber: string; total: number; lines: number } | null>(null);

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
          .filter(i => !i.isArchived)
          .sort((a, b) => a.name.localeCompare(b.name)),
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
  const itemsById = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);

  function setLine(key: string, patch: Partial<DraftLine>) {
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)));
    setError("");
  }

  // Picking an existing item pre-fills its current price book, so a delivery
  // that doesn't change prices is just a quantity away from being saved.
  function pickExisting(key: string, item: InventoryItem) {
    setLine(key, {
      itemId: item.id,
      itemName: item.name,
      unit: item.unit,
      category: item.category,
      threshold: String(item.threshold ?? ""),
      availableToDistributors: item.availableToDistributors !== false,
      purchasePrice: item.purchasePrice != null || item.unitCost != null ? String(purchasePriceOf(item)) : "",
      distributorPrice: item.distributorPrice != null ? String(item.distributorPrice) : "",
      outletPrice: item.outletPrice != null ? String(item.outletPrice) : "",
      serviceCenterPrice: item.serviceCenterPrice != null ? String(item.serviceCenterPrice) : "",
      markedPrice: item.markedPrice != null ? String(item.markedPrice) : "",
    });
    setPickerFor(null);
  }

  function pickNew(key: string, name: string) {
    setLine(key, { itemId: "", itemName: name, unit: "", category: "", threshold: "0" });
    setPickerFor(null);
  }

  const lineTotals = lines.map(l => {
    const qty = num(l.quantity) ?? 0;
    const price = num(l.purchasePrice) ?? 0;
    return round2(qty * price);
  });
  const total = round2(lineTotals.reduce((s, n) => s + n, 0));

  function validate(): string | null {
    if (!supplier) return "Pick the supplier this stock came from.";
    const filled = lines.filter(l => l.itemName.trim());
    if (filled.length === 0) return "Add at least one item to the supply.";

    for (const line of filled) {
      const label = line.itemName.trim();
      const qty = num(line.quantity);
      if (qty == null || qty <= 0) return `Enter a positive quantity for ${label}.`;
      const purchase = num(line.purchasePrice);
      if (purchase == null || purchase < 0) return `Enter the purchase price for ${label}.`;
      if (!line.itemId) {
        if (!line.unit) return `Pick a unit for the new item ${label}.`;
        if (!line.category) return `Pick a category for the new item ${label}.`;
        if (items.some(i => i.name.trim().toLowerCase() === label.toLowerCase())) {
          return `${label} already exists in inventory — pick it from the list instead of adding it again.`;
        }
      }
      for (const { field, label: priceLabel } of PRICE_FIELDS) {
        const raw = line[field as keyof DraftLine] as string;
        if (raw.trim() === "") continue;
        const parsed = num(raw);
        if (parsed == null || parsed < 0) return `${priceLabel} for ${label} must be a positive amount.`;
      }
    }

    // Two lines for the same item would each read the pre-delivery quantity and
    // the second write would undo the first, so they have to be merged by hand.
    const seen = new Set<string>();
    for (const line of filled) {
      const id = line.itemId || `new:${line.itemName.trim().toLowerCase()}`;
      if (seen.has(id)) return `${line.itemName.trim()} appears twice — combine it into one line.`;
      seen.add(id);
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const problem = validate();
    if (problem) { setError(problem); return; }
    if (!supplier) return;

    setSaving(true);
    setError("");
    try {
      const draft: SupplyDraftLine[] = lines
        .filter(l => l.itemName.trim())
        .map(l => ({
          itemId: l.itemId,
          itemName: l.itemName.trim(),
          unit: l.unit,
          quantity: num(l.quantity)!,
          purchasePrice: num(l.purchasePrice)!,
          distributorPrice: num(l.distributorPrice),
          outletPrice: num(l.outletPrice),
          serviceCenterPrice: num(l.serviceCenterPrice),
          markedPrice: num(l.markedPrice),
          category: l.category || undefined,
          threshold: num(l.threshold) ?? 0,
          availableToDistributors: l.availableToDistributors,
        }));

      const result = await recordSupply({
        supplier,
        lines: draft,
        existingItems: itemsById,
        invoiceRef,
        note,
        actor: {
          centerId,
          uid: currentUser?.uid ?? "",
          userName: currentUser?.displayName ?? currentUser?.email ?? "Staff",
        },
      });
      setDone({ ...result, lines: draft.length });
    } catch {
      setError("Could not save the supply. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!canRecord) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <PackagePlus className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-gray-400">You don't have permission to record supplies.</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-[#0B1120] text-white">
        <PageHeader icon={<PackagePlus className="w-5 h-5" />} title="Record Supply" />
        <div className="max-w-xl mx-auto px-4 sm:px-6 py-16 text-center">
          <div className="w-14 h-14 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center mx-auto mb-4">
            <Check className="h-7 w-7 text-green-400" />
          </div>
          <h2 className="text-lg font-bold text-white">Supply {done.supplyNumber} recorded</h2>
          <p className="text-sm text-gray-400 mt-2">
            {done.lines === 1 ? "1 item" : `${done.lines} items`} booked in at {formatLKR(done.total)}. Stock levels
            and prices are updated.
          </p>
          {/* How it was paid for is recorded against the delivery itself, so a
              cheque written today lands on the cheque calendar. */}
          <button
            onClick={() => navigate("/suppliers?tab=supplies")}
            className="mt-4 text-sm text-[#F97316] hover:text-orange-300"
          >
            Record how you paid for it →
          </button>
          <div className="flex gap-3 mt-8">
            <button
              onClick={() => {
                setDone(null);
                setLines([emptyLine()]);
                setInvoiceRef("");
                setNote("");
              }}
              className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 px-4 rounded-xl transition text-sm"
            >
              Record Another
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
      <PageHeader icon={<PackagePlus className="w-5 h-5" />} title="Record Supply" />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading ? (
          <LoadingBlock className="py-20" />
        ) : suppliers.length === 0 ? (
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-16 flex flex-col items-center gap-3 text-center">
            <Building2 className="h-12 w-12 text-gray-700" />
            <p className="text-gray-400 font-medium">No active suppliers yet</p>
            <p className="text-sm text-gray-500 max-w-sm">
              Add the supplier first — a delivery is always recorded against whoever brought it.
            </p>
            <button
              onClick={() => navigate("/suppliers")}
              className="mt-2 flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold px-4 py-2 rounded-xl transition text-sm"
            >
              <Plus className="h-4 w-4" /> Add a Supplier
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            {/* Supplier */}
            <div className="bg-[#162032] border border-white/10 rounded-2xl p-5 space-y-4">
              <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Supplier</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">
                    Supplied by <span className="text-red-400">*</span>
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
                  {supplier && (
                    <p className="text-xs text-gray-500 mt-1.5">
                      {supplier.name} · {supplier.brand} · {supplier.mobile}
                    </p>
                  )}
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

            {/* Lines */}
            <div className="space-y-3">
              {lines.map((line, idx) => {
                const existing = line.itemId ? itemsById.get(line.itemId) : undefined;
                const purchase = num(line.purchasePrice) ?? 0;
                return (
                  <div key={line.key} className="bg-[#162032] border border-white/10 rounded-2xl p-5 space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
                        Item {idx + 1}
                      </h3>
                      {lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setLines(prev => prev.filter(l => l.key !== line.key))}
                          className="p-1.5 text-gray-500 hover:text-red-400 transition rounded-lg hover:bg-red-500/5"
                          title="Remove this line"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    {pickerFor === line.key || !line.itemName ? (
                      <ItemPicker
                        items={items}
                        onPick={item => pickExisting(line.key, item)}
                        onNew={name => pickNew(line.key, name)}
                      />
                    ) : (
                      <div className="flex items-start justify-between gap-3 bg-[#0B1120] border border-white/10 rounded-lg px-4 py-2.5">
                        <div className="min-w-0">
                          <p className="text-sm text-white font-medium truncate">{line.itemName}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {existing
                              ? `${existing.category} · ${existing.currentQty} ${existing.unit} in stock`
                              : "New item — it will be created in inventory"}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPickerFor(line.key)}
                          className="text-xs text-[#F97316] hover:text-[#fb923c] flex-shrink-0"
                        >
                          Change
                        </button>
                      </div>
                    )}

                    {line.itemName && (
                      <>
                        {/* New items need the details an existing one already has. */}
                        {!line.itemId && (
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div>
                              <label className="block text-xs font-medium text-gray-400 mb-1.5">
                                Category <span className="text-red-400">*</span>
                              </label>
                              <select
                                value={line.category}
                                onChange={e => setLine(line.key, { category: e.target.value })}
                                className={selectClass}
                              >
                                <option value="">Select…</option>
                                {categories.map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-400 mb-1.5">
                                Unit <span className="text-red-400">*</span>
                              </label>
                              <select
                                value={line.unit}
                                onChange={e => setLine(line.key, { unit: e.target.value })}
                                className={selectClass}
                              >
                                <option value="">Select…</option>
                                {units.map(u => <option key={u} value={u}>{u}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-400 mb-1.5">
                                Low-Stock Threshold
                              </label>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={line.threshold}
                                onChange={e => setLine(line.key, { threshold: e.target.value })}
                                placeholder="0"
                                className={inputClass}
                              />
                            </div>
                          </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-medium text-gray-400 mb-1.5">
                              Quantity Supplied <span className="text-red-400">*</span>
                            </label>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={line.quantity}
                                onChange={e => setLine(line.key, { quantity: e.target.value })}
                                placeholder="0"
                                className={inputClass}
                              />
                              <span className="text-xs text-gray-500 flex-shrink-0 w-16">
                                {line.unit || "units"}
                              </span>
                            </div>
                            {existing && num(line.quantity) ? (
                              <p className="text-xs text-gray-500 mt-1">
                                Stock after: {round2(existing.currentQty + (num(line.quantity) ?? 0))} {existing.unit}
                              </p>
                            ) : null}
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-400 mb-1.5">Line Total</label>
                            <div className="bg-[#0B1120] border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
                              {formatLKR(lineTotals[idx])}
                            </div>
                          </div>
                        </div>

                        {/* Price book */}
                        <div className="border-t border-white/5 pt-4">
                          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                            Price Book
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {PRICE_FIELDS.map(({ field, label, audience }) => {
                              const raw = line[field as keyof DraftLine] as string;
                              const margin = audience === "purchase"
                                ? null
                                : marginPercent(purchase, num(raw) ?? 0);
                              return (
                                <div key={field}>
                                  <label className="block text-xs font-medium text-gray-400 mb-1.5">
                                    {label}
                                    {field === "purchasePrice" && <span className="text-red-400 ml-1">*</span>}
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={raw}
                                    onChange={e => setLine(line.key, { [field]: e.target.value } as Partial<DraftLine>)}
                                    placeholder="0.00"
                                    className={inputClass}
                                  />
                                  {margin != null && (
                                    <p className={`text-[11px] mt-1 ${margin < 0 ? "text-red-400" : "text-gray-500"}`}>
                                      {margin >= 0 ? "+" : ""}{margin}% on cost
                                    </p>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          <p className="text-[11px] text-gray-600 mt-3">
                            Leave a price blank to keep whatever the item already has. Technicians bill the service
                            center price; distributors see their price and the MRP; the outlet counter uses the
                            outlet price.
                          </p>
                        </div>

                        {!line.itemId && (
                          <label className="flex items-start gap-3 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={line.availableToDistributors}
                              onChange={e => setLine(line.key, { availableToDistributors: e.target.checked })}
                              className="mt-0.5 h-4 w-4 rounded border-white/20 bg-[#0B1120] accent-[#F97316]"
                            />
                            <span className="text-xs text-gray-400">
                              Offer this item to distributors in their portal
                            </span>
                          </label>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setLines(prev => [...prev, emptyLine()])}
              className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-dashed border-white/15 text-gray-300 font-medium py-3 rounded-xl transition text-sm"
            >
              <Plus className="h-4 w-4" /> Add Another Item
            </button>

            {/* Summary */}
            <div className="bg-[#162032] border border-white/10 rounded-2xl p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  Note <span className="text-gray-600 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  maxLength={300}
                  placeholder="e.g. Paid cash on delivery"
                  className={inputClass}
                />
              </div>
              <div className="flex items-center justify-between border-t border-white/10 pt-4">
                <span className="text-sm text-gray-400">Supply total (at cost)</span>
                <span className="text-lg font-bold text-white">{formatLKR(total)}</span>
              </div>
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
                onClick={() => navigate("/suppliers")}
                className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-3 px-4 rounded-xl transition text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-60 text-white font-semibold py-3 px-4 rounded-xl transition text-sm flex items-center justify-center gap-2"
              >
                <Package className="h-4 w-4" />
                {saving ? "Saving…" : "Add to Inventory"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
