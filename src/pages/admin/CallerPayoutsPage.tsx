import { useEffect, useMemo, useState } from "react";
import { collection, query, where } from "firebase/firestore";
import { Check, ChevronLeft, ChevronRight, Download, Wallet } from "lucide-react";
import { db } from "../../config/firebase";
import { watchQuery } from "../../lib/listeners";
import { downloadCSV } from "../../lib/csvExport";
import { useSuperAdmin } from "../../contexts/SuperAdminContext";
import { markPayoutSent } from "../../lib/leads";
import { isoWeekKey, isoWeekLabel, shiftIsoWeek } from "../../lib/isoWeek";
import {
  PAYOUT_CSV_HEADERS, groupPayouts, payoutCsvRows, payoutTotals, pendingWeeks, type PayoutGroup,
} from "../../lib/payouts";
import AdminModal from "../../components/admin/AdminModal";
import CallerAvatar from "../../components/admin/CallerAvatar";
import type { Lead } from "../../types/leads";

const rs = (n: number) => `Rs ${n.toLocaleString("en-LK")}`;

function day(ts?: { toDate: () => Date } | null): string {
  return ts ? ts.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—";
}

/**
 * Weekly commission payout. A lead lands in the week its payment was confirmed
 * (Colombo time); the Friday job is to pay each caller what that week's list
 * adds up to and mark it sent. Sent weeks stay listed with a tick — a caller on
 * leave and paid late is normal, and must not become invisible.
 */
export default function CallerPayoutsPage() {
  const { superAdmin } = useSuperAdmin();
  const currentWeek = useMemo(() => isoWeekKey(), []);
  const [week, setWeek] = useState(currentWeek);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [owing, setOwing] = useState<{ week: string; count: number }[]>([]);
  const [confirming, setConfirming] = useState<PayoutGroup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const admin = useMemo(
    () => ({ id: superAdmin?.id ?? "", name: superAdmin?.displayName || superAdmin?.email || "Super Admin" }),
    [superAdmin],
  );

  // Everything confirmed into the selected week, sent or not.
  useEffect(() => {
    return watchQuery(
      query(collection(db, "leads"), where("payoutWeek", "==", week)),
      (snap) => {
        setLeads(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Lead)));
        setLoading(false);
        setLoadError(false);
      },
      () => { setLoading(false); setLoadError(true); },
    );
  }, [week]);

  // Weeks that still owe a commission, so a late payout can't hide in the past.
  useEffect(() => {
    return watchQuery(
      query(collection(db, "leads"), where("payoutStatus", "==", "pending")),
      (snap) => setOwing(pendingWeeks(snap.docs.map((d) => d.data() as Lead))),
      () => setOwing([]),
    );
  }, []);

  const groups = useMemo(() => groupPayouts(leads), [leads]);
  const totals = useMemo(() => payoutTotals(groups), [groups]);
  const otherOwing = owing.filter((o) => o.week !== week);

  function selectWeek(next: string) {
    setLoading(true);
    setError("");
    setWeek(next);
  }

  async function confirmSend() {
    if (!confirming || busy) return;
    setBusy(true);
    setError("");
    try {
      await markPayoutSent(confirming.pending, admin);
      setConfirming(null);
    } catch (err) {
      setError((err as Error).message || "That didn't save. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    downloadCSV(`commission-payout-${week}.csv`, PAYOUT_CSV_HEADERS, payoutCsvRows(week, groups));
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-semibold text-white flex items-center gap-2">
            <Wallet className="w-5 h-5 text-emerald-400" /> Caller payouts
          </h1>
          <p className="text-sm text-gray-500 mt-1">Commission on payments confirmed in the selected week.</p>
        </div>
        <button
          onClick={exportCsv}
          disabled={groups.length === 0}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 disabled:opacity-40 transition-colors"
        >
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      {/* Week selector */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button onClick={() => selectWeek(shiftIsoWeek(week, -1))} aria-label="Previous week"
          className="p-2 rounded-lg bg-gray-900 border border-gray-800 text-gray-400 hover:text-white">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="px-4 py-2 rounded-lg bg-gray-900 border border-gray-800 text-center min-w-[11rem]">
          <p className="text-sm font-medium text-white">{week}</p>
          <p className="text-xs text-gray-500">{isoWeekLabel(week)}</p>
        </div>
        <button onClick={() => selectWeek(shiftIsoWeek(week, 1))} disabled={week >= currentWeek} aria-label="Next week"
          className="p-2 rounded-lg bg-gray-900 border border-gray-800 text-gray-400 hover:text-white disabled:opacity-30">
          <ChevronRight className="w-4 h-4" />
        </button>
        {week !== currentWeek && (
          <button onClick={() => selectWeek(currentWeek)} className="text-xs text-orange-400 hover:text-orange-300 px-2">
            This week
          </button>
        )}
      </div>

      {otherOwing.length > 0 && (
        <div className="mb-4 text-sm bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 text-amber-300 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>Still owed from other weeks:</span>
          {otherOwing.map((o) => (
            <button key={o.week} onClick={() => selectWeek(o.week)} className="underline decoration-dotted hover:text-amber-100">
              {o.week} ({o.count})
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-600 py-16 text-center">Loading…</p>
      ) : loadError ? (
        <p className="text-sm text-red-400 py-16 text-center">Couldn't load this week. Check the connection and try again.</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-gray-600 py-16 text-center border border-dashed border-gray-800 rounded-xl">
          No commissions were confirmed in this week.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              ["Total", totals.total, "text-white"],
              ["To pay", totals.pendingTotal, "text-amber-300"],
              ["Sent", totals.sentTotal, "text-emerald-300"],
            ].map(([label, value, tone]) => (
              <div key={label as string} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
                <p className="text-xs text-gray-500">{label as string}</p>
                <p className={`text-lg font-semibold ${tone as string}`}>{rs(value as number)}</p>
              </div>
            ))}
          </div>

          <div className="space-y-4">
            {groups.map((g) => (
              <section
                key={g.callerId}
                className={`bg-gray-900 border rounded-xl overflow-hidden ${g.allSent ? "border-emerald-500/20 opacity-80" : "border-gray-800"}`}
              >
                <header className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-800">
                  <CallerAvatar name={g.callerName} size="md" />
                  <div className="mr-auto">
                    <p className="text-sm font-semibold text-white">{g.callerName}</p>
                    <p className="text-xs text-gray-500">{g.leads.length} sale{g.leads.length === 1 ? "" : "s"}</p>
                  </div>
                  <p className="text-sm text-white font-semibold">{rs(g.total)}</p>
                  {g.allSent ? (
                    <span className="flex items-center gap-1 text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-2.5 py-1">
                      <Check className="w-3.5 h-3.5" /> Sent
                    </span>
                  ) : (
                    <button
                      onClick={() => { setError(""); setConfirming(g); }}
                      className="px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                    >
                      Mark payout sent
                    </button>
                  )}
                </header>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500">
                      <th className="px-4 py-2 font-medium">Garage</th>
                      <th className="px-4 py-2 font-medium">Package</th>
                      <th className="px-4 py-2 font-medium">Confirmed</th>
                      <th className="px-4 py-2 font-medium text-right">Commission</th>
                      <th className="px-4 py-2 w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/70">
                    {g.leads.map((l) => (
                      <tr key={l.id}>
                        <td className="px-4 py-2 text-gray-200">{l.businessName}</td>
                        <td className="px-4 py-2 text-gray-400 capitalize">{l.packageId ?? "—"}</td>
                        <td className="px-4 py-2 text-gray-500 text-xs">{day(l.paymentConfirmedAt)}</td>
                        <td className="px-4 py-2 text-right text-gray-100 tabular-nums">{rs(l.commissionAmount ?? 0)}</td>
                        <td className="px-4 py-2 text-emerald-400">
                          {l.payoutStatus === "paid_to_caller" && <Check className="w-4 h-4" aria-label="Sent" />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {g.pending.length > 0 && g.pending.length < g.leads.length && (
                    <tfoot>
                      <tr className="text-xs text-gray-500">
                        <td colSpan={3} className="px-4 py-2">Still to pay</td>
                        <td className="px-4 py-2 text-right text-amber-300 tabular-nums">{rs(g.pendingTotal)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </section>
            ))}
          </div>
        </>
      )}

      {confirming && (
        <AdminModal
          title={`Mark ${confirming.callerName}'s payout sent?`}
          size="sm"
          onClose={() => (busy ? undefined : setConfirming(null))}
          footer={
            <>
              <button onClick={() => setConfirming(null)} disabled={busy} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white">
                Cancel
              </button>
              <button
                onClick={() => void confirmSend()}
                disabled={busy}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white transition-colors"
              >
                {busy ? "Saving…" : "Yes, it's sent"}
              </button>
            </>
          }
        >
          <p className="text-sm text-gray-300">
            This records that you've paid <span className="text-white font-medium">{rs(confirming.pendingTotal)}</span> for{" "}
            {confirming.pending.length} sale{confirming.pending.length === 1 ? "" : "s"} in {week}. It can't be undone from the app.
          </p>
          {error && <p role="alert" className="text-sm text-red-400 mt-3">{error}</p>}
        </AdminModal>
      )}
    </div>
  );
}
