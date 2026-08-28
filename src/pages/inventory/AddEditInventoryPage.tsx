import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  doc, getDoc, collection, query, where,
  getDocs, onSnapshot, Timestamp, arrayUnion, deleteField,
} from "firebase/firestore";
import { safeSetDoc, safeUpdateDoc } from "../../lib/firestoreWrite";
import { Package, AlertTriangle, Plus, X, Check } from "lucide-react";
import { db } from "../../config/firebase";
import { supplierBrandLabel, supplierBrands, supplierMobiles } from "../../lib/suppliers";
import { useAuth } from "../../contexts/AuthContext";
import type { InventoryItem, Supplier } from "../../types/auth";
import { useTranslation } from "react-i18next";
import { LoadingScreen } from "../../components/LoadingProgress";
import {
  MAX_CATEGORY_LENGTH, MAX_UNIT_LENGTH, buildCategoryList, buildUnitList,
  isDefaultCategory, isDefaultUnit, validateCategoryName, validateUnitName,
} from "../../lib/inventoryOptions";
import { PRICE_FIELDS, marginPercent } from "../../lib/inventoryPricing";
import { logAuditEvent } from "../../lib/auditLog";

// ── Constants ─────────────────────────────────────────────────────────────────

// LK phone: 07XXXXXXXX or +94XXXXXXXXX
function validateLKPhone(phone: string): boolean {
  if (!phone) return true;
  return /^(\+94|0)\d{9}$/.test(phone.replace(/\s/g, ""));
}

// ── Form ──────────────────────────────────────────────────────────────────────

interface FormState {
  name: string;
  partNumber: string;
  category: string;
  unit: string;
  currentQty: string;
  threshold: string;
  // The price book — one figure per audience (see lib/inventoryPricing).
  purchasePrice: string;
  distributorPrice: string;
  outletPrice: string;
  serviceCenterPrice: string;
  markedPrice: string;
  availableToDistributors: boolean;
  supplierId: string;
  supplierName: string;
  supplierCompany: string;
  supplierBrand: string;
  supplierPhone: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  partNumber: "",
  category: "",
  unit: "",
  currentQty: "",
  threshold: "",
  purchasePrice: "",
  distributorPrice: "",
  outletPrice: "",
  serviceCenterPrice: "",
  markedPrice: "",
  availableToDistributors: true,
  supplierId: "",
  supplierName: "",
  supplierCompany: "",
  supplierBrand: "",
  supplierPhone: "",
  notes: "",
};

// The price-book fields, in the order the form renders them. Keyed off the
// shared definition so a new price never has to be added in two places.
const PRICE_INPUTS = PRICE_FIELDS.map(p => ({
  ...p,
  // FormState mirrors InventoryItem's price keys one-for-one.
  key: p.field as keyof FormState,
}));

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1.5">
        {label}
        {required && <span className="text-red-400 ml-1">*</span>}
        {!required && <span className="text-gray-600 font-normal ml-1">(optional)</span>}
      </label>
      {children}
      {error && (
        <p className="mt-1 text-xs text-red-400 flex items-center gap-1">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" /> {error}
        </p>
      )}
    </div>
  );
}

const inputClass =
  "w-full bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-xl px-4 py-2.5 text-white placeholder-gray-600 text-sm transition";
const selectClass =
  "w-full bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-xl px-4 py-2.5 text-white text-sm transition appearance-none";

/**
 * A dropdown that can grow. Categories and units both come from a built-in list
 * the center extends as it goes, so both are picked the same way: choose one,
 * or type a new one and have it saved for next time. `onAdd` persists the entry
 * and returns a message when it can't be used, or null when it was accepted.
 */
function OptionSelect({
  value,
  options,
  selectLabel,
  addLabel,
  newPlaceholder,
  maxLength,
  onSelect,
  onAdd,
}: {
  value: string;
  options: string[];
  selectLabel: string;
  addLabel: string;
  newPlaceholder: string;
  maxLength: number;
  onSelect: (value: string) => void;
  onAdd: (value: string) => Promise<string | null>;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function cancel() {
    setAdding(false);
    setDraft("");
    setError("");
  }

  async function save() {
    setSaving(true);
    const problem = await onAdd(draft.trim());
    setSaving(false);
    if (problem) { setError(problem); return; }
    cancel();
  }

  if (!adding) {
    return (
      <>
        <select
          value={value}
          onChange={e => onSelect(e.target.value)}
          className={selectClass}
        >
          <option value="">{selectLabel}</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-1.5 inline-flex items-center gap-1 text-xs text-[#F97316] hover:text-[#fb923c] transition"
        >
          <Plus className="h-3.5 w-3.5" /> {addLabel}
        </button>
      </>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          autoFocus
          value={draft}
          onChange={e => { setDraft(e.target.value); setError(""); }}
          onKeyDown={e => {
            if (e.key === "Enter") { e.preventDefault(); save(); }
            if (e.key === "Escape") cancel();
          }}
          placeholder={newPlaceholder}
          maxLength={maxLength}
          className={inputClass}
        />
        <button
          type="button"
          onClick={save}
          disabled={saving}
          title="Save"
          className="flex-shrink-0 px-3 rounded-xl bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-60 text-white transition"
        >
          <Check className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={cancel}
          title="Cancel"
          className="flex-shrink-0 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 transition"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AddEditInventoryPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const isEdit = Boolean(itemId);

  const centerId = currentUser?.centerId ?? "";
  const role = currentUser?.role;

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saving, setSaving] = useState(false);
  const [loadingItem, setLoadingItem] = useState(isEdit);
  const [generalError, setGeneralError] = useState("");

  // Category and unit options = built-ins + the center's custom lists. Kept in
  // state so an entry added from this form shows up in its dropdown straight
  // away.
  const [categories, setCategories] = useState<string[]>(() => buildCategoryList());
  const [units, setUnits] = useState<string[]>(() => buildUnitList());

  // Suppliers the center buys from. Picking one fills the supplier block in
  // rather than making the same details be retyped on every item.
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  // Prices as they were when the item was loaded, so a save can log exactly
  // what changed rather than just that a save happened.
  const originalItemRef = useRef<InventoryItem | null>(null);

  // Load existing item for edit
  useEffect(() => {
    if (!isEdit || !itemId || !centerId) return;
    getDoc(doc(db, "servicecenters", centerId, "inventory", itemId)).then(snap => {
      if (!snap.exists()) { navigate("/inventory"); return; }
      const item = snap.data() as InventoryItem;
      originalItemRef.current = item;
      setForm({
        name: item.name,
        partNumber: item.partNumber ?? "",
        category: item.category,
        unit: item.unit,
        currentQty: String(item.currentQty),
        threshold: String(item.threshold),
        // An item saved before the price book existed only carries unitCost.
        purchasePrice: item.purchasePrice != null
          ? String(item.purchasePrice)
          : item.unitCost != null ? String(item.unitCost) : "",
        distributorPrice: item.distributorPrice != null ? String(item.distributorPrice) : "",
        outletPrice: item.outletPrice != null ? String(item.outletPrice) : "",
        serviceCenterPrice: item.serviceCenterPrice != null ? String(item.serviceCenterPrice) : "",
        markedPrice: item.markedPrice != null ? String(item.markedPrice) : "",
        availableToDistributors: item.availableToDistributors !== false,
        supplierId: item.supplierId ?? "",
        supplierName: item.supplierName ?? "",
        supplierCompany: item.supplierCompany ?? "",
        supplierBrand: item.supplierBrand ?? "",
        supplierPhone: item.supplierPhone ?? "",
        notes: item.notes ?? "",
      });
      // An item saved under a category or unit that has since been removed from
      // the custom list still needs to render in its dropdown.
      setCategories(prev => buildCategoryList(prev, [item.category]));
      setUnits(prev => buildUnitList(prev, [item.unit]));
      setLoadingItem(false);
    }).catch(() => setLoadingItem(false));
  }, [isEdit, itemId, centerId, navigate]);

  // Custom categories and units saved on the center document
  useEffect(() => {
    if (!centerId) return;
    getDoc(doc(db, "servicecenters", centerId)).then(snap => {
      const data = snap.data() as {
        customInventoryCategories?: string[];
        customInventoryUnits?: string[];
      } | undefined;
      setCategories(prev => buildCategoryList([...prev, ...(data?.customInventoryCategories ?? [])]));
      setUnits(prev => buildUnitList([...prev, ...(data?.customInventoryUnits ?? [])]));
    }).catch(() => { /* defaults are enough to keep the form usable */ });
  }, [centerId]);

  // Active suppliers for the picker. A supplier the item was saved against but
  // that has since been deactivated is added back below so the field still
  // reads correctly on edit.
  useEffect(() => {
    if (!centerId) return;
    return onSnapshot(collection(db, "servicecenters", centerId, "suppliers"), snap => {
      setSuppliers(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() } as Supplier))
          .sort((a, b) => a.companyName.localeCompare(b.companyName)),
      );
    }, () => setSuppliers([]));
  }, [centerId]);

  const supplierOptions = useMemo(
    () => suppliers.filter(s => s.isActive !== false || s.id === form.supplierId),
    [suppliers, form.supplierId],
  );

  // The linked supplier, so the brand and phone fields can offer that
  // supplier's own brands and numbers instead of guessing at one.
  const selectedSupplier = useMemo(
    () => suppliers.find(s => s.id === form.supplierId) ?? null,
    [suppliers, form.supplierId],
  );

  const purchaseValue = form.purchasePrice !== "" ? parseFloat(form.purchasePrice) : 0;

  function set<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: undefined }));
  }

  // Picking a supplier snapshots their details onto the item; clearing the
  // picker leaves whatever was typed by hand alone.
  function selectSupplier(id: string) {
    const supplier = suppliers.find(s => s.id === id);
    if (!supplier) {
      setForm(prev => ({ ...prev, supplierId: "" }));
      return;
    }
    setForm(prev => ({
      ...prev,
      supplierId: supplier.id,
      supplierName: supplier.name,
      supplierCompany: supplier.companyName,
      supplierBrand: supplierBrands(supplier)[0] ?? "",
      supplierPhone: supplierMobiles(supplier)[0] ?? "",
    }));
    setErrors(prev => ({ ...prev, supplierPhone: undefined }));
  }

  // Save a new category to the center right away so it's reusable on the next
  // item, not just on this one.
  async function handleAddCategory(trimmed: string): Promise<string | null> {
    const problem = validateCategoryName(trimmed, categories);
    if (problem) return problem;
    try {
      if (!isDefaultCategory(trimmed)) {
        await safeSetDoc(
          doc(db, "servicecenters", centerId),
          { customInventoryCategories: arrayUnion(trimmed) },
          { merge: true },
        );
      }
      setCategories(prev => buildCategoryList([...prev, trimmed]));
      set("category", trimmed);
      return null;
    } catch {
      return "Could not save the category. Please try again.";
    }
  }

  // Units work exactly the same way — a center that sells paint by the drum
  // shouldn't be stuck picking "Litres".
  async function handleAddUnit(trimmed: string): Promise<string | null> {
    const problem = validateUnitName(trimmed, units);
    if (problem) return problem;
    try {
      if (!isDefaultUnit(trimmed)) {
        await safeSetDoc(
          doc(db, "servicecenters", centerId),
          { customInventoryUnits: arrayUnion(trimmed) },
          { merge: true },
        );
      }
      setUnits(prev => buildUnitList([...prev, trimmed]));
      set("unit", trimmed);
      return null;
    } catch {
      return "Could not save the unit. Please try again.";
    }
  }

  async function validate(): Promise<boolean> {
    const e: Partial<Record<keyof FormState, string>> = {};

    if (!form.name.trim()) e.name = "Item name is required.";
    else if (form.name.trim().length > 100) e.name = "Max 100 characters.";
    else {
      // Uniqueness check (skip current item on edit)
      const q = query(
        collection(db, "servicecenters", centerId, "inventory"),
        where("name", "==", form.name.trim())
      );
      const snap = await getDocs(q);
      const conflict = snap.docs.find(d => d.id !== itemId);
      if (conflict) e.name = "An item with this name already exists.";
    }

    if (!form.category) e.category = "Category is required.";
    if (!form.unit) e.unit = "Unit is required.";

    const qty = parseFloat(form.currentQty);
    if (form.currentQty === "" || isNaN(qty)) e.currentQty = "Current quantity is required.";
    else if (qty < 0) e.currentQty = "Quantity must be ≥ 0.";

    const thresh = parseFloat(form.threshold);
    if (form.threshold === "" || isNaN(thresh)) e.threshold = "Low-stock threshold is required.";
    else if (thresh < 0) e.threshold = "Threshold must be ≥ 0.";

    for (const { key, label } of PRICE_INPUTS) {
      const raw = form[key] as string;
      if (raw === "") continue;
      const price = parseFloat(raw);
      if (isNaN(price) || price < 0) e[key] = `${label} must be a positive amount.`;
    }

    if (form.supplierPhone && !validateLKPhone(form.supplierPhone)) {
      e.supplierPhone = "Enter a valid Sri Lanka phone number (e.g. 0771234567).";
    }

    if (form.notes.trim().length > 200) e.notes = "Max 200 characters.";

    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    setGeneralError("");
    const valid = await validate();
    if (!valid) return;

    setSaving(true);
    try {
      const money = (raw: string) =>
        raw !== "" ? parseFloat(parseFloat(raw).toFixed(2)) : undefined;
      const purchase = money(form.purchasePrice);

      const payload: Partial<InventoryItem> = {
        name: form.name.trim(),
        partNumber: form.partNumber.trim() || undefined,
        category: form.category.trim(),
        unit: form.unit.trim(),
        currentQty: parseFloat(parseFloat(form.currentQty).toFixed(2)),
        threshold: parseFloat(parseFloat(form.threshold).toFixed(2)),
        purchasePrice: purchase,
        // Mirrored so readers that predate the price book (CSV export, older
        // job cards) still see a cost on the item.
        unitCost: purchase,
        distributorPrice: money(form.distributorPrice),
        outletPrice: money(form.outletPrice),
        serviceCenterPrice: money(form.serviceCenterPrice),
        markedPrice: money(form.markedPrice),
        availableToDistributors: form.availableToDistributors,
        supplierId: form.supplierId || undefined,
        supplierName: form.supplierName.trim() || undefined,
        supplierCompany: form.supplierCompany.trim() || undefined,
        supplierBrand: form.supplierBrand.trim() || undefined,
        supplierPhone: form.supplierPhone.trim() || undefined,
        notes: form.notes.trim() || undefined,
        centerId,
        updatedAt: Timestamp.now(),
      };

      // Firestore rejects undefined. On a new item the key is simply left out;
      // on an edit, a field the user cleared has to be removed from the stored
      // document, otherwise blanking a price would silently keep the old one.
      const writable: Record<string, unknown> = { ...payload };
      Object.keys(writable).forEach(k => {
        if (writable[k] === undefined) {
          if (isEdit) writable[k] = deleteField();
          else delete writable[k];
        }
      });

      if (isEdit && itemId) {
        await safeUpdateDoc(doc(db, "servicecenters", centerId, "inventory", itemId), writable);

        const original = originalItemRef.current;
        if (original && currentUser) {
          const priceFields: Array<keyof InventoryItem> = [
            "purchasePrice", "distributorPrice", "outletPrice", "serviceCenterPrice", "markedPrice",
          ];
          const priceChanges = priceFields
            .filter(f => (original[f] ?? null) !== (payload[f] ?? null))
            .map(f => ({ field: f, before: (original[f] as number) ?? null, after: (payload[f] as number) ?? null }));
          if (priceChanges.length > 0) {
            void logAuditEvent({
              centerId,
              action: "price_change",
              entityType: "inventory",
              entityId: itemId,
              entityLabel: payload.name ?? original.name,
              changes: priceChanges,
              performedBy: currentUser.uid,
              performedByName: currentUser.displayName || currentUser.email || "Unknown",
            });
          }
        }
      } else {
        const newRef = doc(collection(db, "servicecenters", centerId, "inventory"));
        await safeSetDoc(newRef, {
          ...writable,
          isArchived: false,
          restockLog: [],
          deductionLog: [],
          createdAt: Timestamp.now(),
        });
      }

      navigate("/inventory");
    } catch {
      setGeneralError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (role !== "Owner" && role !== "Manager") {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <Package className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-gray-400">Only Owners and Managers can add or edit inventory items.</p>
        </div>
      </div>
    );
  }

  if (loadingItem) {
    return (
      <LoadingScreen />
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">


      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 bg-[#F97316]/10 rounded-xl flex items-center justify-center">
            <Package className="h-5 w-5 text-[#F97316]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">{isEdit ? t("inventory.editItem") : t("inventory.addItem")}</h1>
            <p className="text-sm text-gray-500">
              {isEdit ? "Update stock item details" : "Add a new consumable to inventory"}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-6">
          {/* Basic Info */}
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-6 space-y-5">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Item Details</h2>

            <Field label="Item Name" required error={errors.name}>
              <input
                type="text"
                value={form.name}
                onChange={e => set("name", e.target.value)}
                placeholder="e.g. Castrol GTX 5W-30 1L"
                maxLength={100}
                className={inputClass}
              />
              <p className="text-xs text-gray-600 mt-1">{form.name.length}/100 characters</p>
            </Field>

            <Field label="Part / Serial Number" error={errors.partNumber}>
              <input
                type="text"
                value={form.partNumber}
                onChange={e => set("partNumber", e.target.value)}
                placeholder="e.g. off a supplier's price list"
                maxLength={100}
                className={inputClass}
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Field label="Category" required error={errors.category}>
                <OptionSelect
                  value={form.category}
                  options={categories}
                  selectLabel="Select category…"
                  addLabel="Add custom category"
                  newPlaceholder="e.g. Body Shop"
                  maxLength={MAX_CATEGORY_LENGTH}
                  onSelect={v => set("category", v)}
                  onAdd={handleAddCategory}
                />
              </Field>

              <Field label="Unit" required error={errors.unit}>
                <OptionSelect
                  value={form.unit}
                  options={units}
                  selectLabel="Select unit…"
                  addLabel="Add custom unit"
                  newPlaceholder="e.g. Drums"
                  maxLength={MAX_UNIT_LENGTH}
                  onSelect={v => set("unit", v)}
                  onAdd={handleAddUnit}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Field label="Current Quantity" required error={errors.currentQty}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.currentQty}
                  onChange={e => set("currentQty", e.target.value)}
                  placeholder="0.00"
                  className={inputClass}
                />
              </Field>

              <Field label="Low-Stock Threshold" required error={errors.threshold}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.threshold}
                  onChange={e => set("threshold", e.target.value)}
                  placeholder="0.00"
                  className={inputClass}
                />
                <p className="text-xs text-gray-600 mt-1">Alert triggers when qty falls to or below this.</p>
              </Field>
            </div>

          </div>

          {/* Price book */}
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-6 space-y-5">
            <div>
              <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Price Book</h2>
              <p className="text-xs text-gray-600 mt-1">
                What this item costs, and what it sells for to each buyer. Blank prices fall back to the purchase
                price, so the item is never billed at zero.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {PRICE_INPUTS.map(({ key, label, hint, audience }) => {
                const raw = form[key] as string;
                const margin = audience === "purchase"
                  ? null
                  : marginPercent(purchaseValue, raw !== "" ? parseFloat(raw) : 0);
                return (
                  <Field
                    key={key}
                    label={`${label} (LKR)`}
                    required={audience === "purchase"}
                    error={errors[key]}
                  >
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={raw}
                      onChange={e => set(key, e.target.value as FormState[typeof key])}
                      placeholder="0.00"
                      className={inputClass}
                    />
                    <p className="text-xs text-gray-600 mt-1">
                      {hint}
                      {margin != null && (
                        <span className={margin < 0 ? "text-red-400 ml-1" : "text-gray-500 ml-1"}>
                          {margin >= 0 ? "+" : ""}{margin}% on cost.
                        </span>
                      )}
                    </p>
                  </Field>
                );
              })}
            </div>

            <label className="flex items-start gap-3 cursor-pointer border-t border-white/5 pt-5">
              <input
                type="checkbox"
                checked={form.availableToDistributors}
                onChange={e => set("availableToDistributors", e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-white/20 bg-[#0B1120] accent-[#F97316]"
              />
              <span>
                <span className="block text-sm font-medium text-gray-300">Offer this item to distributors</span>
                <span className="block text-xs text-gray-600 mt-0.5">
                  Shows the item in the shared distributor catalog, priced at the distributor price, with the
                  marked price alongside it.
                </span>
              </span>
            </label>
          </div>

          {/* Supplier */}
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-6 space-y-5">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Supplier Info</h2>

            {supplierOptions.length > 0 && (
              <Field label="Supplier">
                <select
                  value={form.supplierId}
                  onChange={e => selectSupplier(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Not linked to a saved supplier…</option>
                  {supplierOptions.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.companyName} — {supplierBrandLabel(s)} ({s.name})
                      {s.isActive === false ? " · inactive" : ""}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-600 mt-1">
                  Picking a supplier fills the fields below. Manage the list under Suppliers.
                </p>
              </Field>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Field label="Supplier Name" error={errors.supplierName}>
                <input
                  type="text"
                  value={form.supplierName}
                  onChange={e => set("supplierName", e.target.value)}
                  placeholder="e.g. Nuwan Perera"
                  className={inputClass}
                />
              </Field>

              <Field label="Company" error={errors.supplierCompany}>
                <input
                  type="text"
                  value={form.supplierCompany}
                  onChange={e => set("supplierCompany", e.target.value)}
                  placeholder="e.g. Kandy Auto Parts"
                  className={inputClass}
                />
              </Field>

              <Field label="Brand" error={errors.supplierBrand}>
                {/* A supplier carries several brands, so the picked one's list
                    is offered rather than assumed — still free text for a
                    brand that isn't on their record yet. */}
                <input
                  type="text"
                  list="supplier-brand-options"
                  value={form.supplierBrand}
                  onChange={e => set("supplierBrand", e.target.value)}
                  placeholder="e.g. Castrol"
                  className={inputClass}
                />
                <datalist id="supplier-brand-options">
                  {supplierBrands(selectedSupplier).map(b => <option key={b} value={b} />)}
                </datalist>
                {supplierBrands(selectedSupplier).length > 1 && (
                  <p className="text-xs text-gray-600 mt-1">
                    {form.supplierCompany || "This supplier"} carries {supplierBrands(selectedSupplier).join(", ")}.
                  </p>
                )}
              </Field>

              <Field label="Supplier Mobile" error={errors.supplierPhone}>
                <input
                  type="tel"
                  list="supplier-mobile-options"
                  value={form.supplierPhone}
                  onChange={e => set("supplierPhone", e.target.value)}
                  placeholder="e.g. 0771234567"
                  className={inputClass}
                />
                <datalist id="supplier-mobile-options">
                  {supplierMobiles(selectedSupplier).map(m => <option key={m} value={m} />)}
                </datalist>
                <p className="text-xs text-gray-600 mt-1">Sri Lanka format. Tap-to-call on mobile.</p>
              </Field>
            </div>
          </div>

          {/* Notes */}
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-6 space-y-5">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Notes</h2>
            <Field label="Notes" error={errors.notes}>
              <textarea
                value={form.notes}
                onChange={e => set("notes", e.target.value)}
                rows={3}
                maxLength={200}
                placeholder="Any additional notes about this item…"
                className={`${inputClass} resize-none`}
              />
              <p className="text-xs text-gray-600 mt-1">{form.notes.length}/200 characters</p>
            </Field>
          </div>

          {generalError && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
              <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-400">{generalError}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pb-8">
            <button
              type="button"
              onClick={() => navigate("/inventory")}
              className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-3 px-4 rounded-xl transition text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-60 text-white font-semibold py-3 px-4 rounded-xl transition text-sm flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Saving…
                </>
              ) : isEdit ? "Save Changes" : t("inventory.addItem")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
