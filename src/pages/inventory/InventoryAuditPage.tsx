import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { History, Search } from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import type { InventoryMovement, InventoryMovementType } from "../../types/auth";
import { LoadingBlock } from "../../components/LoadingProgress";

const TYPE_LABEL: Record<InventoryMovementType, string> = {
  restock: "Restock",
  issue: "Issued",
  deduction: "Job Deduction",
  release: "Released",
  pos_sale: "Outlet Sale",
  stock_count: "Stock Count",
};

const TYPE_CHIP: Record<InventoryMovementType, string> = {
  restock: "bg-green-500/15 text-green-400 border-green-500/20",
  issue: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  deduction: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  release: "bg-purple-500/15 text-purple-400 border-purple-500/20",
  pos_sale: "bg-orange-500/15 text-orange-400 border-orange-500/20",
  stock_count: "bg-gray-500/15 text-gray-300 border-gray-500/20",
};

const TYPE_FILTERS: Array<InventoryMovementType | "All"> = [
  "All", "restock", "issue", "deduction", "release", "pos_sale", "stock_count",
];

export default function InventoryAuditPage() {
  const { currentUser } = useAuth();
  const centerId = currentUser?.centerId ?? "";
  const canView = usePermission("inventory.viewLogs");

  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<InventoryMovementType | "All">("All");

  useEffect(() => {
    if (!centerId || !canView) return;
    const q = query(
      collection(db, "servicecenters", centerId, "inventoryMovements"),
      orderBy("createdAt", "desc"),
    );
    return onSnapshot(q, snap => {
      setMovements(snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryMovement)));
      setLoading(false);
    }, () => setLoading(false));
  }, [centerId, canView]);

  const visible = useMemo(() => {
    let list = movements;
    if (typeFilter !== "All") list = list.filter(m => m.type === typeFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(m => m.itemName.toLowerCase().includes(q));
    }
    return list;
  }, [movements, typeFilter, search]);

  if (!canView) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <History className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-gray-400">You don't have permission to view the inventory audit trail.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <PageHeader icon={<History className="w-5 h-5" />} title="Inventory Audit" />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-4 mb-6 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by item name…"
              className="w-full pl-9 pr-4 py-2.5 bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-xl text-sm text-white placeholder-gray-600 transition"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {TYPE_FILTERS.map(t => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition border ${
                  typeFilter === t
                    ? "bg-[#F97316]/20 text-[#F97316] border-[#F97316]/40"
                    : "bg-[#0B1120] text-gray-400 border-white/10 hover:border-white/20"
                }`}
              >
                {t === "All" ? "All" : TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <LoadingBlock className="py-20" />
        ) : visible.length === 0 ? (
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-16 flex flex-col items-center gap-3">
            <History className="h-12 w-12 text-gray-700" />
            <p className="text-gray-400 font-medium">No movement recorded yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map(m => (
              <div key={m.id} className="bg-[#162032] border border-white/10 rounded-xl p-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-white">{m.itemName}</p>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${TYPE_CHIP[m.type]}`}>
                      {TYPE_LABEL[m.type]}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {m.performedByName}
                    {m.outletName ? ` · ${m.outletName}` : ""}
                    {m.refLabel ? ` · ${m.refLabel}` : ""}
                    {m.createdAt ? ` · ${m.createdAt.toDate().toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}
                  </p>
                  {m.note && <p className="text-xs text-gray-400 mt-1">{m.note}</p>}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={`font-semibold ${m.qtyChange > 0 ? "text-green-400" : m.qtyChange < 0 ? "text-red-400" : "text-gray-400"}`}>
                    {m.qtyChange > 0 ? "+" : ""}{m.qtyChange} {m.unit}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">{m.qtyBefore} → {m.qtyAfter}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
