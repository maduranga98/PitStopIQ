import { useEffect, useState, useMemo } from "react";
import { collection, query, where, getDocs, Timestamp } from "firebase/firestore";
import { Download, ExternalLink } from "lucide-react";
import { db } from "../../config/firebase";
import { downloadCSV } from "../../lib/csvExport";

interface CustomerDoc {
  id: string;
  name: string;
  phone?: string;
  nic?: string;
  createdAt: Timestamp;
}

interface JobDoc {
  id: string;
  customerId: string;
  createdAt: Timestamp;
}

interface InvoiceDoc {
  id: string;
  customerId: string;
  status: "paid" | "pending" | "partial";
  grandTotal: number;
  createdAt: Timestamp;
}

interface Props {
  centerId: string;
  startDate: Date;
  endDate: Date;
}

function thisMonthBounds(): [Date, Date] {
  const now = new Date();
  return [new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)];
}

function lastMonthBounds(): [Date, Date] {
  const now = new Date();
  return [new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)];
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

export default function CustomerReport({ centerId, startDate, endDate }: Props) {
  const [customers, setCustomers] = useState<CustomerDoc[]>([]);
  const [jobs, setJobs] = useState<JobDoc[]>([]);
  const [invoices, setInvoices] = useState<InvoiceDoc[]>([]);
  const [loading, setLoading] = useState(true);

  // Load all customers
  useEffect(() => {
    if (!centerId) return;
    getDocs(collection(db, "servicecenters", centerId, "customers")).then((snap) => {
      setCustomers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as CustomerDoc)));
    });
  }, [centerId]);

  // Load jobs and invoices in period
  useEffect(() => {
    if (!centerId) return;
    setLoading(true);
    const ts = Timestamp.fromDate;
    Promise.all([
      getDocs(query(
        collection(db, "servicecenters", centerId, "jobs"),
        where("createdAt", ">=", ts(startDate)),
        where("createdAt", "<=", ts(endDate)),
      )),
      getDocs(query(
        collection(db, "servicecenters", centerId, "invoices"),
        where("createdAt", ">=", ts(startDate)),
        where("createdAt", "<=", ts(endDate)),
        where("status", "==", "paid"),
      )),
    ]).then(([jobsSnap, invSnap]) => {
      setJobs(jobsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as JobDoc)));
      setInvoices(invSnap.docs.map((d) => ({ id: d.id, ...d.data() } as InvoiceDoc)));
      setLoading(false);
    });
  }, [centerId, startDate, endDate]);

  // Jobs for last 90 days (active customers)
  const [recentJobs, setRecentJobs] = useState<JobDoc[]>([]);
  useEffect(() => {
    if (!centerId) return;
    const cutoff = daysAgo(90);
    getDocs(query(
      collection(db, "servicecenters", centerId, "jobs"),
      where("createdAt", ">=", Timestamp.fromDate(cutoff)),
    )).then((snap) => {
      setRecentJobs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as JobDoc)));
    });
  }, [centerId]);

  const [tmStart, tmEnd] = thisMonthBounds();
  const [lmStart, lmEnd] = lastMonthBounds();

  const newThisMonth = useMemo(() =>
    customers.filter((c) => {
      const t = c.createdAt?.toMillis?.() ?? 0;
      return t >= tmStart.getTime() && t <= tmEnd.getTime();
    }).length,
  [customers, tmStart, tmEnd]);

  const newLastMonth = useMemo(() =>
    customers.filter((c) => {
      const t = c.createdAt?.toMillis?.() ?? 0;
      return t >= lmStart.getTime() && t <= lmEnd.getTime();
    }).length,
  [customers, lmStart, lmEnd]);

  const activeCustomerIds = useMemo(() => new Set(recentJobs.map((j) => j.customerId)), [recentJobs]);
  const totalActive = activeCustomerIds.size;

  // Retention: customers who had jobs last month AND this month
  const lastMonthCustomerIds = useMemo(() => {
    const allJobs = [...jobs, ...recentJobs];
    return new Set(
      allJobs
        .filter((j) => { const t = j.createdAt.toMillis(); return t >= lmStart.getTime() && t <= lmEnd.getTime(); })
        .map((j) => j.customerId)
    );
  }, [jobs, recentJobs, lmStart, lmEnd]);

  const thisMonthCustomerIds = useMemo(() => {
    const allJobs = [...jobs, ...recentJobs];
    return new Set(
      allJobs
        .filter((j) => { const t = j.createdAt.toMillis(); return t >= tmStart.getTime() && t <= tmEnd.getTime(); })
        .map((j) => j.customerId)
    );
  }, [jobs, recentJobs, tmStart, tmEnd]);

  const retentionRate = useMemo(() => {
    if (lastMonthCustomerIds.size === 0) return null;
    const returned = [...lastMonthCustomerIds].filter((id) => thisMonthCustomerIds.has(id)).length;
    return (returned / lastMonthCustomerIds.size) * 100;
  }, [lastMonthCustomerIds, thisMonthCustomerIds]);

  // Top 10 by revenue
  const top10Revenue = useMemo(() => {
    const map = new Map<string, number>();
    invoices.forEach((inv) => { map.set(inv.customerId, (map.get(inv.customerId) ?? 0) + inv.grandTotal); });
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([customerId, total]) => {
        const c = customers.find((cu) => cu.id === customerId);
        return { name: c?.name ?? customerId, phone: c?.phone ?? "", total };
      });
  }, [invoices, customers]);

  // Top 10 by visits
  const top10Visits = useMemo(() => {
    const map = new Map<string, number>();
    jobs.forEach((j) => { map.set(j.customerId, (map.get(j.customerId) ?? 0) + 1); });
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([customerId, count]) => {
        const c = customers.find((cu) => cu.id === customerId);
        return { name: c?.name ?? customerId, phone: c?.phone ?? "", count };
      });
  }, [jobs, customers]);

  // Inactive 90+ days
  const inactiveCustomers = useMemo(() => {
    return customers.filter((c) => !activeCustomerIds.has(c.id));
  }, [customers, activeCustomerIds]);

  function handleExportInactive() {
    const headers = ["Customer ID", "Name", "Phone", "NIC"];
    const rows = inactiveCustomers.map((c) => [c.id, c.name, c.phone ?? "", c.nic ?? ""]);
    downloadCSV("inactive-customers.csv", headers, rows);
  }

  function whatsappLink(phone: string) {
    const cleaned = phone.replace(/\D/g, "");
    const intl = cleaned.startsWith("0") ? "94" + cleaned.slice(1) : cleaned;
    return `https://wa.me/${intl}?text=Hi%20there!%20We%20miss%20you%20at%20our%20service%20center.%20Book%20your%20next%20service%20today!`;
  }

  if (loading) return <div className="text-center text-gray-400 py-16">Loading customer data…</div>;

  const newDiff = newLastMonth > 0 ? ((newThisMonth - newLastMonth) / newLastMonth) * 100 : null;

  return (
    <div className="space-y-6">
      {/* Key metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#162032] rounded-xl p-4 border border-white/5">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">New This Month</div>
          <div className="text-3xl font-bold text-white">{newThisMonth}</div>
          {newDiff !== null && (
            <div className={`text-xs mt-0.5 ${newDiff >= 0 ? "text-green-400" : "text-red-400"}`}>
              {newDiff >= 0 ? "+" : ""}{newDiff.toFixed(0)}% vs last month
            </div>
          )}
        </div>
        <div className="bg-[#162032] rounded-xl p-4 border border-white/5">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Active Customers</div>
          <div className="text-3xl font-bold text-white">{totalActive}</div>
          <div className="text-xs text-gray-600 mt-0.5">Visited in last 90 days</div>
        </div>
        <div className="bg-[#162032] rounded-xl p-4 border border-white/5">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Retention Rate</div>
          <div className="text-3xl font-bold text-white">
            {retentionRate !== null ? `${retentionRate.toFixed(1)}%` : "—"}
          </div>
          <div className="text-xs text-gray-600 mt-0.5">Returned from last month</div>
        </div>
        <div className="bg-[#162032] rounded-xl p-4 border border-white/5">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Total Customers</div>
          <div className="text-3xl font-bold text-white">{customers.length}</div>
          <div className="text-xs text-gray-600 mt-0.5">All time</div>
        </div>
      </div>

      {/* Top tables */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-[#162032] rounded-xl p-4 border border-white/5">
          <h3 className="text-sm font-semibold text-white mb-4">Top 10 by Revenue</h3>
          {top10Revenue.length === 0 ? (
            <div className="text-center text-gray-500 py-6 text-sm">No paid invoices in period</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-xs text-gray-500 pb-2 pr-4">#</th>
                  <th className="text-left text-xs text-gray-500 pb-2 pr-4">Customer</th>
                  <th className="text-right text-xs text-gray-500 pb-2">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {top10Revenue.map((r, i) => (
                  <tr key={r.name}>
                    <td className="py-2.5 pr-4 text-gray-600 text-xs">{i + 1}</td>
                    <td className="py-2.5 pr-4 text-white">{r.name}</td>
                    <td className="py-2.5 text-right text-[#F97316] font-medium">
                      LKR {r.total.toLocaleString("en-LK", { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-[#162032] rounded-xl p-4 border border-white/5">
          <h3 className="text-sm font-semibold text-white mb-4">Top 10 by Visit Frequency</h3>
          {top10Visits.length === 0 ? (
            <div className="text-center text-gray-500 py-6 text-sm">No services in period</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-xs text-gray-500 pb-2 pr-4">#</th>
                  <th className="text-left text-xs text-gray-500 pb-2 pr-4">Customer</th>
                  <th className="text-right text-xs text-gray-500 pb-2">Visits</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {top10Visits.map((r, i) => (
                  <tr key={r.name}>
                    <td className="py-2.5 pr-4 text-gray-600 text-xs">{i + 1}</td>
                    <td className="py-2.5 pr-4 text-white">{r.name}</td>
                    <td className="py-2.5 text-right text-blue-400 font-bold">{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Inactive customers */}
      <div className="bg-[#162032] rounded-xl p-4 border border-white/5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Inactive Customers</h3>
            <p className="text-xs text-gray-500 mt-0.5">No service in 90+ days — {inactiveCustomers.length} customers</p>
          </div>
          <button
            onClick={handleExportInactive}
            className="flex items-center gap-1.5 text-xs font-medium bg-[#F97316]/10 hover:bg-[#F97316]/20 text-[#F97316] border border-[#F97316]/20 px-3 py-1.5 rounded-lg transition"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        </div>
        {inactiveCustomers.length === 0 ? (
          <div className="text-center text-gray-500 py-6 text-sm">All customers are active!</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Name</th>
                  <th className="text-left text-xs text-gray-500 uppercase tracking-wider pb-2 pr-4">Phone</th>
                  <th className="text-right text-xs text-gray-500 uppercase tracking-wider pb-2">Re-engage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {inactiveCustomers.slice(0, 50).map((c) => (
                  <tr key={c.id}>
                    <td className="py-2.5 pr-4 text-white">{c.name}</td>
                    <td className="py-2.5 pr-4 text-gray-400 font-mono text-xs">{c.phone ?? "—"}</td>
                    <td className="py-2.5 text-right">
                      {c.phone ? (
                        <a
                          href={whatsappLink(c.phone)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-green-400 hover:text-green-300"
                        >
                          <ExternalLink className="h-3 w-3" />
                          WhatsApp
                        </a>
                      ) : (
                        <span className="text-xs text-gray-600">No phone</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {inactiveCustomers.length > 50 && (
              <p className="text-xs text-gray-600 mt-3 text-center">
                Showing 50 of {inactiveCustomers.length} — export CSV for full list
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
