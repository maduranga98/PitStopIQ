import { useEffect, useState, useMemo } from "react";
import { collection, query, where, getDocs, Timestamp } from "firebase/firestore";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import { Download } from "lucide-react";
import { db } from "../../config/firebase";
import { downloadCSV } from "../../lib/csvExport";
import { jobProfitability } from "../../lib/jobProfitability";
import type { PartUsed } from "../../types/auth";

interface JobDoc {
  id: string;
  jobNumber?: string;
  plateNumber?: string;
  customerName?: string;
  createdAt: Timestamp;
  partsUsed?: PartUsed[];
  laborCost?: number;
  departmentId?: string;
  departmentName?: string;
}

interface InvoiceDoc {
  serviceId?: string;
  grandTotal: number;
}

interface Props {
  centerId: string;
  startDate: Date;
  endDate: Date;
}

function formatLKR(n: number) {
  return `LKR ${n.toLocaleString("en-LK", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function monthLabel(date: Date) {
  return date.toLocaleDateString("en-LK", { month: "short", year: "2-digit" });
}

export default function ProfitabilityReport({ centerId, startDate, endDate }: Props) {
  const [jobs, setJobs] = useState<JobDoc[]>([]);
  const [invoices, setInvoices] = useState<InvoiceDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!centerId) return;
    setLoading(true);
    Promise.all([
      getDocs(query(
        collection(db, "servicecenters", centerId, "jobs"),
        where("createdAt", ">=", Timestamp.fromDate(startDate)),
        where("createdAt", "<=", Timestamp.fromDate(endDate)),
      )),
      getDocs(query(
        collection(db, "servicecenters", centerId, "invoices"),
        where("createdAt", ">=", Timestamp.fromDate(startDate)),
        where("createdAt", "<=", Timestamp.fromDate(endDate)),
      )),
    ]).then(([jobSnap, invSnap]) => {
      setJobs(jobSnap.docs.map((d) => ({ id: d.id, ...d.data() } as JobDoc)));
      setInvoices(invSnap.docs.map((d) => d.data() as InvoiceDoc));
      setLoading(false);
    });
  }, [centerId, startDate, endDate]);

  const revenueByJobId = useMemo(() => {
    const map = new Map<string, number>();
    invoices.forEach((inv) => {
      if (inv.serviceId) map.set(inv.serviceId, (map.get(inv.serviceId) ?? 0) + (inv.grandTotal ?? 0));
    });
    return map;
  }, [invoices]);

  const rows = useMemo(() => jobs.map((job) => {
    const revenue = revenueByJobId.get(job.id) ?? 0;
    const p = jobProfitability(job, revenue > 0 ? { grandTotal: revenue } : null);
    return { job, ...p };
  }), [jobs, revenueByJobId]);

  const totals = useMemo(() => rows.reduce((acc, r) => ({
    revenue: acc.revenue + r.revenue,
    partsCost: acc.partsCost + r.partsCost,
    laborCost: acc.laborCost + r.laborCost,
    grossProfit: acc.grossProfit + r.grossProfit,
  }), { revenue: 0, partsCost: 0, laborCost: 0, grossProfit: 0 }), [rows]);

  const overallMargin = totals.revenue > 0 ? Math.round((totals.grossProfit / totals.revenue) * 100) : null;

  // Monthly gross profit
  const monthlyData = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((r) => {
      const key = monthLabel(r.job.createdAt.toDate());
      map.set(key, (map.get(key) ?? 0) + r.grossProfit);
    });
    return Array.from(map.entries()).map(([month, profit]) => ({ month, profit }));
  }, [rows]);

  // By department
  const byDepartment = useMemo(() => {
    const map = new Map<string, { revenue: number; cost: number; profit: number; jobs: number }>();
    rows.forEach((r) => {
      const key = r.job.departmentName || "Unassigned";
      const cur = map.get(key) ?? { revenue: 0, cost: 0, profit: 0, jobs: 0 };
      cur.revenue += r.revenue;
      cur.cost += r.totalCost;
      cur.profit += r.grossProfit;
      cur.jobs += 1;
      map.set(key, cur);
    });
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, ...v, margin: v.revenue > 0 ? Math.round((v.profit / v.revenue) * 100) : null }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [rows]);

  function handleExport() {
    const headers = ["Job #", "Date", "Customer", "Plate", "Department", "Revenue", "Parts Cost", "Labor Cost", "Gross Profit", "Margin %"];
    const csvRows = rows.map((r) => [
      r.job.jobNumber ?? "",
      r.job.createdAt.toDate().toLocaleDateString("en-GB"),
      r.job.customerName ?? "",
      r.job.plateNumber ?? "",
      r.job.departmentName ?? "Unassigned",
      r.revenue.toString(),
      r.partsCost.toString(),
      r.laborCost.toString(),
      r.grossProfit.toString(),
      r.marginPercent != null ? r.marginPercent.toString() : "",
    ]);
    downloadCSV(`profitability-report-${startDate.toISOString().slice(0, 10)}.csv`, headers, csvRows);
  }

  if (loading) {
    return <div className="text-center text-gray-400 py-16">Loading profitability data…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Revenue", value: formatLKR(totals.revenue), sub: `${jobs.length} jobs` },
          { label: "Parts Cost", value: formatLKR(totals.partsCost), sub: "Purchase cost of parts used" },
          { label: "Labor Cost", value: formatLKR(totals.laborCost), sub: "Recorded on jobs" },
          {
            label: "Gross Profit",
            value: formatLKR(totals.grossProfit),
            sub: overallMargin !== null ? `${overallMargin}% margin` : "No invoiced revenue yet",
          },
        ].map((m) => (
          <div key={m.label} className="bg-[#162032] rounded-xl p-4 border border-white/5">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">{m.label}</div>
            <div className={`text-2xl font-bold ${m.label === "Gross Profit" ? (totals.grossProfit >= 0 ? "text-green-400" : "text-red-400") : "text-white"}`}>
              {m.value}
            </div>
            <div className="text-xs text-gray-600 mt-0.5">{m.sub}</div>
          </div>
        ))}
      </div>

      <div className="bg-[#162032] rounded-xl p-4 border border-white/5">
        <h3 className="text-sm font-semibold text-white mb-4">Monthly Gross Profit</h3>
        {monthlyData.length === 0 ? (
          <div className="text-center text-gray-500 py-8 text-sm">No jobs in this period</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthlyData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
              <XAxis dataKey="month" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ background: "#0B1120", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                labelStyle={{ color: "#fff" }}
                formatter={(v) => [formatLKR(v as number), "Gross Profit"]}
              />
              <Bar dataKey="profit" fill="#10B981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="bg-[#162032] rounded-xl p-4 border border-white/5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">By Department</h3>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 text-xs font-medium bg-[#F97316]/10 hover:bg-[#F97316]/20 text-[#F97316] border border-[#F97316]/20 px-3 py-1.5 rounded-lg transition"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        </div>
        {byDepartment.length === 0 ? (
          <div className="text-center text-gray-500 py-6 text-sm">No jobs in this period</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Department</th>
                  <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Jobs</th>
                  <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Revenue</th>
                  <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Cost</th>
                  <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Gross Profit</th>
                  <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2">Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {byDepartment.map((d) => (
                  <tr key={d.name}>
                    <td className="py-3 pr-4 text-white">{d.name}</td>
                    <td className="py-3 pr-4 text-right text-gray-400">{d.jobs}</td>
                    <td className="py-3 pr-4 text-right text-gray-300">{formatLKR(d.revenue)}</td>
                    <td className="py-3 pr-4 text-right text-gray-400">{formatLKR(d.cost)}</td>
                    <td className={`py-3 pr-4 text-right font-medium ${d.profit >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {formatLKR(d.profit)}
                    </td>
                    <td className="py-3 text-right text-gray-400">{d.margin != null ? `${d.margin}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
