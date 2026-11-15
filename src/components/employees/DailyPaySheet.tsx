import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, HandCoins, Loader2, X } from "lucide-react";
import { dayKey, fetchDailyPaymentsOn, isDailyPaid, recordDailyPayment } from "../../lib/dailyPay";
import type { AuthUser, StaffMember } from "../../types/auth";

/**
 * The day's pay round: everyone set up as daily-paid, with what they have
 * already been given on the chosen day and a button to mark the rest. Opened
 * from the Employees page so the owner can do the whole crew in one place.
 */
export default function DailyPaySheet({
  centerId, staff, currentUser, onClose,
}: {
  centerId: string;
  staff: StaffMember[];
  currentUser: AuthUser | null;
  onClose: () => void;
}) {
  const dailyStaff = useMemo(
    () => staff.filter((s) => s.active !== false && isDailyPaid(s)),
    [staff],
  );
  const [day, setDay] = useState(() => dayKey(new Date()));
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  // Paid totals for the day on screen, tagged with that day so a stale answer
  // is never shown under another date.
  const [paid, setPaid] = useState<{ day: string; byStaff: Record<string, number> } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  // Bumped after a payment is saved, to read the day's totals again.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    Promise.all(dailyStaff.map(async (s) => {
      const entries = await fetchDailyPaymentsOn(centerId, s.id, day).catch(() => []);
      return [s.id, entries.reduce((sum, e) => sum + (e.amount || 0), 0)] as const;
    })).then((rows) => {
      if (alive) setPaid({ day, byStaff: Object.fromEntries(rows) });
    });
    return () => { alive = false; };
  }, [centerId, dailyStaff, day, reloadKey]);

  const loading = paid?.day !== day;
  const paidFor = (id: string) => (loading ? 0 : paid?.byStaff[id] ?? 0);
  const amountFor = (s: StaffMember) => Number(amounts[s.id] ?? s.dailyPay?.amount ?? 0);
  const unpaid = dailyStaff.filter((s) => paidFor(s.id) === 0 && amountFor(s) > 0);
  const totalPaid = dailyStaff.reduce((sum, s) => sum + paidFor(s.id), 0);

  async function mark(list: StaffMember[], key: string) {
    setBusy(key);
    setError("");
    try {
      await Promise.all(list.map((s) => recordDailyPayment(centerId, s, amountFor(s), day, currentUser)));
      setReloadKey((k) => k + 1);
    } catch {
      setError("Couldn't save the payment. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <HandCoins className="h-4 w-4 text-[#F97316]" /> Daily Pay
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">Mark each person as you hand over their pay for the day.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <input
            type="date"
            value={day}
            max={dayKey(new Date())}
            onChange={(e) => e.target.value && setDay(e.target.value)}
            className="bg-[#0B1120] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F97316]/60 [color-scheme:dark]"
          />
          <span className="text-xs text-gray-400">
            Paid this day: <span className="text-white font-semibold">LKR {totalPaid.toLocaleString()}</span>
          </span>
        </div>

        {dailyStaff.length === 0 ? (
          <p className="text-sm text-gray-500 py-6 text-center">
            Nobody is set up for daily pay yet. Open an employee's profile and switch on
            “Paid daily” under Daily Payments.
          </p>
        ) : (
          <div className="space-y-2">
            {dailyStaff.map((s) => {
              const already = paidFor(s.id);
              return (
                <div key={s.id} className="flex items-center gap-3 bg-[#0B1120] border border-white/5 rounded-xl px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <Link to={`/employees/${s.id}`} className="text-sm text-white hover:text-orange-300 truncate block">
                      {s.fullName}
                    </Link>
                    <p className="text-[11px] text-gray-500">
                      {loading ? "Checking…" : already > 0 ? `Paid LKR ${already.toLocaleString()}` : "Not paid yet"}
                    </p>
                  </div>
                  <input
                    type="number"
                    min={0}
                    value={amounts[s.id] ?? String(s.dailyPay?.amount ?? "")}
                    onChange={(e) => setAmounts((prev) => ({ ...prev, [s.id]: e.target.value }))}
                    className="w-24 bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-sm text-white text-right focus:outline-none focus:border-orange-500"
                  />
                  <button
                    onClick={() => mark([s], s.id)}
                    disabled={loading || busy !== null || !(amountFor(s) > 0)}
                    className={`flex items-center justify-center gap-1.5 w-28 text-xs font-medium px-3 py-2 rounded-lg transition disabled:opacity-50 ${
                      already > 0
                        ? "bg-green-500/15 text-green-300 border border-green-500/25 hover:bg-green-500/25"
                        : "bg-[#F97316] hover:bg-orange-600 text-white"
                    }`}
                    title={already > 0 ? "Record another payment for this day" : undefined}
                  >
                    {busy === s.id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : already > 0 ? <><Check className="w-3.5 h-3.5" /> Paid · add</> : "Mark paid"}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 rounded-lg transition text-sm"
          >
            Close
          </button>
          {unpaid.length > 1 && (
            <button
              onClick={() => mark(unpaid, "all")}
              disabled={loading || busy !== null}
              className="flex-1 bg-[#F97316] hover:bg-orange-600 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition text-sm flex items-center justify-center gap-2"
            >
              {busy === "all" && <Loader2 className="w-4 h-4 animate-spin" />}
              Mark all {unpaid.length} paid
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
