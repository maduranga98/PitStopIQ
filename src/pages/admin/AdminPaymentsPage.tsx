import { useEffect, useState } from "react";
import { collectionGroup, getDocs, collection } from "firebase/firestore";
import { db } from "../../config/firebase";
import { Download, TrendingUp, DollarSign, Calendar, Building2, CreditCard } from "lucide-react";
import type { ServiceCenterPayment, ServiceCenter } from "../../types/auth";
import type { Timestamp } from "firebase/firestore";

interface PaymentWithCenter extends ServiceCenterPayment {
  centerName?: string;
  paymentCode?: string;
}

export default function AdminPaymentsPage() {
  const [payments, setPayments] = useState<PaymentWithCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterYear, setFilterYear] = useState(new Date().getFullYear());
  const [filterMonth, setFilterMonth] = useState<number | "all">("all");


  useEffect(() => {
    Promise.all([
      getDocs(collectionGroup(db, "payments")),
      getDocs(collection(db, "servicecenters")),
    ]).then(([paymentsSnap, centersSnap]) => {
      const centerMap = new Map<string, ServiceCenter>();
      centersSnap.docs.forEach((d) => centerMap.set(d.id, { id: d.id, ...d.data() } as ServiceCenter));
      const ps = paymentsSnap.docs.map((d) => {
        const p = { id: d.id, ...d.data() } as ServiceCenterPayment;
        const c = centerMap.get(p.centerId);
        return { ...p, centerName: c?.name, paymentCode: c?.paymentCode } as PaymentWithCenter;
      });
      // Sort newest first
      ps.sort((a, b) => {
        const at = (a.paidAt as Timestamp)?.seconds ?? (a.createdAt as Timestamp)?.seconds ?? 0;
        const bt = (b.paidAt as Timestamp)?.seconds ?? (b.createdAt as Timestamp)?.seconds ?? 0;
        return bt - at;
      });
      setPayments(ps);
      setLoading(false);
    });
  }, []);

  const years = Array.from(new Set(
    payments
      .filter((p) => p.paidAt)
      .map((p) => new Date((p.paidAt as Timestamp).seconds * 1000).getFullYear())
  )).sort((a, b) => b - a);

  const filtered = payments.filter((p) => {
    if (p.status !== "paid" || !p.paidAt) return false;
    const d = new Date((p.paidAt as Timestamp).seconds * 1000);
    if (d.getFullYear() !== filterYear) return false;
    if (filterMonth !== "all" && d.getMonth() !== filterMonth) return false;
    return true;
  });

  const total = filtered.reduce((s, p) => s + (p.amount ?? 0), 0);
  const proCount = filtered.filter((p) => p.plan === "pro").length;
  const basicCount = filtered.filter((p) => p.plan === "basic").length;

  // Monthly breakdown for the selected year
  const monthlyTotals = Array.from({ length: 12 }, (_, i) => {
    const monthPayments = payments.filter((p) => {
      if (p.status !== "paid" || !p.paidAt) return false;
      const d = new Date((p.paidAt as Timestamp).seconds * 1000);
      return d.getFullYear() === filterYear && d.getMonth() === i;
    });
    return { month: i, total: monthPayments.reduce((s, p) => s + (p.amount ?? 0), 0) };
  });

  const maxMonthly = Math.max(...monthlyTotals.map((m) => m.total), 1);

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function exportPDF() {
    const w = window.open("", "_blank");
    if (!w) return;

    const rows = filtered.map((p) => `
      <tr>
        <td>${p.paidAt ? new Date((p.paidAt as Timestamp).seconds * 1000).toLocaleDateString() : "—"}</td>
        <td>${p.centerName ?? p.centerId}</td>
        <td style="font-family:monospace">${p.paymentCode ?? "—"}</td>
        <td>${p.plan.toUpperCase()}</td>
        <td>${p.period}</td>
        <td style="text-align:right">LKR ${(p.amount ?? 0).toLocaleString()}</td>
        <td>${p.notes ?? ""}</td>
      </tr>
    `).join("");

    const label = filterMonth === "all" ? `${filterYear}` : `${MONTHS[filterMonth as number]} ${filterYear}`;

    w.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>PitStopIQ Revenue Report — ${label}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 32px; color: #111; }
          h1 { font-size: 22px; margin-bottom: 4px; }
          .sub { color: #666; font-size: 13px; margin-bottom: 24px; }
          .kpi { display: flex; gap: 24px; margin-bottom: 28px; }
          .kpi-box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 24px; min-width: 140px; }
          .kpi-box .value { font-size: 22px; font-weight: 700; }
          .kpi-box .label { font-size: 12px; color: #666; margin-top: 4px; }
          table { width: 100%; border-collapse: collapse; font-size: 13px; }
          th { background: #f8fafc; text-align: left; padding: 8px 12px; border-bottom: 2px solid #e2e8f0; font-size: 12px; text-transform: uppercase; color: #64748b; }
          td { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; }
          .total-row td { font-weight: 700; border-top: 2px solid #e2e8f0; border-bottom: none; }
          @media print { body { padding: 16px; } }
        </style>
      </head>
      <body>
        <h1>PitStopIQ Revenue Report</h1>
        <div class="sub">Period: ${label} &nbsp;|&nbsp; Generated: ${new Date().toLocaleDateString()}</div>
        <div class="kpi">
          <div class="kpi-box"><div class="value">LKR ${total.toLocaleString()}</div><div class="label">Total Collections</div></div>
          <div class="kpi-box"><div class="value">${filtered.length}</div><div class="label">Payments</div></div>
          <div class="kpi-box"><div class="value">${proCount}</div><div class="label">Pro Payments</div></div>
          <div class="kpi-box"><div class="value">${basicCount}</div><div class="label">Basic Payments</div></div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Service Center</th>
              <th>Code</th>
              <th>Plan</th>
              <th>Period</th>
              <th style="text-align:right">Amount</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
            <tr class="total-row">
              <td colspan="5">Total</td>
              <td style="text-align:right">LKR ${total.toLocaleString()}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </body>
      </html>
    `);
    w.document.close();
    setTimeout(() => w.print(), 400);
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Revenue & Collections</h1>
          <p className="text-sm text-gray-400 mt-1">All payment records across service centers</p>
        </div>
        <button
          onClick={exportPDF}
          className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Download className="w-4 h-4" />
          Export PDF
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <select
          value={filterYear}
          onChange={(e) => setFilterYear(Number(e.target.value))}
          className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
        >
          {(years.length > 0 ? years : [new Date().getFullYear()]).map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <select
          value={filterMonth}
          onChange={(e) => setFilterMonth(e.target.value === "all" ? "all" : Number(e.target.value))}
          className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
        >
          <option value="all">All Months</option>
          {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-gray-900 rounded-xl border border-gray-800 animate-pulse" />)}
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {[
              { label: "Total Collections", value: `LKR ${total.toLocaleString()}`, icon: DollarSign, color: "text-emerald-400 bg-emerald-400/10" },
              { label: "Payments", value: filtered.length, icon: CreditCard, color: "text-blue-400 bg-blue-400/10" },
              { label: "Pro Payments", value: proCount, icon: TrendingUp, color: "text-orange-400 bg-orange-400/10" },
              { label: "Basic Payments", value: basicCount, icon: Building2, color: "text-gray-400 bg-gray-400/10" },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="bg-gray-900 rounded-xl border border-gray-800 p-5">
                <div className={`inline-flex p-2 rounded-lg ${color} mb-3`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="text-2xl font-bold text-white">{value}</div>
                <div className="text-sm text-gray-400 mt-1">{label}</div>
              </div>
            ))}
          </div>

          {/* Monthly bar chart */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
            <h2 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-orange-400" />
              Monthly Collections — {filterYear}
            </h2>
            <div className="flex items-end gap-1.5 h-32">
              {monthlyTotals.map(({ month, total: mt }) => (
                <div key={month} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className={`w-full rounded-t transition-all ${
                      filterMonth === month ? "bg-orange-500" : "bg-gray-700 hover:bg-gray-600"
                    }`}
                    style={{ height: `${Math.max(4, (mt / maxMonthly) * 100)}%` }}
                    title={`LKR ${mt.toLocaleString()}`}
                    onClick={() => setFilterMonth(filterMonth === month ? "all" : month)}
                  />
                  <span className="text-xs text-gray-600">{MONTHS[month]}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-200">Payment Records</span>
              <span className="text-xs text-gray-500">{filtered.length} records</span>
            </div>
            {filtered.length === 0 ? (
              <div className="py-12 text-center text-gray-500 text-sm">No payments found for this period.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium uppercase">Date</th>
                      <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium uppercase">Service Center</th>
                      <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium uppercase">Code</th>
                      <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium uppercase">Plan</th>
                      <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium uppercase">Period</th>
                      <th className="text-right px-5 py-3 text-xs text-gray-500 font-medium uppercase">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((p) => (
                      <tr key={p.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                        <td className="px-5 py-3 text-gray-300">
                          {p.paidAt ? new Date((p.paidAt as Timestamp).seconds * 1000).toLocaleDateString() : "—"}
                        </td>
                        <td className="px-5 py-3 text-white font-medium">{p.centerName ?? p.centerId}</td>
                        <td className="px-5 py-3 font-mono text-orange-400 text-xs">{p.paymentCode ?? "—"}</td>
                        <td className="px-5 py-3">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            p.plan === "pro" ? "bg-orange-500/15 text-orange-400" : "bg-gray-800 text-gray-400"
                          }`}>
                            {p.plan.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-gray-400 capitalize">{p.period}</td>
                        <td className="px-5 py-3 text-right text-white font-semibold">
                          LKR {(p.amount ?? 0).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-gray-800/50">
                      <td colSpan={5} className="px-5 py-3 text-sm font-semibold text-white">Total</td>
                      <td className="px-5 py-3 text-right text-lg font-bold text-emerald-400">
                        LKR {total.toLocaleString()}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
