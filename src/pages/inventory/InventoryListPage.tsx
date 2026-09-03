import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection, query, where, onSnapshot, doc,
  arrayUnion, arrayRemove, Timestamp, getDocs, orderBy,
} from "firebase/firestore";
import { safeUpdateDoc, safeDeleteDoc, safeSetDoc } from "../../lib/firestoreWrite";
import {
  Package, Plus, Search, Edit2, Archive,
  Trash2, AlertTriangle, X, ChevronUp,
  ChevronDown, Phone, ClipboardList, Tags,
  History, ListChecks,
} from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import type { InventoryItem, ServiceJob } from "../../types/auth";
import { LoadingBlock } from "../../components/LoadingProgress";
import {
  MAX_CATEGORY_LENGTH, MAX_UNIT_LENGTH, buildCategoryList, buildUnitList,
  isDefaultCategory, isDefaultUnit, validateCategoryName, validateUnitName,
} from "../../lib/inventoryOptions";
import { round2 } from "../../lib/distributors";
import { logMovement } from "../../lib/inventoryMovements";
import { logAuditEvent } from "../../lib/auditLog";
import {
  distributorPriceOf, formatLKR, formatPrice, marginPercent, markedPriceOf,
  outletPriceOf, purchasePriceOf, serviceCenterPriceOf,
} from "../../lib/inventoryPricing";


function stockStatus(item: InventoryItem): "OK" | "Low" | "Out" {
  if (item.currentQty === 0) return "Out";
  if (item.currentQty <= item.threshold) return "Low";
  return "OK";
}

const STATUS_CHIP: Record<string, string> = {
  OK:  "bg-green-500/15 text-green-400 border-green-500/20",
  Low: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  Out: "bg-red-500/15 text-red-400 border-red-500/20",
};

// ── Price book cell ───────────────────────────────────────────────────────────
// The four selling prices at a glance, with the cost underneath for the roles
// allowed to see it. Service-center price leads because it's the one the
// workshop bills against every day.

function PriceCell({ item, showCost }: { item: InventoryItem; showCost: boolean }) {
  return (
    <div className="text-xs leading-relaxed">
      <p className="text-white font-medium">
        Service {formatPrice(serviceCenterPriceOf(item))}
      </p>
      <p className="text-gray-400">
        Dist {formatPrice(distributorPriceOf(item))} · Outlet {formatPrice(outletPriceOf(item))}
      </p>
      <p className="text-gray-600">
        MRP {formatPrice(markedPriceOf(item))}
        {showCost && <> · Cost {formatPrice(purchasePriceOf(item))}</>}
      </p>
    </div>
  );
}

// ── Stock cell ────────────────────────────────────────────────────────────────
// Quantity on its own says little — how close it is to the reorder threshold is
// the thing a storekeeper is actually reading for, so the bar shows both.

function StockCell({ item, status }: { item: InventoryItem; status: "OK" | "Low" | "Out" }) {
  // Scaled against twice the threshold so a healthy item sits around half full
  // and a low one is visibly short. Items with no threshold just read as full.
  const ceiling = item.threshold > 0 ? item.threshold * 2 : Math.max(item.currentQty, 1);
  const pct = Math.max(0, Math.min(100, (item.currentQty / ceiling) * 100));
  const bar = status === "Out" ? "bg-red-500" : status === "Low" ? "bg-amber-500" : "bg-green-500";
  const text = status === "Out" ? "text-red-400" : status === "Low" ? "text-amber-400" : "text-white";
  return (
    <div className="min-w-[7.5rem]">
      <p className="text-sm">
        <span className={`font-semibold tabular-nums ${text}`}>{item.currentQty}</span>
        <span className="text-gray-500 text-xs"> {item.unit}</span>
      </p>
      <div className="mt-1 h-1 w-full rounded-full bg-white/5 overflow-hidden">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[11px] text-gray-600 mt-1">Reorder at {item.threshold}</p>
    </div>
  );
}

function SummaryCard({
  label, value, tone,
}: {
  label: string;
  value: string;
  tone?: "amber" | "red";
}) {
  const valueClass = tone === "red" ? "text-red-400" : tone === "amber" ? "text-amber-400" : "text-white";
  return (
    <div className="bg-[#162032] border border-white/10 rounded-2xl px-4 py-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${valueClass}`}>{value}</p>
    </div>
  );
}

// ── Restock ("Add Stock") Modal ───────────────────────────────────────────────
// An item carries one price book, so a delivery that came in at a different
// cost has to be dealt with explicitly rather than silently inheriting the old
// price. The dialog takes the batch's own unit cost, shows what it does to the
// average cost of the stock on hand, and lets whoever is receiving it decide
// whether the price book moves.

/** Cost per unit across old and new stock combined, once both are on the shelf. */
function weightedAverageCost(
  currentQty: number, currentCost: number, addedQty: number, addedCost: number,
): number {
  const total = currentQty + addedQty;
  if (total <= 0) return addedCost;
  // Stock already issued can't be re-valued, so only what's actually on hand
  // carries the old cost into the average.
  const onHand = Math.max(0, currentQty);
  return Math.round(((onHand * currentCost + addedQty * addedCost) / total) * 100) / 100;
}

function RestockModal({
  item,
  centerId,
  userName,
  uid,
  canEditPrices,
  onClose,
}: {
  item: InventoryItem;
  centerId: string;
  userName: string;
  uid: string;
  canEditPrices: boolean;
  onClose: () => void;
}) {
  const currentCost = purchasePriceOf(item);
  const [qty, setQty] = useState("");
  const [unitCost, setUnitCost] = useState(currentCost > 0 ? String(currentCost) : "");
  const [pricebookAction, setPricebookAction] = useState<"update" | "keep">("update");
  const [showSelling, setShowSelling] = useState(false);
  const [sellingPrices, setSellingPrices] = useState({
    serviceCenterPrice: String(serviceCenterPriceOf(item) || ""),
    distributorPrice: String(distributorPriceOf(item) || ""),
    outletPrice: String(outletPriceOf(item) || ""),
    markedPrice: String(markedPriceOf(item) || ""),
  });
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const parsedQty = parseFloat(qty);
  const validQty = !!qty && !isNaN(parsedQty) && parsedQty > 0;
  const parsedCost = parseFloat(unitCost);
  const validCost = unitCost.trim() === "" || (!isNaN(parsedCost) && parsedCost >= 0);
  const batchCost = validCost && unitCost.trim() !== "" ? parsedCost : currentCost;

  const qtyAfter = validQty ? round2(item.currentQty + parsedQty) : item.currentQty;
  // Only a genuine change is worth asking about. An item that has never been
  // priced isn't "more expensive than last time" — its first cost just gets
  // written, which is what the default action already does.
  const priceChanged =
    unitCost.trim() !== "" && validCost && currentCost > 0 && Math.abs(batchCost - currentCost) > 0.004;
  const firstEverPrice = unitCost.trim() !== "" && validCost && currentCost <= 0 && batchCost > 0;
  const average = validQty
    ? weightedAverageCost(item.currentQty, currentCost, parsedQty, batchCost)
    : currentCost;
  const batchValue = validQty ? round2(parsedQty * batchCost) : 0;

  async function handleRestock() {
    if (!validQty) { setError("Enter a positive quantity to add."); return; }
    if (!validCost) { setError("Enter a valid unit cost, or leave it blank to keep the current one."); return; }

    setSaving(true);
    setError("");
    try {
      const newQty = round2(item.currentQty + parsedQty);
      const entry = {
        addedQty: parsedQty,
        addedBy: userName,
        timestamp: Timestamp.now(),
        note: note.trim() || null,
        // The batch keeps its own cost even when the price book is left alone,
        // so what each delivery was bought for stays on the record.
        purchasePrice: batchCost,
        previousPurchasePrice: currentCost,
        pricebookUpdated: firstEverPrice || (priceChanged && pricebookAction === "update"),
      };

      const priceUpdates: Record<string, number> = {};
      if (firstEverPrice || (priceChanged && pricebookAction === "update")) {
        priceUpdates.purchasePrice = batchCost;
        // unitCost is the deprecated field older readers still use — kept in
        // step so nothing reads a stale cost.
        priceUpdates.unitCost = batchCost;
      }
      if (showSelling && canEditPrices) {
        for (const [field, raw] of Object.entries(sellingPrices)) {
          const parsed = parseFloat(raw);
          if (raw.trim() !== "" && !isNaN(parsed) && parsed >= 0) priceUpdates[field] = parsed;
        }
      }

      await safeUpdateDoc(doc(db, "servicecenters", centerId, "inventory", item.id), {
        currentQty: newQty,
        ...priceUpdates,
        restockLog: arrayUnion(entry),
        updatedAt: Timestamp.now(),
      });
      logMovement({
        centerId,
        itemId: item.id,
        itemName: item.name,
        unit: item.unit,
        type: "restock",
        qtyChange: parsedQty,
        qtyBefore: item.currentQty,
        qtyAfter: newQty,
        unitPrice: batchCost,
        performedBy: uid,
        performedByName: userName,
        note: note.trim() || undefined,
      }).catch(() => {});
      onClose();
    } catch {
      setError("Failed to restock. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const fieldClass =
    "w-full bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-3.5 py-2.5 text-white placeholder-gray-600 text-sm transition";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header stays put while the body scrolls — the item being restocked
            is the one thing you never want to lose sight of. */}
        <div className="sticky top-0 z-10 bg-[#162032] border-b border-white/10 px-6 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-white truncate">Add Stock</h3>
            <p className="text-sm text-gray-400 truncate">{item.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition flex-shrink-0">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Where the item stands right now */}
          <div className="grid grid-cols-3 gap-3">
            <StatBox label="In stock" value={`${item.currentQty} ${item.unit}`} />
            <StatBox label="Threshold" value={`${item.threshold} ${item.unit}`} />
            <StatBox label="Current cost" value={formatPrice(currentCost)} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                Quantity to Add <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={qty}
                  onChange={e => { setQty(e.target.value); setError(""); }}
                  placeholder="e.g. 10"
                  autoFocus
                  className={`${fieldClass} pr-14`}
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-gray-500 pointer-events-none">
                  {item.unit}
                </span>
              </div>
              {validQty && (
                <p className="mt-1.5 text-xs text-gray-500">
                  Stock after: <span className="text-white font-medium">{qtyAfter} {item.unit}</span>
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                Unit Cost for this Batch
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs text-gray-500 pointer-events-none">
                  LKR
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={unitCost}
                  onChange={e => { setUnitCost(e.target.value); setError(""); }}
                  placeholder={currentCost > 0 ? String(currentCost) : "0.00"}
                  className={`${fieldClass} pl-12`}
                />
              </div>
              <p className="mt-1.5 text-xs text-gray-500">
                {validQty && batchCost > 0
                  ? <>Batch value: <span className="text-white font-medium">{formatLKR(batchValue)}</span></>
                  : "What you paid the supplier per unit this time."}
              </p>
            </div>
          </div>

          {/* The price question, asked only when it actually arises */}
          {priceChanged && (
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="text-amber-300 font-medium">
                    This batch costs {batchCost > currentCost ? "more" : "less"} than the last one.
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {formatPrice(currentCost)} → {formatLKR(batchCost)} per {item.unit}.
                    {validQty && <> Blending both batches, the stock on hand averages{" "}
                      <span className="text-white font-medium">{formatLKR(average)}</span>.</>}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <PriceChoice
                  active={pricebookAction === "update"}
                  onClick={() => setPricebookAction("update")}
                  title="Use the new cost"
                  desc={`All ${qtyAfter} ${item.unit} will be costed at ${formatLKR(batchCost)}.`}
                />
                <PriceChoice
                  active={pricebookAction === "keep"}
                  onClick={() => setPricebookAction("keep")}
                  title="Keep the old cost"
                  desc={`Stock stays costed at ${formatPrice(currentCost)}; the batch price is only logged.`}
                />
              </div>
              <p className="text-[11px] text-gray-600">
                Either way, jobs already invoiced keep the cost they were billed at — this only
                affects stock still on the shelf. To track two prices side by side, add the new
                delivery as its own item instead.
              </p>
            </div>
          )}

          {/* Selling prices, folded away until they're wanted */}
          {canEditPrices && (
            <div>
              <button
                type="button"
                onClick={() => setShowSelling(v => !v)}
                className="flex items-center gap-1.5 text-sm text-gray-300 hover:text-white transition"
              >
                {showSelling ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                Also update selling prices
                {priceChanged && !showSelling && (
                  <span className="text-xs text-amber-400">— cost changed, margins have moved</span>
                )}
              </button>
              {showSelling && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {([
                    ["serviceCenterPrice", "Service Center"],
                    ["outletPrice", "Outlet"],
                    ["distributorPrice", "Distributor"],
                    ["markedPrice", "Marked (MRP)"],
                  ] as const).map(([field, label]) => {
                    const value = parseFloat(sellingPrices[field]);
                    const margin = !isNaN(value) ? marginPercent(batchCost, value) : null;
                    return (
                      <div key={field}>
                        <label className="block text-xs text-gray-400 mb-1">{label}</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={sellingPrices[field]}
                          onChange={e => setSellingPrices(p => ({ ...p, [field]: e.target.value }))}
                          className={fieldClass}
                        />
                        {margin !== null && (
                          <p className={`mt-1 text-[11px] ${margin < 0 ? "text-red-400" : "text-gray-600"}`}>
                            {margin}% margin
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Note <span className="text-gray-600 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. Kandy Auto Parts, invoice #2341"
              className={fieldClass}
            />
          </div>

          {error && (
            <p className="text-sm text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {error}
            </p>
          )}
        </div>

        <div className="sticky bottom-0 bg-[#162032] border-t border-white/10 px-6 py-4 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 px-4 rounded-lg transition text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleRestock}
            disabled={saving || !validQty}
            className="flex-1 bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 px-4 rounded-lg transition text-sm flex items-center justify-center gap-2"
          >
            {saving ? (
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : <Plus className="h-4 w-4" />}
            {validQty ? `Add ${parsedQty} ${item.unit}` : "Add Stock"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#0B1120] border border-white/5 rounded-xl px-3 py-2.5">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className="text-sm font-semibold text-white mt-0.5 truncate">{value}</p>
    </div>
  );
}

function PriceChoice({
  active, onClick, title, desc,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-lg border px-3 py-2.5 transition ${
        active
          ? "bg-[#F97316]/15 border-[#F97316]/40"
          : "bg-[#0B1120] border-white/10 hover:border-white/20"
      }`}
    >
      <p className={`text-xs font-semibold ${active ? "text-[#F97316]" : "text-gray-300"}`}>{title}</p>
      <p className="text-[11px] text-gray-500 mt-0.5">{desc}</p>
    </button>
  );
}

// ── Manage Categories & Units Modal ───────────────────────────────────────────
// Categories and units are the same idea — a list of built-ins the center can
// extend — so they share one modal with a tab apiece rather than two near
// identical dialogs.

type OptionKind = "category" | "unit";

interface OptionTab {
  kind: OptionKind;
  label: string;
  /** The field on the center document holding this center's custom entries. */
  field: "customInventoryCategories" | "customInventoryUnits";
  options: string[];
  custom: string[];
  counts: Record<string, number>;
  maxLength: number;
  isDefault: (name: string) => boolean;
  validate: (name: string, existing: string[]) => string | null;
  placeholder: string;
}

function ManageOptionsModal({
  centerId,
  categories,
  customCategories,
  itemsByCategory,
  units,
  customUnits,
  itemsByUnit,
  onClose,
}: {
  centerId: string;
  categories: string[];
  customCategories: string[];
  itemsByCategory: Record<string, number>;
  units: string[];
  customUnits: string[];
  itemsByUnit: Record<string, number>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<OptionKind>("category");
  const [newValue, setNewValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const tabs: OptionTab[] = [
    {
      kind: "category",
      label: "Categories",
      field: "customInventoryCategories",
      options: categories,
      custom: customCategories,
      counts: itemsByCategory,
      maxLength: MAX_CATEGORY_LENGTH,
      isDefault: isDefaultCategory,
      validate: validateCategoryName,
      placeholder: "New category name",
    },
    {
      kind: "unit",
      label: "Units",
      field: "customInventoryUnits",
      options: units,
      custom: customUnits,
      counts: itemsByUnit,
      maxLength: MAX_UNIT_LENGTH,
      isDefault: isDefaultUnit,
      validate: validateUnitName,
      placeholder: "e.g. Drums",
    },
  ];
  const active = tabs.find(t => t.kind === kind)!;

  function switchTab(next: OptionKind) {
    setKind(next);
    setNewValue("");
    setError("");
  }

  async function handleAdd() {
    const trimmed = newValue.trim();
    const problem = active.validate(trimmed, active.options);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError("");
    try {
      await safeSetDoc(
        doc(db, "servicecenters", centerId),
        { [active.field]: arrayUnion(trimmed) },
        { merge: true },
      );
      setNewValue("");
    } catch {
      setError(`Could not save the ${active.kind}. Please try again.`);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(value: string) {
    setBusy(true);
    setError("");
    try {
      await safeSetDoc(
        doc(db, "servicecenters", centerId),
        { [active.field]: arrayRemove(value) },
        { merge: true },
      );
    } catch {
      setError(`Could not remove the ${active.kind}. Please try again.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Categories &amp; Units</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex gap-1 bg-[#0B1120] p-1 rounded-xl border border-white/5 w-fit mb-4">
          {tabs.map(t => (
            <button
              key={t.kind}
              onClick={() => switchTab(t.kind)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${
                kind === t.kind ? "bg-[#F97316] text-white" : "text-gray-400 hover:text-white hover:bg-white/5"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={newValue}
            onChange={e => { setNewValue(e.target.value); setError(""); }}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } }}
            placeholder={active.placeholder}
            maxLength={active.maxLength}
            className="flex-1 bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-4 py-2.5 text-white placeholder-gray-600 text-sm transition"
          />
          <button
            onClick={handleAdd}
            disabled={busy}
            className="flex-shrink-0 flex items-center gap-1.5 bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-60 text-white font-semibold px-3 rounded-lg transition text-sm"
          >
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>

        {error && (
          <p className="text-sm text-red-400 flex items-center gap-1.5 mb-3">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {error}
          </p>
        )}

        <div className="max-h-72 overflow-y-auto space-y-1.5">
          {active.options.map(option => {
            const custom = !active.isDefault(option);
            const count = active.counts[option] ?? 0;
            return (
              <div
                key={option}
                className="flex items-center justify-between gap-3 bg-[#0B1120] border border-white/5 rounded-lg px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">{option}</p>
                  <p className="text-xs text-gray-500">
                    {count === 1 ? "1 item" : `${count} items`}
                    {!custom && " · built-in"}
                  </p>
                </div>
                {custom && active.custom.includes(option) && (
                  <button
                    onClick={() => handleRemove(option)}
                    disabled={busy}
                    title={count > 0
                      ? `Removing this only takes it off the list — items already using it keep their ${active.kind}.`
                      : `Remove ${active.kind}`}
                    className="p-1.5 text-gray-500 hover:text-red-400 transition rounded-lg hover:bg-red-500/5 flex-shrink-0 disabled:opacity-60"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-xs text-gray-600 mt-4">
          Built-in {active.label.toLowerCase()} can't be removed. Removing a custom one leaves existing items
          untouched — it just stops being offered on new items.
        </p>
      </div>
    </div>
  );
}

// ── Archive / Delete Confirm Modal ────────────────────────────────────────────

function ConfirmModal({
  title,
  body,
  confirmLabel,
  confirmClass,
  onConfirm,
  onClose,
  loading,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  confirmClass: string;
  onConfirm: () => void;
  onClose: () => void;
  loading?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-start gap-3 mb-5">
          <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-base font-semibold text-white">{title}</h3>
            <div className="text-sm text-gray-400 mt-1">{body}</div>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 px-4 rounded-lg transition text-sm"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 ${confirmClass} disabled:opacity-60 text-white font-semibold py-2.5 px-4 rounded-lg transition text-sm`}
          >
            {loading ? "Processing…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type SortKey = "name" | "qty" | "status";
type SortDir = "asc" | "desc";

export default function InventoryListPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const centerId = currentUser?.centerId ?? "";

  const canViewInventory    = usePermission("inventory.view");
  const canCreateInventory  = usePermission("inventory.create");
  const canEditInventory    = usePermission("inventory.edit");
  const canDeleteInventory  = usePermission("inventory.delete");
  const canRestockInventory = usePermission("inventory.restock");
  const canRequestStock     = usePermission("inventory.request");
  const canApproveRequests  = usePermission("inventory.approveRequests");
  const canManageCategories = usePermission("inventory.manageCategories");
  const canViewAudit        = usePermission("inventory.viewLogs");
  const canStockCount       = usePermission("inventory.stockCount");
  const canPlanOrders       = usePermission("suppliers.planOrders");
  // What the workshop paid is commercially sensitive — it rides with the right
  // to change an item's price book rather than with plain read access.
  const canViewCost         = usePermission("inventory.edit");

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);


  // Filters & sort
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("All");
  const [statusFilter, setStatusFilter] = useState<"All" | "LowOut">("All");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Category and unit options: built-ins + the center's custom lists
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [customUnits, setCustomUnits] = useState<string[]>([]);

  // Modals
  const [restockItem, setRestockItem] = useState<InventoryItem | null>(null);
  // Held by id, not by value: releasing deducts stock, so the modal has to see
  // the live quantity rather than whatever it was when the modal opened.
  const [manageOptions, setManageOptions] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<InventoryItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InventoryItem | null>(null);
  const [deleteBlocked, setDeleteBlocked] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);

  // Real-time inventory listener
  useEffect(() => {
    if (!centerId) return;
    const q = query(
      collection(db, "servicecenters", centerId, "inventory"),
      where("isArchived", "!=", true),
      orderBy("isArchived"),
      orderBy("name"),
    );
    return onSnapshot(q, snap => {
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryItem)));
      setLoading(false);
    }, () => {
      // Fallback if index not ready: load without ordering
      const q2 = query(collection(db, "servicecenters", centerId, "inventory"));
      const unsub2 = onSnapshot(q2, snap2 => {
        setItems(
          snap2.docs
            .map(d => ({ id: d.id, ...d.data() } as InventoryItem))
            .filter(i => !i.isArchived)
        );
        setLoading(false);
      }, () => {
        // Both queries failed — stop loading and show empty state
        setLoading(false);
      });
      return unsub2;
    });
  }, [centerId]);

  // Custom categories and units live on the center doc — listen so the manage
  // modal reflects an add/remove without a reload.
  useEffect(() => {
    if (!centerId) return;
    return onSnapshot(doc(db, "servicecenters", centerId), snap => {
      const data = snap.data() as {
        customInventoryCategories?: string[];
        customInventoryUnits?: string[];
      } | undefined;
      setCustomCategories(data?.customInventoryCategories ?? []);
      setCustomUnits(data?.customInventoryUnits ?? []);
    }, () => { setCustomCategories([]); setCustomUnits([]); });
  }, [centerId]);

  const categories = useMemo(
    () => buildCategoryList(customCategories, items.map(i => i.category)),
    [customCategories, items],
  );

  const units = useMemo(
    () => buildUnitList(customUnits, items.map(i => i.unit)),
    [customUnits, items],
  );

  const itemsByCategory = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach(i => { counts[i.category] = (counts[i.category] ?? 0) + 1; });
    return counts;
  }, [items]);

  const itemsByUnit = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach(i => { counts[i.unit] = (counts[i.unit] ?? 0) + 1; });
    return counts;
  }, [items]);

  // Derived: filtered + sorted list
  const displayed = useMemo(() => {
    let list = [...items];

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(i => i.name.toLowerCase().includes(q) || (i.partNumber ?? "").toLowerCase().includes(q));
    }
    if (categoryFilter !== "All") {
      list = list.filter(i => i.category === categoryFilter);
    }
    if (statusFilter === "LowOut") {
      list = list.filter(i => stockStatus(i) !== "OK");
    }

    const statusOrder = { Out: 0, Low: 1, OK: 2 };
    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "qty") cmp = a.currentQty - b.currentQty;
      else if (sortKey === "status") cmp = statusOrder[stockStatus(a)] - statusOrder[stockStatus(b)];
      return sortDir === "asc" ? cmp : -cmp;
    });

    return list;
  }, [items, search, categoryFilter, statusFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <ChevronUp className="h-3.5 w-3.5 text-gray-600" />;
    return sortDir === "asc"
      ? <ChevronUp className="h-3.5 w-3.5 text-[#F97316]" />
      : <ChevronDown className="h-3.5 w-3.5 text-[#F97316]" />;
  }

  // Archive
  async function handleArchive() {
    if (!archiveTarget) return;
    setModalLoading(true);
    try {
      await safeUpdateDoc(doc(db, "servicecenters", centerId, "inventory", archiveTarget.id), {
        isArchived: true,
        updatedAt: Timestamp.now(),
      });
      setArchiveTarget(null);
    } finally {
      setModalLoading(false);
    }
  }

  // Delete — check if item used in last 6 months
  async function initiateDelete(item: InventoryItem) {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const recentJobsSnap = await getDocs(
      query(
        collection(db, "servicecenters", centerId, "jobs"),
        where("createdAt", ">=", Timestamp.fromDate(sixMonthsAgo))
      )
    );

    const usedInRecentJob = recentJobsSnap.docs.some(d => {
      const job = d.data() as ServiceJob;
      return (job.partsUsed ?? []).some((p) => p.itemId === item.id);
    });

    setDeleteBlocked(usedInRecentJob);
    setDeleteTarget(item);
  }

  async function handleDelete() {
    if (!deleteTarget || deleteBlocked) return;
    setModalLoading(true);
    try {
      await safeDeleteDoc(doc(db, "servicecenters", centerId, "inventory", deleteTarget.id));
      if (currentUser) {
        void logAuditEvent({
          centerId,
          action: "delete",
          entityType: "inventory",
          entityId: deleteTarget.id,
          entityLabel: deleteTarget.name,
          performedBy: currentUser.uid,
          performedByName: currentUser.displayName || currentUser.email || "Unknown",
        });
      }
      setDeleteTarget(null);
    } finally {
      setModalLoading(false);
    }
  }

  if (!canViewInventory) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <Package className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-gray-400">You don't have permission to view Inventory.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <PageHeader
        icon={<Package className="w-5 h-5" />}
        title="Inventory"
        actions={
          <div className="flex items-center gap-2">
            {canManageCategories && (
              <button
                onClick={() => setManageOptions(true)}
                className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium px-4 py-2.5 rounded-xl transition text-sm"
              >
                <Tags className="h-4 w-4" />
                Categories &amp; Units
              </button>
            )}
            {(canRequestStock || canApproveRequests) && (
              <button
                onClick={() => navigate("/inventory/requests")}
                className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium px-4 py-2.5 rounded-xl transition text-sm"
              >
                <ClipboardList className="h-4 w-4" />
                {canApproveRequests ? "Requests" : "Request Item"}
              </button>
            )}
            {canViewAudit && (
              <button
                onClick={() => navigate("/inventory/audit")}
                className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium px-4 py-2.5 rounded-xl transition text-sm"
              >
                <History className="h-4 w-4" />
                Audit
              </button>
            )}
            {canStockCount && (
              <button
                onClick={() => navigate("/inventory/stock-count")}
                className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium px-4 py-2.5 rounded-xl transition text-sm"
              >
                <ListChecks className="h-4 w-4" />
                Stock Count
              </button>
            )}
            {canCreateInventory && (
              <button
                onClick={() => navigate("/inventory/add")}
                className="flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold px-4 py-2.5 rounded-xl transition text-sm"
              >
                <Plus className="h-4 w-4" />
                Add Item
              </button>
            )}
          </div>
        }
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* At-a-glance totals — what the store room is worth and what needs
            ordering, before anyone starts reading rows. */}
        {!loading && items.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <SummaryCard label="Items" value={String(items.length)} />
            <SummaryCard
              label="Low stock"
              value={String(items.filter(i => stockStatus(i) === "Low").length)}
              tone="amber"
            />
            <SummaryCard
              label="Out of stock"
              value={String(items.filter(i => stockStatus(i) === "Out").length)}
              tone="red"
            />
            {canViewCost && (
              <SummaryCard
                label="Stock value (at cost)"
                value={formatLKR(round2(items.reduce((sum, i) => sum + i.currentQty * purchasePriceOf(i), 0)))}
              />
            )}
          </div>
        )}

        {/* Filters */}
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-4 mb-6 space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by item name or code…"
                className="w-full pl-9 pr-4 py-2.5 bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-xl text-sm text-white placeholder-gray-600 transition"
              />
            </div>

            {/* Status filter */}
            <div className="flex gap-2">
              <button
                onClick={() => setStatusFilter("All")}
                className={`px-3 py-2 rounded-xl text-sm font-medium transition border ${
                  statusFilter === "All"
                    ? "bg-[#F97316]/20 text-[#F97316] border-[#F97316]/40"
                    : "bg-[#0B1120] text-gray-400 border-white/10 hover:border-white/20"
                }`}
              >
                All
              </button>
              <button
                onClick={() => setStatusFilter("LowOut")}
                className={`px-3 py-2 rounded-xl text-sm font-medium transition border flex items-center gap-1.5 ${
                  statusFilter === "LowOut"
                    ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
                    : "bg-[#0B1120] text-gray-400 border-white/10 hover:border-white/20"
                }`}
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                Low &amp; Out
              </button>
            </div>
          </div>

          {/* Category filter */}
          <div className="flex flex-wrap gap-2">
            {["All", ...categories].map(cat => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition border ${
                  categoryFilter === cat
                    ? "bg-[#F97316]/20 text-[#F97316] border-[#F97316]/40"
                    : "bg-[#0B1120] text-gray-400 border-white/10 hover:border-white/20"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <LoadingBlock className="py-20" />
        ) : displayed.length === 0 ? (
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-16 flex flex-col items-center gap-3">
            <Package className="h-12 w-12 text-gray-700" />
            <p className="text-gray-400 font-medium">
              {items.length === 0 ? "No inventory items yet" : "No items match your filters"}
            </p>
            {items.length === 0 && canCreateInventory && (
              <button
                onClick={() => navigate("/inventory/add")}
                className="mt-2 flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold px-4 py-2 rounded-xl transition text-sm"
              >
                <Plus className="h-4 w-4" /> Add First Item
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block bg-[#162032] border border-white/10 rounded-2xl overflow-hidden">
              <div className="max-h-[70vh] overflow-y-auto">
              <table className="w-full text-sm">
                {/* Header sticks so the columns stay readable on a long list */}
                <thead className="sticky top-0 z-10 bg-[#1b2740]">
                  <tr className="border-b border-white/10 text-left">
                    <th className="px-5 py-3 text-xs uppercase tracking-wider text-gray-500 font-semibold">
                      <button onClick={() => toggleSort("name")} className="flex items-center gap-1 hover:text-white transition">
                        Item <SortIcon k="name" />
                      </button>
                    </th>
                    <th className="px-5 py-3 text-xs uppercase tracking-wider text-gray-500 font-semibold">Category</th>
                    <th className="px-5 py-3 text-xs uppercase tracking-wider text-gray-500 font-semibold">
                      <button onClick={() => toggleSort("qty")} className="flex items-center gap-1 hover:text-white transition">
                        Stock <SortIcon k="qty" />
                      </button>
                    </th>
                    <th className="px-5 py-3 text-xs uppercase tracking-wider text-gray-500 font-semibold">Prices</th>
                    <th className="px-5 py-3 text-xs uppercase tracking-wider text-gray-500 font-semibold">
                      <button onClick={() => toggleSort("status")} className="flex items-center gap-1 hover:text-white transition">
                        Status <SortIcon k="status" />
                      </button>
                    </th>
                    <th className="px-5 py-3 text-xs uppercase tracking-wider text-gray-500 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {displayed.map(item => {
                    const st = stockStatus(item);
                    return (
                      <tr
                        key={item.id}
                        className={`hover:bg-white/[0.03] transition group border-l-2 ${
                          st === "Out" ? "border-l-red-500/60" : st === "Low" ? "border-l-amber-500/60" : "border-l-transparent"
                        }`}
                      >
                        <td className="px-5 py-3.5">
                          <p className="font-medium text-white leading-tight">{item.name}</p>
                          <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                            {item.partNumber && <span className="font-mono text-gray-500">{item.partNumber}</span>}
                            {(item.supplierCompany || item.supplierName) && (
                              <span>{item.supplierCompany || item.supplierName}</span>
                            )}
                            {item.supplierBrand && <span className="text-gray-600">· {item.supplierBrand}</span>}
                            {item.supplierPhone && (
                              <a
                                href={`tel:${item.supplierPhone}`}
                                className="inline-flex items-center gap-0.5 text-[#F97316] hover:text-[#fb923c]"
                                onClick={e => e.stopPropagation()}
                              >
                                <Phone className="h-3 w-3" /> {item.supplierPhone}
                              </a>
                            )}
                          </p>
                        </td>
                        <td className="px-5 py-3.5 text-gray-300 whitespace-nowrap">{item.category}</td>
                        <td className="px-5 py-3.5">
                          <StockCell item={item} status={st} />
                        </td>
                        <td className="px-5 py-3.5">
                          <PriceCell item={item} showCost={canViewCost} />
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${STATUS_CHIP[st]}`}>
                            {st}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center justify-end gap-1.5">
                            {canRestockInventory && (
                              <button
                                onClick={() => setRestockItem(item)}
                                className="flex items-center gap-1.5 text-xs font-medium bg-[#F97316]/10 hover:bg-[#F97316]/20 text-[#F97316] border border-[#F97316]/20 px-3 py-1.5 rounded-lg transition"
                              >
                                <Plus className="h-3.5 w-3.5" />
                                Add Stock
                              </button>
                            )}
                            {canPlanOrders && st !== "OK" && item.supplierId && (
                              <button
                                onClick={() => navigate(`/suppliers/orders/plan?supplierId=${item.supplierId}&itemId=${item.id}`)}
                                title="Plan a purchase order from this item's supplier"
                                className="flex items-center gap-1.5 text-xs font-medium bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 px-3 py-1.5 rounded-lg transition"
                              >
                                <ClipboardList className="h-3.5 w-3.5" />
                                Plan Order
                              </button>
                            )}
                            {/* Destructive and secondary actions stay muted until
                                the row is hovered, so a long list reads as data
                                rather than a wall of icons. */}
                            <div className="flex items-center gap-0.5 opacity-40 group-hover:opacity-100 transition-opacity">
                              {canEditInventory && (
                                <button
                                  onClick={() => navigate(`/inventory/${item.id}/edit`)}
                                  className="p-1.5 text-gray-400 hover:text-white transition rounded-lg hover:bg-white/5"
                                  title="Edit"
                                >
                                  <Edit2 className="h-4 w-4" />
                                </button>
                              )}
                              {canEditInventory && (
                                <button
                                  onClick={() => setArchiveTarget(item)}
                                  className="p-1.5 text-gray-400 hover:text-amber-400 transition rounded-lg hover:bg-amber-500/5"
                                  title="Archive"
                                >
                                  <Archive className="h-4 w-4" />
                                </button>
                              )}
                              {canDeleteInventory && (
                                <button
                                  onClick={() => initiateDelete(item)}
                                  className="p-1.5 text-gray-400 hover:text-red-400 transition rounded-lg hover:bg-red-500/5"
                                  title="Delete"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {displayed.map(item => {
                const st = stockStatus(item);
                return (
                  <div key={item.id} className="bg-[#162032] border border-white/10 rounded-2xl p-4">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-white">{item.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{item.category}</p>
                      </div>
                      <span className={`flex-shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${STATUS_CHIP[st]}`}>
                        {st}
                      </span>
                    </div>
                    <div className="mb-3">
                      <StockCell item={item} status={st} />
                    </div>
                    <div className="bg-[#0B1120] border border-white/5 rounded-lg px-3 py-2 mb-3">
                      <PriceCell item={item} showCost={canViewCost} />
                    </div>
                    {(canRestockInventory || canEditInventory || canDeleteInventory || canPlanOrders) && (
                      <div className="flex gap-2">
                        {canRestockInventory && (
                          <button
                            onClick={() => setRestockItem(item)}
                            className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium bg-[#F97316]/10 hover:bg-[#F97316]/20 text-[#F97316] border border-[#F97316]/20 px-3 py-2 rounded-lg transition"
                          >
                            <Plus className="h-3.5 w-3.5" /> Add Stock
                          </button>
                        )}
                        {canPlanOrders && st !== "OK" && item.supplierId && (
                          <button
                            onClick={() => navigate(`/suppliers/orders/plan?supplierId=${item.supplierId}&itemId=${item.id}`)}
                            className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 px-3 py-2 rounded-lg transition"
                          >
                            <ClipboardList className="h-3.5 w-3.5" /> Plan Order
                          </button>
                        )}
                        {canEditInventory && (
                          <button
                            onClick={() => navigate(`/inventory/${item.id}/edit`)}
                            className="p-2 text-gray-500 hover:text-white transition rounded-lg bg-white/5"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                        )}
                        {canEditInventory && (
                          <button
                            onClick={() => setArchiveTarget(item)}
                            className="p-2 text-gray-500 hover:text-amber-400 transition rounded-lg bg-white/5"
                          >
                            <Archive className="h-4 w-4" />
                          </button>
                        )}
                        {canDeleteInventory && (
                          <button
                            onClick={() => initiateDelete(item)}
                            className="p-2 text-gray-500 hover:text-red-400 transition rounded-lg bg-white/5"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Restock Modal */}
      {restockItem && (
        <RestockModal
          item={restockItem}
          centerId={centerId}
          userName={currentUser?.displayName ?? currentUser?.email ?? "Staff"}
          uid={currentUser?.uid ?? ""}
          canEditPrices={canEditInventory}
          onClose={() => setRestockItem(null)}
        />
      )}

      {/* Manage Categories & Units */}
      {manageOptions && (
        <ManageOptionsModal
          centerId={centerId}
          categories={categories}
          customCategories={customCategories}
          itemsByCategory={itemsByCategory}
          units={units}
          customUnits={customUnits}
          itemsByUnit={itemsByUnit}
          onClose={() => setManageOptions(false)}
        />
      )}

      {/* Archive Confirm */}
      {archiveTarget && (
        <ConfirmModal
          title="Archive Item"
          body={
            <>
              Archive <strong className="text-white">{archiveTarget.name}</strong>? It will be hidden from the active
              inventory list but remain in historical service records.
            </>
          }
          confirmLabel="Archive"
          confirmClass="bg-amber-500 hover:bg-amber-600"
          onConfirm={handleArchive}
          onClose={() => setArchiveTarget(null)}
          loading={modalLoading}
        />
      )}

      {/* Delete Confirm */}
      {deleteTarget && (
        deleteBlocked ? (
          <ConfirmModal
            title="Cannot Delete Item"
            body={
              <>
                <strong className="text-white">{deleteTarget.name}</strong> has been used in recent services (within
                the last 6 months). Archive instead of deleting?
              </>
            }
            confirmLabel="Archive Instead"
            confirmClass="bg-amber-500 hover:bg-amber-600"
            onConfirm={async () => {
              setModalLoading(true);
              await safeUpdateDoc(doc(db, "servicecenters", centerId, "inventory", deleteTarget.id), {
                isArchived: true,
                updatedAt: Timestamp.now(),
              });
              setDeleteTarget(null);
              setModalLoading(false);
            }}
            onClose={() => setDeleteTarget(null)}
            loading={modalLoading}
          />
        ) : (
          <ConfirmModal
            title="Delete Item"
            body={
              <>
                Permanently delete <strong className="text-white">{deleteTarget.name}</strong>? This cannot be undone.
              </>
            }
            confirmLabel="Delete"
            confirmClass="bg-red-600 hover:bg-red-700"
            onConfirm={handleDelete}
            onClose={() => setDeleteTarget(null)}
            loading={modalLoading}
          />
        )
      )}
    </div>
  );
}
