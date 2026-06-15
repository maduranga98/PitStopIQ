import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection, query, onSnapshot, orderBy, Timestamp,
} from "firebase/firestore";
import {
  FileText, Plus, Search, LogOut, ChevronRight, TrendingUp,
} from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type { Invoice, InvoiceStatus, UserRole } from "../../types/auth";

const canManage = (role?: UserRole) =>
  role === "Owner" || role === "Manager" || role === "Cashier";

const canView = (role?: UserRole) =>
  role === "Owner" || role === "Manager" || role === "Cashier" || role === "Receptionist";

const STATUS_CHIP: Record<InvoiceStatus, string> = {
  pending: "bg-gray-500/20 text-gray-300 border border-gray-500/30",
  partial: "bg-amber-500/20 text-amber-300 border border-amber-500/30",
  paid:    "bg-green-500/20 text-green-300 border border-green-500/30",
};

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  pending: "Pending",
  partial: "Partial",
  paid:    "Paid",
};

function formatDate(ts: Timestamp): string {
  return ts.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatLKR(n: number): string {
  return `LKR ${n.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type FilterTab = "all" | InvoiceStatus;

export default function InvoiceListPage() {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!currentUser?.centerId) return;
    if (!canView(currentUser.role)) { navigate("/"); return; }

    const q = query(
      collection(db, "servicecenters", currentUser.centerId, "invoices"),
      orderBy("createdAt", "desc"),
    );
    return onSnapshot(q, (snap) => {
      setInvoices(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Invoice)));
      setLoading(false);
    });
  }, [currentUser?.centerId, currentUser?.role, navigate]);

  const filtered = useMemo(() => {
    let list = invoices;
    if (tab !== "all") list = list.filter((i) => i.status === tab);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (i) =>
          i.invoiceNumber.toLowerCase().includes(q) ||
          i.customerName.toLowerCase().includes(q) ||
          i.plateNumber.toLowerCase().includes(q),
      );
    }
    return list;
  }, [invoices, tab, search]);

  // Monthly revenue: sum of paid + partial (paidAmount) for current calendar month
  const monthlyRevenue = useMemo(() => {
    const now = new Date();
    return invoices
      .filter((i) => {
        if (i.status === "pending") return false;
        const d = i.createdAt?.toDate?.();
        if (!d) return false;
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      })
      .reduce((sum, i) => sum + (i.paidAmount ?? 0), 0);
  }, [invoices]);

  const tabs: { key: FilterTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "paid", label: "Paid" },
    { key: "partial", label: "Partial" },
    { key: "pending", label: "Pending" },
  ];

  return (
    <div className="min-h-screen bg-[#0B1120]">
      {/* Top Nav */}
      <nav className="bg-[#162032] border-b border-white/10 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate("/")} className="text-gray-400 hover:text-white">
                <img src="/logo.png" alt="PitStop IQ" className="h-8 w-auto" />
              </button>
              <span className="text-lg font-extrabold tracking-tight text-white hidden sm:block">
                PITSTOP <span className="text-[#F97316]">IQ</span>
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-400 hidden sm:block">{currentUser?.displayName}</span>
              <button onClick={logout} className="text-gray-400 hover:text-red-400 p-2 rounded-lg">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Invoices</h1>
            <p className="text-sm text-gray-500 mt-0.5">Billing and payment tracking</p>
          </div>
        </div>

        {/* Monthly revenue card */}
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-5 mb-6 flex items-center gap-4">
          <div className="p-3 bg-green-500/10 rounded-xl">
            <TrendingUp className="w-6 h-6 text-green-400" />
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wider">Revenue This Month</div>
            <div className="text-2xl font-bold text-white mt-0.5">{formatLKR(monthlyRevenue)}</div>
            <div className="text-xs text-gray-500 mt-0.5">Paid + partial payments received</div>
          </div>
        </div>

        {/* Filter tabs + search */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="flex gap-1 bg-[#162032] border border-white/10 rounded-xl p-1 w-fit">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  tab === t.key
                    ? "bg-[#F97316] text-white"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Search invoices…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-[#162032] border border-white/10 text-white rounded-xl text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500"
            />
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="text-center text-gray-400 py-16">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center">
            <FileText className="w-12 h-12 text-gray-600 mb-4" />
            <p className="text-gray-400 font-medium">No invoices found</p>
            <p className="text-gray-600 text-sm mt-1">
              Invoices are created automatically when a service job is marked Done.
            </p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block bg-[#162032] border border-white/10 rounded-2xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left text-xs text-gray-500 uppercase tracking-wider px-5 py-3">Invoice No.</th>
                    <th className="text-left text-xs text-gray-500 uppercase tracking-wider px-5 py-3">Date</th>
                    <th className="text-left text-xs text-gray-500 uppercase tracking-wider px-5 py-3">Customer</th>
                    <th className="text-left text-xs text-gray-500 uppercase tracking-wider px-5 py-3">Vehicle</th>
                    <th className="text-right text-xs text-gray-500 uppercase tracking-wider px-5 py-3">Grand Total</th>
                    <th className="text-right text-xs text-gray-500 uppercase tracking-wider px-5 py-3">Paid</th>
                    <th className="text-left text-xs text-gray-500 uppercase tracking-wider px-5 py-3">Status</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filtered.map((inv) => (
                    <tr
                      key={inv.id}
                      onClick={() => navigate(`/invoices/${inv.id}`)}
                      className="hover:bg-white/5 cursor-pointer transition-colors"
                    >
                      <td className="px-5 py-4 text-sm font-mono text-orange-400">{inv.invoiceNumber}</td>
                      <td className="px-5 py-4 text-sm text-gray-300">{inv.serviceDate ? formatDate(inv.serviceDate) : "—"}</td>
                      <td className="px-5 py-4 text-sm text-white">{inv.customerName}</td>
                      <td className="px-5 py-4 text-sm text-gray-300 font-mono">{inv.plateNumber}</td>
                      <td className="px-5 py-4 text-sm text-white text-right">{formatLKR(inv.grandTotal)}</td>
                      <td className="px-5 py-4 text-sm text-green-400 text-right">{formatLKR(inv.paidAmount)}</td>
                      <td className="px-5 py-4">
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_CHIP[inv.status]}`}>
                          {STATUS_LABEL[inv.status]}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <ChevronRight className="w-4 h-4 text-gray-600 ml-auto" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {filtered.map((inv) => (
                <div
                  key={inv.id}
                  onClick={() => navigate(`/invoices/${inv.id}`)}
                  className="bg-[#162032] border border-white/10 rounded-2xl p-4 cursor-pointer hover:border-orange-500/30 transition-colors"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="font-mono text-orange-400 text-sm">{inv.invoiceNumber}</div>
                      <div className="text-white font-medium mt-0.5">{inv.customerName}</div>
                      <div className="text-gray-400 text-xs font-mono mt-0.5">{inv.plateNumber}</div>
                    </div>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_CHIP[inv.status]}`}>
                      {STATUS_LABEL[inv.status]}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-2 pt-2 border-t border-white/5">
                    <span className="text-gray-500">{inv.serviceDate ? formatDate(inv.serviceDate) : "—"}</span>
                    <span className="text-white font-semibold">{formatLKR(inv.grandTotal)}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
