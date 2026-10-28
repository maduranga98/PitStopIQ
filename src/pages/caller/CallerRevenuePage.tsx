import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { Banknote, CheckCircle2, Clock, Hourglass } from "lucide-react";
import { db } from "../../config/firebase";
import { useCallerLeads } from "../../contexts/callerLeadsContext";
import { calcCommission } from "../../lib/leadCommission";
import { isoWeekKey, isoWeekLabel } from "../../lib/isoWeek";
import {
  recentWeeks, saleStatus, salesList, summarizeRevenue, weeklyEarnings, type SaleStatus,
} from "../../lib/callerRevenue";
import type { LeadPackage } from "../../types/leads";

const rs = (n: number) => `Rs ${n.toLocaleString("en-LK")}`;

function day(ts?: { toDate: () => Date } | null): string {
  return ts ? ts.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

const STATUS: Record<SaleStatus, { label: string; chip: string }> = {
  paid: { label: "Paid out", chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  payable: { label: "Payable", chip: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  awaiting: { label: "Awaiting payment", chip: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
};

/**
 * The caller's own earnings. Everything here comes from their own won leads —
 * the same documents the board reads — so a caller can only ever see their
 * own commission.
 */
export default function CallerRevenuePage() {
  const { leads, loading, error } = useCallerLeads();
  const currentWeek = useMemo(() => isoWeekKey(), []);
  const [packages, setPackages] = useState<{ id: string; name: string; commission: number }[]>([]);

  // The commission per package, from the same price list the payout is worked out from.
  useEffect(() => {
    let live = true;
    getDocs(collection(db, "packages"))
      .then((snap) => {
        if (!live) return;
        setPackages(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as LeadPackage) }))
            .map((p) => ({ id: p.id, name: p.name, commission: calcCommission(p) }))
            .sort((a, b) => a.commission - b.commission),
        );
      })
      .catch(() => { /* a hint, not essential */ });
    return () => { live = false; };
  }, []);

  const summary = useMemo(() => summarizeRevenue(leads), [leads]);
  const weeks = useMemo(() => recentWeeks(weeklyEarnings(leads), 8, currentWeek), [leads, currentWeek]);
  const sales = useMemo(() => salesList(leads), [leads]);
  const peak = Math.max(1, ...weeks.map((w) => w.total));

  const cards = [
    { label: "Paid out", value: rs(summary.paidOut), icon: CheckCircle2, tone: "text-emerald-400", hint: "Sent to you" },
    { label: "Payable", value: rs(summary.payable), icon: Banknote, tone: "text-sky-400", hint: "Confirmed, in the weekly payout" },
    { label: "Awaiting payment", value: rs(summary.awaiting), icon: Hourglass, tone: "text-amber-400", hint: "Customer hasn't paid yet" },
    { label: "Sales", value: String(summary.sales), icon: Clock, tone: "text-gray-300", hint: "Customers you brought in" },
  ];

  return (
    <div className="px-4 sm:px-6 py-6 max-w-5xl mx-auto">
      <h1 className="text-xl sm:text-2xl font-semibold text-white">Revenue</h1>
      <p className="text-sm text-gray-500 mt-1">
        Your commission on customers you brought in. It becomes payable once their first payment is confirmed.
      </p>

      {loading ? (
        <div className="py-24 flex justify-center"><div className="animate-spin rounded-full h-7 w-7 border-b-2 border-orange-500" /></div>
      ) : error ? (
        <p className="text-center text-red-400 py-24 text-sm">Couldn't load your revenue. Check the connection and reload.</p>
      ) : (
        <>
          {/* Hero */}
          <div className="mt-6 rounded-2xl border border-gray-800 bg-gradient-to-br from-gray-900 to-gray-900/40 p-6">
            <p className="text-sm text-gray-400">Total earned</p>
            <p className="text-4xl sm:text-5xl font-semibold text-white mt-1 tabular-nums">{rs(summary.earned)}</p>
            <p className="text-sm text-gray-500 mt-2">
              {summary.earned > 0
                ? `${rs(summary.paidOut)} paid out · ${rs(summary.payable)} still to come`
                : summary.awaiting > 0
                  ? `${rs(summary.awaiting)} is waiting on customers' first payments.`
                  : "Your first sale will show up here."}
            </p>
            {packages.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4">
                {packages.map((p) => (
                  <span key={p.id} className="text-xs text-gray-400 bg-white/5 border border-white/10 rounded-full px-2.5 py-1">
                    {p.name} sale · <span className="text-gray-200 font-medium">{rs(p.commission)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Breakdown */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
            {cards.map(({ label, value, icon: Icon, tone, hint }) => (
              <div key={label} className="rounded-xl border border-gray-800 bg-gray-900 px-4 py-3">
                <p className="flex items-center gap-1.5 text-xs text-gray-500"><Icon className={`w-3.5 h-3.5 ${tone}`} />{label}</p>
                <p className="text-lg font-semibold text-white mt-1 tabular-nums">{value}</p>
                <p className="text-[11px] text-gray-600 mt-0.5">{hint}</p>
              </div>
            ))}
          </div>

          {/* Weekly chart */}
          <section className="mt-6 rounded-2xl border border-gray-800 bg-gray-900 p-5" aria-label="Earnings by week">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white">Last 8 weeks</h2>
              <div className="flex items-center gap-3 text-[11px] text-gray-500">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500" />Paid</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-sky-500" />Payable</span>
              </div>
            </div>
            <div className="flex items-end gap-2 sm:gap-3 h-40">
              {weeks.map((w) => {
                const isNow = w.week === currentWeek;
                return (
                  <div key={w.week} className="flex-1 h-full flex flex-col justify-end items-center gap-1.5 min-w-0"
                    title={`${w.week} · ${isoWeekLabel(w.week)} · ${rs(w.total)}`}>
                    <span className="text-[10px] text-gray-500 tabular-nums truncate max-w-full">{w.total > 0 ? rs(w.total) : ""}</span>
                    <div className="w-full flex flex-col justify-end rounded-md overflow-hidden bg-gray-800/40" style={{ height: `${Math.max(w.total > 0 ? 6 : 2, (w.total / peak) * 100)}%` }}>
                      {w.payable > 0 && <div className="bg-sky-500" style={{ height: `${(w.payable / w.total) * 100}%` }} />}
                      {w.paid > 0 && <div className="bg-emerald-500" style={{ height: `${(w.paid / w.total) * 100}%` }} />}
                    </div>
                    <span className={`text-[10px] ${isNow ? "text-orange-300 font-medium" : "text-gray-600"}`}>{w.week.slice(5)}</span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Sales */}
          <section className="mt-6" aria-label="Sales">
            <h2 className="text-sm font-semibold text-white mb-3">Your sales</h2>
            {sales.length === 0 ? (
              <p className="text-sm text-gray-600 py-12 text-center border border-dashed border-gray-800 rounded-xl">
                No sales yet. When a lead you're working registers as a customer, it appears here.
              </p>
            ) : (
              <ul className="rounded-xl border border-gray-800 bg-gray-900 divide-y divide-gray-800/80 overflow-hidden">
                {sales.map((l) => {
                  const status = saleStatus(l);
                  return (
                    <li key={l.id} className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                      <div className="min-w-0 flex-1 basis-48">
                        <p className="text-sm font-medium text-white truncate">{l.businessName}</p>
                        <p className="text-xs text-gray-500 capitalize">
                          {l.packageId ?? "Package unknown"} · registered {day(l.convertedAt)}
                        </p>
                      </div>
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${STATUS[status].chip}`}>
                        {STATUS[status].label}{status === "payable" && l.payoutWeek ? ` · ${l.payoutWeek}` : ""}
                      </span>
                      <p className="w-24 text-right text-sm font-semibold text-white tabular-nums">
                        {typeof l.commissionAmount === "number" ? rs(l.commissionAmount) : "—"}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
