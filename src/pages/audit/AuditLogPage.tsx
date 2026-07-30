import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { History, Search } from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import type { AuditLogAction, AuditLogEntry } from "../../types/auth";
import { LoadingBlock } from "../../components/LoadingProgress";

const ACTION_LABEL: Record<AuditLogAction, string> = {
  price_change: "Price Change",
  role_change: "Role Change",
  invoice_change: "Invoice Change",
  delete: "Deleted",
};

const ACTION_CHIP: Record<AuditLogAction, string> = {
  price_change: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  role_change: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  invoice_change: "bg-purple-500/15 text-purple-400 border-purple-500/20",
  delete: "bg-red-500/15 text-red-400 border-red-500/20",
};

const ACTION_FILTERS: Array<AuditLogAction | "All"> = [
  "All", "price_change", "role_change", "invoice_change", "delete",
];

function formatValue(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return typeof v === "number" ? v.toLocaleString("en-LK", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : String(v);
}

export default function AuditLogPage() {
  const { currentUser } = useAuth();
  const centerId = currentUser?.centerId ?? "";
  const canView = usePermission("staff.viewAuditLog");

  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<AuditLogAction | "All">("All");

  useEffect(() => {
    if (!centerId || !canView) return;
    const q = query(
      collection(db, "servicecenters", centerId, "auditLog"),
      orderBy("createdAt", "desc"),
    );
    return onSnapshot(q, snap => {
      setEntries(snap.docs.map(d => ({ id: d.id, ...d.data() } as AuditLogEntry)));
      setLoading(false);
    }, () => setLoading(false));
  }, [centerId, canView]);

  const visible = useMemo(() => {
    let list = entries;
    if (actionFilter !== "All") list = list.filter(e => e.action === actionFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(e =>
        e.entityLabel.toLowerCase().includes(q) || e.performedByName.toLowerCase().includes(q));
    }
    return list;
  }, [entries, actionFilter, search]);

  if (!canView) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <History className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-gray-400">You don't have permission to view the staff activity log.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <PageHeader icon={<History className="w-5 h-5" />} title="Staff Activity Log" />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-4 mb-6 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by record or staff name…"
              className="w-full pl-9 pr-4 py-2.5 bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-xl text-sm text-white placeholder-gray-600 transition"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {ACTION_FILTERS.map(a => (
              <button
                key={a}
                onClick={() => setActionFilter(a)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition border ${
                  actionFilter === a
                    ? "bg-[#F97316]/20 text-[#F97316] border-[#F97316]/40"
                    : "bg-[#0B1120] text-gray-400 border-white/10 hover:border-white/20"
                }`}
              >
                {a === "All" ? "All" : ACTION_LABEL[a]}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <LoadingBlock className="py-20" />
        ) : visible.length === 0 ? (
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-16 flex flex-col items-center gap-3">
            <History className="h-12 w-12 text-gray-700" />
            <p className="text-gray-400 font-medium">No activity recorded yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map(entry => (
              <div key={entry.id} className="bg-[#162032] border border-white/10 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-white truncate">{entry.entityLabel}</p>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${ACTION_CHIP[entry.action]}`}>
                        {ACTION_LABEL[entry.action]}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {entry.performedByName}
                      {entry.createdAt ? ` · ${entry.createdAt.toDate().toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}
                    </p>
                    {entry.note && <p className="text-xs text-gray-400 mt-1">{entry.note}</p>}
                  </div>
                </div>
                {entry.changes && entry.changes.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-white/5 space-y-1">
                    {entry.changes.map((c, i) => (
                      <p key={i} className="text-xs text-gray-400">
                        <span className="text-gray-500">{c.field}:</span>{" "}
                        <span className="text-gray-300">{formatValue(c.before)}</span>
                        {" → "}
                        <span className="text-white font-medium">{formatValue(c.after)}</span>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
