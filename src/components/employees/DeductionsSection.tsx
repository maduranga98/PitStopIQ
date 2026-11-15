import { useEffect, useMemo, useState } from "react";
import {
  collection, doc, limit, orderBy, query, Timestamp, where,
} from "firebase/firestore";
import { watchQuery } from "../../lib/listeners";
import { safeAddDoc, safeDeleteDoc } from "../../lib/firestoreWrite";
import { HandCoins, Plus, Trash2, Loader2, X, ChevronLeft, ChevronRight, Check } from "lucide-react";
import { dayKey, recordDailyPayment, saveDailyPaySetup } from "../../lib/dailyPay";
import { db } from "../../config/firebase";
import type {
  AuthUser, StaffDeduction, StaffDeductionType, StaffMember,
} from "../../types/auth";

const TYPE_LABEL: Record<StaffDeductionType, string> = {
  daily: "Daily Payment",
  advance: "Advance Payment",
  loan: "Loan Repayment",
  fine: "Fine / Penalty",
  other: "Other",
};

const TYPE_BADGE: Record<StaffDeductionType, string> = {
  daily:   "bg-green-500/15 text-green-300 border border-green-500/25",
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

/** "2026-08" for a Date — the `month` key every entry is stored under. */
function toMonthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(key: string, by: number): string {
  const [y, m] = key.split("-").map(Number);
  return toMonthKey(new Date(y, m - 1 + by, 1));
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-LK", { month: "long", year: "numeric" });
}

type Filter = "all" | "daily" | "advance" | "owed";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "daily", label: "Daily payments" },
  { id: "advance", label: "Advances" },
  { id: "owed", label: "Loans & fines" },
];

function matchesFilter(d: StaffDeduction, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "owed") return d.type !== "daily" && d.type !== "advance";
  return d.type === filter;
}

const lkr = (n: number) => `LKR ${n.toLocaleString()}`;

function fmtDate(ts: Timestamp): string {
  return ts.toDate().toLocaleDateString("en-LK", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Everything paid to, or owed back by, one employee outside the payslip itself:
 * wages handed over day by day, advances taken ahead of payday, loan
 * repayments and fines. Each entry carries the date the money changed hands —
 * chosen by whoever records it, since it is often entered days later — and the
 * payslip for that month picks it up automatically.
 *
 * Shown a month at a time, with the totals for that month, so "how much has
 * this person been paid so far, and on which days" is one glance.
 */
export default function DeductionsSection({
  centerId, staff, currentUser, canManage,
}: {
  centerId: string;
  staff: StaffMember;
  currentUser: AuthUser | null;
  canManage: boolean;
}) {
  // The latest entries across all months — only for the "not yet on a payslip"
  // figure, which has to include anything carried over from earlier months.
  const [deductions, setDeductions] = useState<StaffDeduction[]>([]);
  const [month, setMonth] = useState(() => toMonthKey(new Date()));
  const [filter, setFilter] = useState<Filter>("all");
  // The month on screen, tagged with the month it was loaded for so a stale
  // list is never shown under another month's heading.
  const [monthData, setMonthData] = useState<{ key: string; entries: StaffDeduction[] } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<StaffDeduction | null>(null);

  useEffect(() => {
    if (!centerId || !staff.id) return;
    return watchQuery(
      // Newest-first deduction history for one staff member; the recent slice is
      // what the section shows, so it does not need the full run of employment.
      query(
        collection(db, "servicecenters", centerId, "staff", staff.id, "deductions"),
        orderBy("deductionDate", "desc"),
        limit(100),
      ),
      (snap) => setDeductions(snap.docs.map((d) => ({ id: d.id, ...d.data() } as StaffDeduction))),
      { label: "DeductionsSection:deductions" },
    );
  }, [centerId, staff.id]);

  // Every entry of the selected month. A single-field equality query, so it
  // needs no composite index; the handful of rows are sorted here.
  useEffect(() => {
    if (!centerId || !staff.id) return;
    return watchQuery(
      query(
        collection(db, "servicecenters", centerId, "staff", staff.id, "deductions"),
        where("month", "==", month),
      ),
      (snap) => setMonthData({
        key: month,
        entries: snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as StaffDeduction))
          .sort((a, b) => (b.deductionDate?.toMillis?.() ?? 0) - (a.deductionDate?.toMillis?.() ?? 0)),
      }),
      { label: "DeductionsSection:month", onError: () => setMonthData({ key: month, entries: [] }) },
    );
  }, [centerId, staff.id, month]);

  const loading = monthData?.key !== month;
  const monthEntries = useMemo(
    () => (monthData?.key === month ? monthData.entries : []),
    [monthData, month],
  );
  const visible = useMemo(() => monthEntries.filter((d) => matchesFilter(d, filter)), [monthEntries, filter]);

  const totals = useMemo(() => {
    const sum = (list: StaffDeduction[]) => list.reduce((s, d) => s + (d.amount || 0), 0);
    const daily = monthEntries.filter((d) => d.type === "daily");
    const advance = monthEntries.filter((d) => d.type === "advance");
    const owed = monthEntries.filter((d) => d.type !== "daily" && d.type !== "advance");
    return {
      daily: sum(daily), dailyCount: daily.length,
      advance: sum(advance), advanceCount: advance.length,
      owed: sum(owed), owedCount: owed.length,
    };
  }, [monthEntries]);
  const visibleTotal = visible.reduce((s, d) => s + (d.amount || 0), 0);
  // New entries default to whatever this person was last given — someone paid
  // by the day gets "Daily Payment" preselected every time.
  const lastType: StaffDeductionType = deductions[0]?.type ?? "advance";

  // ── Daily pay setup ────────────────────────────────────────────────────────
  // Kept in local state as well as on the staff record: the profile page reads
  // the employee once, so the saved values would not come back as a new prop.
  const [dailyOn, setDailyOn] = useState(staff.dailyPay?.enabled === true);
  const [dailyAmount, setDailyAmount] = useState(String(staff.dailyPay?.amount || ""));
  const [savedSetup, setSavedSetup] = useState({
    enabled: staff.dailyPay?.enabled === true, amount: staff.dailyPay?.amount ?? 0,
  });
  const [setupBusy, setSetupBusy] = useState(false);
  const [marking, setMarking] = useState(false);
  const [dailyError, setDailyError] = useState("");
  const setupDirty = dailyOn !== savedSetup.enabled || (Number(dailyAmount) || 0) !== savedSetup.amount;

  const today = dayKey(new Date());
  const paidToday = useMemo(
    () => deductions
      .filter((d) => d.type === "daily" && d.deductionDate && dayKey(d.deductionDate.toDate()) === today)
      .reduce((sum, d) => sum + (d.amount || 0), 0),
    [deductions, today],
  );

  async function saveSetup() {
    const setup = { enabled: dailyOn, amount: Number(dailyAmount) || 0 };
    setSetupBusy(true);
    setDailyError("");
    try {
      await saveDailyPaySetup(centerId, staff.id, setup);
      setSavedSetup(setup);
    } catch {
      setDailyError("Couldn't save the daily pay setup. Try again.");
    } finally {
      setSetupBusy(false);
    }
  }

  async function markTodayPaid() {
    setMarking(true);
    setDailyError("");
    try {
      await recordDailyPayment(centerId, staff, savedSetup.amount, today, currentUser);
    } catch {
      setDailyError("Couldn't record today's payment. Try again.");
    } finally {
      setMarking(false);
    }
  }

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
            <HandCoins className="h-4 w-4 text-[#F97316]" /> Daily Payments, Advances &amp; Deductions
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {outstanding > 0
              ? `${lkr(outstanding)} not yet taken off a payslip.`
              : "Daily payments, advances and other deductions come off the payslip for the month they're dated."}
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 text-xs font-medium bg-[#F97316] hover:bg-orange-600 text-white px-3 py-1.5 rounded-lg transition"
          >
            <Plus className="h-3.5 w-3.5" />
            Record Payment
          </button>
        )}
      </div>

      {/* Daily pay: set up once by the Owner/Manager, then marked day by day. */}
      {canManage && (
        <div className="bg-[#0B1120] border border-white/5 rounded-xl p-4 mb-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={dailyOn}
                onChange={(e) => setDailyOn(e.target.checked)}
                className="h-4 w-4 accent-[#F97316]"
              />
              <span>
                <span className="block text-sm text-white">Paid daily</span>
                <span className="block text-[11px] text-gray-500">
                  Switch on for someone who takes their pay each day. You mark every day you pay them.
                </span>
              </span>
            </label>
            {dailyOn && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Usual amount (LKR)</span>
                <input
                  type="number"
                  min={0}
                  value={dailyAmount}
                  onChange={(e) => setDailyAmount(e.target.value)}
                  placeholder="e.g. 2500"
                  className="w-28 bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-sm text-white text-right focus:outline-none focus:border-orange-500"
                />
              </div>
            )}
          </div>
          {(setupDirty || savedSetup.enabled) && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-xs text-gray-500">
                {savedSetup.enabled && !setupDirty
                  ? paidToday > 0
                    ? `Paid today: ${lkr(paidToday)}`
                    : "Not paid yet today."
                  : "Save to apply the change."}
              </span>
              {setupDirty ? (
                <button
                  onClick={saveSetup}
                  disabled={setupBusy || (dailyOn && !(Number(dailyAmount) > 0))}
                  className="flex items-center gap-1.5 text-xs font-medium bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition"
                >
                  {setupBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Save setup
                </button>
              ) : (
                <button
                  onClick={markTodayPaid}
                  disabled={marking || !(savedSetup.amount > 0)}
                  className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition disabled:opacity-50 ${
                    paidToday > 0
                      ? "bg-green-500/15 text-green-300 border border-green-500/25 hover:bg-green-500/25"
                      : "bg-[#F97316] hover:bg-orange-600 text-white"
                  }`}
                >
                  {marking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : paidToday > 0 ? <Check className="h-3.5 w-3.5" /> : null}
                  {paidToday > 0 ? `Pay another ${lkr(savedSetup.amount)} today` : `Mark today paid · ${lkr(savedSetup.amount)}`}
                </button>
              )}
            </div>
          )}
          {dailyError && <p className="text-xs text-red-400">{dailyError}</p>}
        </div>
      )}

      {/* Month being looked at, and what was paid out in it. */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5"
            title="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <input
            type="month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="bg-[#0B1120] border border-white/10 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-[#F97316]/60 [color-scheme:dark]"
          />
          <button
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5"
            title="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                filter === f.id ? "bg-[#F97316] text-white" : "bg-white/5 text-gray-400 hover:text-white"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Tile label="Daily payments" value={lkr(totals.daily)} hint={`${totals.dailyCount} day${totals.dailyCount === 1 ? "" : "s"} paid`} />
        <Tile label="Advances" value={lkr(totals.advance)} hint={`${totals.advanceCount} taken`} />
        <Tile label="Loans & fines" value={lkr(totals.owed)} hint={`${totals.owedCount} recorded`} />
        <Tile label="Total paid out" value={lkr(totals.daily + totals.advance)} hint={monthLabel(month)} strong />
      </div>

      {loading ? (
        <p className="text-sm text-gray-500 py-6 text-center">Loading…</p>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center py-8 gap-2">
          <HandCoins className="h-8 w-8 text-gray-600" />
          <p className="text-sm text-gray-500">
            {monthEntries.length === 0
              ? `Nothing recorded for ${monthLabel(month)}.`
              : "Nothing of this kind recorded this month."}
          </p>
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
              {visible.map((d) => (
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
            <tfoot>
              <tr>
                <td colSpan={3} className="pt-3 pr-4 text-xs text-gray-500">
                  {visible.length} entr{visible.length === 1 ? "y" : "ies"} · {monthLabel(month)}
                </td>
                <td className="pt-3 pr-4 text-right font-semibold text-white whitespace-nowrap">{lkr(visibleTotal)}</td>
                <td colSpan={canManage ? 2 : 1} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {showForm && (
        <DeductionForm
          centerId={centerId}
          staff={staff}
          currentUser={currentUser}
          initialType={lastType}
          onClose={() => setShowForm(false)}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmDelete(null)} />
          <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="text-lg font-semibold text-white mb-2">Delete Entry?</h3>
            <p className="text-sm text-gray-400 mb-5">
              LKR {(confirmDelete.amount || 0).toLocaleString()} recorded by {confirmDelete.recordedByName || "—"} will be removed.
              {confirmDelete.appliedPayslipId && " It has already been taken off a payslip — that payslip is not changed."}
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

function Tile({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl px-3 py-2.5 border ${strong ? "bg-[#F97316]/10 border-[#F97316]/25" : "bg-[#0B1120] border-white/5"}`}>
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className="text-sm font-bold text-white mt-0.5">{value}</p>
      {hint && <p className="text-[10px] text-gray-600 mt-0.5 truncate">{hint}</p>}
    </div>
  );
}

function DeductionForm({
  centerId, staff, currentUser, initialType, onClose,
}: {
  centerId: string;
  staff: StaffMember;
  currentUser: AuthUser | null;
  initialType: StaffDeductionType;
  onClose: () => void;
}) {
  const [type, setType] = useState<StaffDeductionType>(initialType);
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
    if (!when) { setError("Pick a valid date."); return; }
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
      setError("Couldn't save the entry. Try again.");
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
            <h3 className="text-base font-semibold text-white">Record Payment / Deduction</h3>
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
            <label className="text-xs text-gray-400">
              {type === "daily" || type === "advance" ? "Date Paid" : "Deduction Date"}
            </label>
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
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
