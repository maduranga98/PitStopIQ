import { useEffect, useMemo, useState } from "react";
import {
  collection, doc, onSnapshot, orderBy, query, Timestamp,
} from "firebase/firestore";
import { safeAddDoc, safeDeleteDoc } from "../../lib/firestoreWrite";
import { HandCoins, Plus, Trash2, Loader2, X } from "lucide-react";
import { db } from "../../config/firebase";
import type {
  AuthUser, StaffDeduction, StaffDeductionType, StaffMember,
} from "../../types/auth";

const TYPE_LABEL: Record<StaffDeductionType, string> = {
  advance: "Advance Payment",
  loan: "Loan Repayment",
  fine: "Fine / Penalty",
  other: "Other",
};

const TYPE_BADGE: Record<StaffDeductionType, string> = {
  advance: "bg-amber-500/15 text-amber-300 border border-amber-500/25",
  loan:    "bg-blue-500/15 text-blue-300 border border-blue-500/25",
  fine:    "bg-red-500/15 text-red-300 border border-red-500/25",
  other:   "bg-gray-500/15 text-gray-300 border border-gray-500/25",
};

/** "2026-08-14" for a Date, in local time — the value an <input type="date"> wants. */
function toDateInputValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Midday local time, so a date never slips a day across a timezone boundary. */
function fromDateInputValue(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
}

function fmtDate(ts: Timestamp): string {
  return ts.toDate().toLocaleDateString("en-LK", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Advances, loan repayments and fines recorded against one employee. Each
 * entry carries the date it applies to — chosen by whoever records it, since
 * an advance is often handed over days before it gets entered — and the
 * payslip for that month picks it up automatically.
 */
export default function DeductionsSection({
  centerId, staff, currentUser, canManage,
}: {
  centerId: string;
  staff: StaffMember;
  currentUser: AuthUser | null;
  canManage: boolean;
}) {
  const [deductions, setDeductions] = useState<StaffDeduction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<StaffDeduction | null>(null);

  useEffect(() => {
    if (!centerId || !staff.id) return;
    return onSnapshot(
      query(
        collection(db, "servicecenters", centerId, "staff", staff.id, "deductions"),
        orderBy("deductionDate", "desc"),
      ),
      (snap) => {
        setDeductions(snap.docs.map((d) => ({ id: d.id, ...d.data() } as StaffDeduction)));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [centerId, staff.id]);

  const outstanding = useMemo(
    () => deductions.filter((d) => !d.appliedPayslipId).reduce((sum, d) => sum + (d.amount || 0), 0),
    [deductions],
  );

  async function handleDelete(entry: StaffDeduction) {
    await safeDeleteDoc(doc(db, "servicecenters", centerId, "staff", staff.id, "deductions", entry.id));
    setConfirmDelete(null);
  }

  return (
    <div className="bg-[#162032] border border-white/10 rounded-2xl p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
        <div>
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <HandCoins className="h-4 w-4 text-[#F97316]" /> Deductions &amp; Advances
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {outstanding > 0
              ? `LKR ${outstanding.toLocaleString()} not yet taken off a payslip.`
              : "Advances and other deductions are applied to the payslip for the month they're dated."}
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 text-xs font-medium bg-[#F97316] hover:bg-orange-600 text-white px-3 py-1.5 rounded-lg transition"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Deduction
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-gray-500 py-6 text-center">Loading…</p>
      ) : deductions.length === 0 ? (
        <div className="flex flex-col items-center py-8 gap-2">
          <HandCoins className="h-8 w-8 text-gray-600" />
          <p className="text-sm text-gray-500">No deductions recorded.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="border-b border-white/10 text-left">
                <th className="pb-3 text-xs font-medium text-gray-500 pr-4">Date</th>
                <th className="pb-3 text-xs font-medium text-gray-500 pr-4">Type</th>
                <th className="pb-3 text-xs font-medium text-gray-500 pr-4">Details</th>
                <th className="pb-3 text-xs font-medium text-gray-500 pr-4 text-right">Amount</th>
                <th className="pb-3 text-xs font-medium text-gray-500 pr-4">Recorded By</th>
                {canManage && <th className="pb-3" />}
              </tr>
            </thead>
            <tbody>
              {deductions.map((d) => (
                <tr key={d.id} className="border-b border-white/5">
                  <td className="py-3 pr-4 text-gray-400 whitespace-nowrap">{d.deductionDate ? fmtDate(d.deductionDate) : "—"}</td>
                  <td className="py-3 pr-4">
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${TYPE_BADGE[d.type] ?? TYPE_BADGE.other}`}>
                      {TYPE_LABEL[d.type] ?? "Other"}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-gray-300">
                    <div>{d.label || "—"}</div>
                    {d.notes && <div className="text-xs text-gray-500 mt-0.5">{d.notes}</div>}
                    {d.appliedPayslipId && (
                      <div className="text-[11px] text-green-400 mt-0.5">Applied to a payslip</div>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-right font-medium text-white whitespace-nowrap">
                    LKR {(d.amount || 0).toLocaleString()}
                  </td>
                  <td className="py-3 pr-4 text-gray-400 whitespace-nowrap">
                    <div>{d.recordedByName || "—"}</div>
                    {d.createdAt && <div className="text-[11px] text-gray-600">{fmtDate(d.createdAt)}</div>}
                  </td>
                  {canManage && (
                    <td className="py-3 text-right">
                      <button
                        onClick={() => setConfirmDelete(d)}
                        className="text-gray-500 hover:text-red-400 p-1.5"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <DeductionForm
          centerId={centerId}
          staff={staff}
          currentUser={currentUser}
          onClose={() => setShowForm(false)}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmDelete(null)} />
          <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="text-lg font-semibold text-white mb-2">Delete Deduction?</h3>
            <p className="text-sm text-gray-400 mb-5">
              LKR {(confirmDelete.amount || 0).toLocaleString()} recorded by {confirmDelete.recordedByName || "—"} will be removed.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 rounded-lg transition text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white font-semibold py-2.5 rounded-lg transition text-sm"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DeductionForm({
  centerId, staff, currentUser, onClose,
}: {
  centerId: string;
  staff: StaffMember;
  currentUser: AuthUser | null;
  onClose: () => void;
}) {
  const [type, setType] = useState<StaffDeductionType>("advance");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => toDateInputValue(new Date()));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const recorderName = currentUser?.displayName || currentUser?.email || "Staff";

  async function handleSave() {
    const value = Number(amount);
    if (!value || value <= 0) { setError("Enter an amount greater than zero."); return; }
    const when = fromDateInputValue(date);
    if (!when) { setError("Pick a valid deduction date."); return; }
    setError("");
    setSaving(true);
    try {
      await safeAddDoc(
        collection(db, "servicecenters", centerId, "staff", staff.id, "deductions"),
        {
          staffId: staff.id,
          staffName: staff.fullName,
          type,
          label: label.trim() || TYPE_LABEL[type],
          amount: value,
          deductionDate: Timestamp.fromDate(when),
          month: `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}`,
          notes: notes.trim() || null,
          centerId,
          // Taken from the signed-in user, never typed: an advance always
          // carries the name of whoever recorded it.
          recordedBy: currentUser?.uid ?? "",
          recordedByName: recorderName,
          recordedByRole: currentUser?.role ?? null,
          createdAt: Timestamp.now(),
        },
      );
      onClose();
    } catch {
      setError("Couldn't save the deduction. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const inputClass = "mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-white">Record Deduction</h3>
            <p className="text-xs text-gray-500 mt-0.5">{staff.fullName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-gray-400">Type</label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {(Object.keys(TYPE_LABEL) as StaffDeductionType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    type === t ? "bg-[#F97316] text-white" : "bg-white/5 text-gray-400 hover:text-white"
                  }`}
                >
                  {TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-400">Amount (LKR)</label>
            <input
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 5000"
              className={inputClass}
            />
          </div>

          <div>
            <label className="text-xs text-gray-400">Deduction Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={inputClass}
            />
            <p className="text-[11px] text-gray-600 mt-1">
              Set it to the day the money actually changed hands — the payslip for that month picks it up.
            </p>
          </div>

          <div>
            <label className="text-xs text-gray-400">Description (optional)</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={TYPE_LABEL[type]}
              className={inputClass}
            />
          </div>

          <div>
            <label className="text-xs text-gray-400">Notes (optional)</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={inputClass}
            />
          </div>

          <p className="text-[11px] text-gray-600">
            Recorded by <span className="text-gray-400">{recorderName}</span>, saved with this entry automatically.
          </p>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 rounded-lg transition text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 bg-[#F97316] hover:bg-orange-600 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition text-sm flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Save Deduction
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
