import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  doc, getDoc, setDoc, updateDoc, collection, query, where,
  getDocs, Timestamp,
} from "firebase/firestore";
import { Package, AlertTriangle } from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type { InventoryItem } from "../../types/auth";
import { useTranslation } from "react-i18next";

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = ["Lubricants", "Filters", "Brake Parts", "Tyres", "Electrical", "Consumables", "Other"] as const;
const UNITS = ["Litres", "Pieces", "Kits", "Sets", "Metres", "Pairs", "Packets"] as const;

// LK phone: 07XXXXXXXX or +94XXXXXXXXX
function validateLKPhone(phone: string): boolean {
  if (!phone) return true;
  return /^(\+94|0)\d{9}$/.test(phone.replace(/\s/g, ""));
}

// ── Form ──────────────────────────────────────────────────────────────────────

interface FormState {
  name: string;
  category: string;
  unit: string;
  currentQty: string;
  threshold: string;
  unitCost: string;
  supplierName: string;
  supplierPhone: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  category: "",
  unit: "",
  currentQty: "",
  threshold: "",
  unitCost: "",
  supplierName: "",
  supplierPhone: "",
  notes: "",
};

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

  // Load existing item for edit
  useEffect(() => {
    if (!isEdit || !itemId || !centerId) return;
    getDoc(doc(db, "servicecenters", centerId, "inventory", itemId)).then(snap => {
      if (!snap.exists()) { navigate("/inventory"); return; }
      const item = snap.data() as InventoryItem;
      setForm({
        name: item.name,
        category: item.category,
        unit: item.unit,
        currentQty: String(item.currentQty),
        threshold: String(item.threshold),
        unitCost: item.unitCost != null ? String(item.unitCost) : "",
        supplierName: item.supplierName ?? "",
        supplierPhone: item.supplierPhone ?? "",
        notes: item.notes ?? "",
      });
      setLoadingItem(false);
    }).catch(() => setLoadingItem(false));
  }, [isEdit, itemId, centerId, navigate]);

  function set(field: keyof FormState, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: undefined }));
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

    if (form.unitCost !== "") {
      const cost = parseFloat(form.unitCost);
      if (isNaN(cost) || cost < 0) e.unitCost = "Enter a valid positive amount.";
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
      const payload: Partial<InventoryItem> = {
        name: form.name.trim(),
        category: form.category as InventoryItem["category"],
        unit: form.unit as InventoryItem["unit"],
        currentQty: parseFloat(parseFloat(form.currentQty).toFixed(2)),
        threshold: parseFloat(parseFloat(form.threshold).toFixed(2)),
        unitCost: form.unitCost !== "" ? parseFloat(parseFloat(form.unitCost).toFixed(2)) : undefined,
        supplierName: form.supplierName.trim() || undefined,
        supplierPhone: form.supplierPhone.trim() || undefined,
        notes: form.notes.trim() || undefined,
        centerId,
        updatedAt: Timestamp.now(),
      };

      // Remove undefined keys
      Object.keys(payload).forEach(k => {
        if ((payload as Record<string, unknown>)[k] === undefined) {
          delete (payload as Record<string, unknown>)[k];
        }
      });

      if (isEdit && itemId) {
        await updateDoc(doc(db, "servicecenters", centerId, "inventory", itemId), payload);
      } else {
        const newRef = doc(collection(db, "servicecenters", centerId, "inventory"));
        await setDoc(newRef, {
          ...payload,
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
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <svg className="animate-spin h-8 w-8 text-[#F97316]" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Field label="Category" required error={errors.category}>
                <select
                  value={form.category}
                  onChange={e => set("category", e.target.value)}
                  className={selectClass}
                >
                  <option value="">Select category…</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>

              <Field label="Unit" required error={errors.unit}>
                <select
                  value={form.unit}
                  onChange={e => set("unit", e.target.value)}
                  className={selectClass}
                >
                  <option value="">Select unit…</option>
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
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

            <Field label="Unit Cost (LKR)" error={errors.unitCost}>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.unitCost}
                onChange={e => set("unitCost", e.target.value)}
                placeholder="0.00"
                className={inputClass}
              />
              <p className="text-xs text-gray-600 mt-1">Used for cost tracking in invoices and analytics.</p>
            </Field>
          </div>

          {/* Supplier */}
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-6 space-y-5">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Supplier Info</h2>

            <Field label="Supplier Name" error={errors.supplierName}>
              <input
                type="text"
                value={form.supplierName}
                onChange={e => set("supplierName", e.target.value)}
                placeholder="e.g. Kandy Auto Parts"
                className={inputClass}
              />
            </Field>

            <Field label="Supplier Phone" error={errors.supplierPhone}>
              <input
                type="tel"
                value={form.supplierPhone}
                onChange={e => set("supplierPhone", e.target.value)}
                placeholder="e.g. 0771234567"
                className={inputClass}
              />
              <p className="text-xs text-gray-600 mt-1">Sri Lanka format. Tap-to-call on mobile.</p>
            </Field>
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
