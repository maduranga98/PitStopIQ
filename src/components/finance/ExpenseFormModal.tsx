import { useEffect, useState } from "react";
import { AlertTriangle, Calendar, Loader2, X } from "lucide-react";
import {
  addExpense, EXPENSE_PAYMENT_METHODS, loadCustomCategories, mergeCategories,
  saveCustomCategory,
} from "../../lib/expenses";
import { useAuth } from "../../contexts/AuthContext";

// The one place an expense is recorded, wherever it is recorded from — the
// accounting page and the outgoings report both open this. Categories are
// loaded here so neither caller has to carry them.

const NEW_CATEGORY = "__new__";

/** "2026-08-14" for a Date, in local time — what <input type="date"> wants. */
function toDateInputValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Midday local, so a date never slips a day across a timezone boundary. */
function fromDateInputValue(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
}

const inputClass =
  "w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]";
const selectClass =
  "w-full bg-[#0B1120] border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]";

export default function ExpenseFormModal({
  centerId, usedCategories = [], defaultDate, onClose, onSaved,
}: {
  centerId: string;
  /** Categories already present on the caller's loaded records. */
  usedCategories?: string[];
  /** Pre-fill the date — the report passes the range it is showing. */
  defaultDate?: Date;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { currentUser } = useAuth();
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [date, setDate] = useState(() => toDateInputValue(defaultDate ?? new Date()));
  const [category, setCategory] = useState("Other");
  const [newCategory, setNewCategory] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [vendor, setVendor] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>("Cash");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    loadCustomCategories(centerId)
      .then((c) => { if (active) setCustomCategories(c); })
      .catch(() => { /* defaults are enough to record an expense */ });
    return () => { active = false; };
  }, [centerId]);

  const categories = mergeCategories(customCategories, usedCategories);

  async function handleSave() {
    setError("");
    const amt = Number(amount);
    const when = fromDateInputValue(date);
    if (!when) { setError("Pick a valid date."); return; }
    if (!description.trim()) { setError("Description is required."); return; }
    if (!amt || amt <= 0) { setError("Enter an amount greater than zero."); return; }

    let finalCategory = category;
    if (category === NEW_CATEGORY) {
      finalCategory = newCategory.trim();
      if (!finalCategory) { setError("Enter a name for the new category."); return; }
    }

    setSaving(true);
    try {
      if (category === NEW_CATEGORY) await saveCustomCategory(centerId, finalCategory);
      await addExpense(centerId, {
        date: when,
        category: finalCategory,
        description: description.trim(),
        amount: amt,
        vendor: vendor.trim(),
        paymentMethod,
        notes: notes.trim() || undefined,
        recordedBy: currentUser?.uid,
        recordedByName: currentUser?.displayName || currentUser?.email || undefined,
      });
      onSaved?.();
      onClose();
    } catch {
      setError("Couldn't save the expense. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">Record Expense</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg px-3 py-2 text-xs">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />{error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={`${inputClass} pl-9`}
              />
            </div>
          </Field>
          <Field label="Amount (LKR)">
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Category">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={selectClass}
          >
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value={NEW_CATEGORY}>+ Add new category…</option>
          </select>
          {category === NEW_CATEGORY && (
            <input
              type="text"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="New category name"
              autoFocus
              className={`mt-2 ${inputClass}`}
            />
          )}
        </Field>

        <Field label="Description">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Office rent — November"
            className={inputClass}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Vendor (optional)">
            <input
              type="text"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="Vendor name"
              className={inputClass}
            />
          </Field>
          <Field label="Payment Method">
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className={selectClass}
            >
              {EXPENSE_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Notes (optional)">
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={inputClass}
          />
        </Field>

        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white py-2.5 rounded-lg text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? "Saving…" : "Save Expense"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-gray-400 block mb-1">{label}</label>
      {children}
    </div>
  );
}
