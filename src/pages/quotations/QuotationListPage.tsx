import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection, query, onSnapshot, orderBy, Timestamp,
} from "firebase/firestore";
import {
  FileSignature, Search, Plus, ChevronRight,
} from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import type { Quotation, QuotationStatus } from "../../types/auth";
import { LoadingBlock } from "../../components/LoadingProgress";

const STATUS_CHIP: Record<QuotationStatus, string> = {
  draft:    "bg-gray-500/20 text-gray-300 border border-gray-500/30",
  sent:     "bg-blue-500/20 text-blue-300 border border-blue-500/30",
  accepted: "bg-green-500/20 text-green-300 border border-green-500/30",
  rejected: "bg-red-500/20 text-red-300 border border-red-500/30",
  expired:  "bg-amber-500/20 text-amber-300 border border-amber-500/30",
};

const STATUS_LABEL: Record<QuotationStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Rejected",
  expired: "Expired",
};

function formatDate(ts: Timestamp): string {
  return ts.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatLKR(n: number): string {
  return `LKR ${n.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type FilterTab = "all" | QuotationStatus;

export default function QuotationListPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const canViewQuotations = usePermission("quotations.view");
  const canCreateQuotation = usePermission("quotations.create");

  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!currentUser?.centerId) return;
    const q = query(
      collection(db, "servicecenters", currentUser.centerId, "quotations"),
      orderBy("createdAt", "desc"),
    );
    return onSnapshot(q, (snap) => {
      setQuotations(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Quotation)));
      setLoading(false);
    });
  }, [currentUser?.centerId]);

  const filtered = useMemo(() => {
    let list = quotations;
    if (tab !== "all") list = list.filter((q) => q.status === tab);
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(
        (q) =>
          q.quotationNumber.toLowerCase().includes(s) ||
          q.customerName.toLowerCase().includes(s) ||
          q.plateNumber.toLowerCase().includes(s),
      );
    }
    return list;
  }, [quotations, tab, search]);

  const tabs: { key: FilterTab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "draft", label: "Draft" },
    { key: "sent", label: "Sent" },
    { key: "accepted", label: "Accepted" },
    { key: "rejected", label: "Rejected" },
    { key: "expired", label: "Expired" },
  ];

  if (!canViewQuotations) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <FileSignature className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-gray-400">You don't have permission to view Quotations.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120]">
      <PageHeader
        icon={<FileSignature className="w-5 h-5" />}
        title="Quotations"
        actions={
          canCreateQuotation ? (
            <button
              onClick={() => navigate("/quotations/new")}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-[#F97316] hover:bg-orange-600 text-white rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Quotation
            </button>
          ) : undefined
        }
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Filter tabs + search */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="flex gap-1 bg-[#162032] border border-white/10 rounded-xl p-1 w-fit overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
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
              placeholder="Search quotations…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-[#162032] border border-white/10 text-white rounded-xl text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500"
            />
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <LoadingBlock className="py-16" />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center">
            <FileSignature className="w-12 h-12 text-gray-600 mb-4" />
            <p className="text-gray-400 font-medium">No quotations found</p>
            <p className="text-gray-600 text-sm mt-1">Click "New Quotation" to create your first one.</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block bg-[#162032] border border-white/10 rounded-2xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left text-xs text-gray-500 uppercase tracking-wider px-5 py-3">Quote No.</th>
                    <th className="text-left text-xs text-gray-500 uppercase tracking-wider px-5 py-3">Date</th>
                    <th className="text-left text-xs text-gray-500 uppercase tracking-wider px-5 py-3">Customer</th>
                    <th className="text-left text-xs text-gray-500 uppercase tracking-wider px-5 py-3">Vehicle</th>
                    <th className="text-right text-xs text-gray-500 uppercase tracking-wider px-5 py-3">Grand Total</th>
                    <th className="text-left text-xs text-gray-500 uppercase tracking-wider px-5 py-3">Status</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filtered.map((q) => (
                    <tr
                      key={q.id}
                      onClick={() => navigate(`/quotations/${q.id}`)}
                      className="hover:bg-white/5 cursor-pointer transition-colors"
                    >
                      <td className="px-5 py-4 text-sm font-mono text-orange-400">{q.quotationNumber}</td>
                      <td className="px-5 py-4 text-sm text-gray-300">{q.quoteDate ? formatDate(q.quoteDate) : "—"}</td>
                      <td className="px-5 py-4 text-sm text-white">{q.customerName}</td>
                      <td className="px-5 py-4 text-sm text-gray-300 font-mono">{q.plateNumber}</td>
                      <td className="px-5 py-4 text-sm text-white text-right">{formatLKR(q.grandTotal)}</td>
                      <td className="px-5 py-4">
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_CHIP[q.status]}`}>
                          {STATUS_LABEL[q.status]}
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
              {filtered.map((q) => (
                <div
                  key={q.id}
                  onClick={() => navigate(`/quotations/${q.id}`)}
                  className="bg-[#162032] border border-white/10 rounded-2xl p-4 cursor-pointer hover:border-orange-500/30 transition-colors"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="font-mono text-orange-400 text-sm">{q.quotationNumber}</div>
                      <div className="text-white font-medium mt-0.5">{q.customerName}</div>
                      <div className="text-gray-400 text-xs font-mono mt-0.5">{q.plateNumber}</div>
                    </div>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_CHIP[q.status]}`}>
                      {STATUS_LABEL[q.status]}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-2 pt-2 border-t border-white/5">
                    <span className="text-gray-500">{q.quoteDate ? formatDate(q.quoteDate) : "—"}</span>
                    <span className="text-white font-semibold">{formatLKR(q.grandTotal)}</span>
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
