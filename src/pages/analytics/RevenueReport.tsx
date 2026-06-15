import { useEffect, useState, useMemo } from "react";
import {
  collection, query, where, getDocs, Timestamp,
} from "firebase/firestore";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell,
  ResponsiveContainer, Legend,
} from "recharts";
import { Download, TrendingUp, TrendingDown } from "lucide-react";
import { db } from "../../config/firebase";
import { downloadCSV } from "../../lib/csvExport";

const PIE_COLORS = ["#F97316", "#3B82F6", "#10B981", "#F59E0B", "#8B5CF6", "#EF4444", "#06B6D4"];

interface LineItem {
  description: string;
  qty: number;
  unitPrice: number;
}

interface InvoiceDoc {
  id: string;
  createdAt: Timestamp;
  status: "paid" | "pending" | "partial";
  grandTotal: number;
  paidAmount: number;
  customerId: string;
  customerName: string;
  vehiclePlate?: string;
  plateNumber?: string;
  lineItems: LineItem[];
  discount?: number;
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

export default function RevenueReport({ centerId, startDate, endDate }: Props) {
  const [invoices, setInvoices] = useState<InvoiceDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!centerId) return;
    setLoading(true);
    const q = query(
      collection(db, "servicecenters", centerId, "invoices"),
      where("createdAt", ">=", Timestamp.fromDate(startDate)),
      where("createdAt", "<=", Timestamp.fromDate(endDate)),
    );
    getDocs(q).then((snap) => {
      setInvoices(snap.docs.map((d) => ({ id: d.id, ...d.data() } as InvoiceDoc)));
      setLoading(false);
    });
  }, [centerId, startDate, endDate]);

  // Previous period for comparison
  const [prevInvoices, setPrevInvoices] = useState<InvoiceDoc[]>([]);
  useEffect(() => {
    if (!centerId) return;
    const periodMs = endDate.getTime() - startDate.getTime();
    const prevEnd = new Date(startDate.getTime() - 1);
    const prevStart = new Date(startDate.getTime() - periodMs);
    const q = query(
      collection(db, "servicecenters", centerId, "invoices"),
      where("createdAt", ">=", Timestamp.fromDate(prevStart)),
      where("createdAt", "<=", Timestamp.fromDate(prevEnd)),
      where("status", "==", "paid"),
    );
    getDocs(q).then((snap) => {
      setPrevInvoices(snap.docs.map((d) => ({ id: d.id, ...d.data() } as InvoiceDoc)));
    });
  }, [centerId, startDate, endDate]);

  const paid = useMemo(() => invoices.filter((i) => i.status === "paid"), [invoices]);
  const unpaid = useMemo(() => invoices.filter((i) => i.status !== "paid"), [invoices]);

  const totalRevenue = useMemo(() => paid.reduce((s, i) => s + i.grandTotal, 0), [paid]);
  const avgInvoice = paid.length > 0 ? totalRevenue / paid.length : 0;
  const paidRate = invoices.length > 0 ? (paid.length / invoices.length) * 100 : 0;

  const prevRevenue = useMemo(() => prevInvoices.reduce((s, i) => s + i.grandTotal, 0), [prevInvoices]);
  const revDiff = prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue) * 100 : null;

  // Monthly bar chart data
  const monthlyData = useMemo(() => {
    const map = new Map<string, number>();
    paid.forEach((inv) => {
      const d = inv.createdAt.toDate();
      const key = monthLabel(d);
      map.set(key, (map.get(key) ?? 0) + inv.grandTotal);
    });
    return Array.from(map.entries()).map(([month, revenue]) => ({ month, revenue }));
  }, [paid]);

  // Service type pie
  const serviceTypeData = useMemo(() => {
    const map = new Map<string, number>();
    paid.forEach((inv) => {
      (inv.lineItems ?? []).forEach((li) => {
        const key = li.description || "Other";
        map.set(key, (map.get(key) ?? 0) + li.qty * li.unitPrice);
      });
    });
    const sorted = Array.from(map.entries())
      .sort((a, b) => b[1] - a[1]);
    if (sorted.length <= 6) return sorted.map(([name, value]) => ({ name, value }));
    const top6 = sorted.slice(0, 6);
    const other = sorted.slice(6).reduce((s, [, v]) => s + v, 0);
    return [...top6.map(([name, value]) => ({ name, value })), { name: "Other", value: other }];
  }, [paid]);

  function handleExport() {
    const headers = ["Invoice Date", "Customer", "Vehicle", "Grand Total", "Paid Amount", "Status", "Amount Due"];
    const rows = invoices.map((inv) => [
      inv.createdAt.toDate().toLocaleDateString("en-GB"),
      inv.customerName,
      inv.vehiclePlate ?? inv.plateNumber ?? "",
      inv.grandTotal.toString(),
      inv.paidAmount.toString(),
      inv.status,
      (inv.grandTotal - inv.paidAmount).toString(),
    ]);
    downloadCSV(`revenue-report-${startDate.toISOString().slice(0, 10)}.csv`, headers, rows);
  }

  if (loading) {
    return <div className="text-center text-gray-400 py-16">Loading revenue data…</div>;
  }

  return (
    <div className="space-y-6">
      {/* Key metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Revenue", value: formatLKR(totalRevenue), sub: "Paid invoices" },
          { label: "Avg Invoice Value", value: formatLKR(avgInvoice), sub: `${paid.length} paid invoices` },
          { label: "Total Invoices", value: invoices.length.toString(), sub: "In period" },
          { label: "Paid Rate", value: `${paidRate.toFixed(1)}%`, sub: `${paid.length} / ${invoices.length}` },
        ].map((m) => (
          <div key={m.label} className="bg-[#162032] rounded-xl p-4 border border-white/5">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">{m.label}</div>
            <div className="text-2xl font-bold text-white">{m.value}</div>
            <div className="text-xs text-gray-600 mt-0.5">{m.sub}</div>
          </div>
        ))}
      </div>

      {/* Period comparison */}
      {revDiff !== null && (
        <div className="bg-[#162032] rounded-xl p-4 border border-white/5 flex items-center gap-4">
          <div className={`p-2.5 rounded-xl ${revDiff >= 0 ? "bg-green-500/10" : "bg-red-500/10"}`}>
            {revDiff >= 0
              ? <TrendingUp className="h-5 w-5 text-green-400" />
              : <TrendingDown className="h-5 w-5 text-red-400" />}
          </div>
          <div>
            <div className="text-sm text-gray-300">
              <span className={`font-bold ${revDiff >= 0 ? "text-green-400" : "text-red-400"}`}>
                {revDiff >= 0 ? "+" : ""}{revDiff.toFixed(1)}%
              </span>{" "}
              vs previous equivalent period
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              Previous: {formatLKR(prevRevenue)} → Current: {formatLKR(totalRevenue)}
            </div>
          </div>
        </div>
      )}

      {/* Monthly Bar Chart */}
      <div className="bg-[#162032] rounded-xl p-4 border border-white/5">
        <h3 className="text-sm font-semibold text-white mb-4">Monthly Revenue (Paid)</h3>
        {monthlyData.length === 0 ? (
          <div className="text-center text-gray-500 py-8 text-sm">No paid invoices in this period</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthlyData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
              <XAxis dataKey="month" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ background: "#0B1120", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                labelStyle={{ color: "#fff" }}
                formatter={(v: number) => [formatLKR(v), "Revenue"]}
              />
              <Bar dataKey="revenue" fill="#F97316" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Service type pie */}
      <div className="bg-[#162032] rounded-xl p-4 border border-white/5">
        <h3 className="text-sm font-semibold text-white mb-4">Revenue by Service Type</h3>
        {serviceTypeData.length === 0 ? (
          <div className="text-center text-gray-500 py-8 text-sm">No line item data available</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={serviceTypeData}
                cx="50%"
                cy="50%"
                outerRadius={90}
                dataKey="value"
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                labelLine={false}
              >
                {serviceTypeData.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: "#0B1120", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }}
                formatter={(v: number) => [formatLKR(v), "Revenue"]}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: "#9ca3af" }} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Unpaid Outstanding */}
      <div className="bg-[#162032] rounded-xl p-4 border border-white/5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">Unpaid Outstanding</h3>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 text-xs font-medium bg-[#F97316]/10 hover:bg-[#F97316]/20 text-[#F97316] border border-[#F97316]/20 px-3 py-1.5 rounded-lg transition"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        </div>
        {unpaid.length === 0 ? (
          <div className="text-center text-gray-500 py-6 text-sm">No outstanding invoices</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Customer</th>
                  <th className="text-left text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Vehicle</th>
                  <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Amount Due</th>
                  <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2">Days Old</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {unpaid.map((inv) => {
                  const amountDue = inv.grandTotal - (inv.paidAmount ?? 0);
                  const daysOld = Math.floor((Date.now() - inv.createdAt.toMillis()) / 86400000);
                  return (
                    <tr key={inv.id}>
                      <td className="py-3 pr-4 text-white">{inv.customerName}</td>
                      <td className="py-3 pr-4 text-gray-400 font-mono text-xs">{inv.vehiclePlate ?? inv.plateNumber ?? "—"}</td>
                      <td className="py-3 pr-4 text-right text-amber-400 font-medium">{formatLKR(amountDue)}</td>
                      <td className={`py-3 text-right text-xs ${daysOld > 30 ? "text-red-400" : "text-gray-400"}`}>{daysOld}d</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
