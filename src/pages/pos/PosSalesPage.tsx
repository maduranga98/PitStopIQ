import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, orderBy, query, Timestamp } from "firebase/firestore";
import { History, X, AlertTriangle, Ban } from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import { safeUpdateDoc } from "../../lib/firestoreWrite";
import type { PosSale } from "../../types/auth";
import { LoadingBlock } from "../../components/LoadingProgress";
import { formatLKR } from "../../lib/inventoryPricing";

function VoidModal({ sale, centerId, uid, userName, onClose }: {
  sale: PosSale; centerId: string; uid: string; userName: string; onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleVoid() {
    setSaving(true);
    setError("");
    try {
      await safeUpdateDoc(doc(db, "servicecenters", centerId, "posSales", sale.id), {
        status: "voided",
        voidedAt: Timestamp.now(),
        voidedBy: uid,
        voidedByName: userName,
        voidReason: reason.trim() || null,
      });
      onClose();
    } catch {
      setError("Could not void this sale. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Void {sale.saleNumber}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-sm text-gray-400 mb-4">
          Voiding marks the sale as cancelled. It does <strong className="text-white">not</strong> restore the stock
          that was deducted — adjust it separately (a restock or a stock count) if the items came back.
        </p>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">
          Reason <span className="text-gray-600 font-normal">(optional)</span>
        </label>
        <input
          type="text"
          value={reason}
          onChange={e => setReason(e.target.value)}
          className="w-full bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-4 py-2.5 text-white placeholder-gray-600 text-sm transition"
        />
        {error && (
          <p className="text-sm text-red-400 flex items-center gap-1.5 mt-3">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {error}
          </p>
        )}
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 px-4 rounded-lg transition text-sm">
            Cancel
          </button>
          <button
            onClick={handleVoid}
            disabled={saving}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold py-2.5 px-4 rounded-lg transition text-sm"
          >
            {saving ? "Voiding…" : "Void Sale"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PosSalesPage() {
  const { currentUser } = useAuth();
  const centerId = currentUser?.centerId ?? "";

  const canView = usePermission("pos.viewSales");
  const canVoid = usePermission("pos.void");

  const [sales, setSales] = useState<PosSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [voidTarget, setVoidTarget] = useState<PosSale | null>(null);
  const [filterOutlet, setFilterOutlet] = useState("All");

  useEffect(() => {
    if (!centerId) return;
    return onSnapshot(
      query(collection(db, "servicecenters", centerId, "posSales"), orderBy("createdAt", "desc")),
      snap => {
        setSales(snap.docs.map(d => ({ id: d.id, ...d.data() } as PosSale)));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [centerId]);

  const outletNames = useMemo(
    () => Array.from(new Set(sales.map(s => s.outletName))).sort(),
    [sales],
  );
  const visible = useMemo(
    () => filterOutlet === "All" ? sales : sales.filter(s => s.outletName === filterOutlet),
    [sales, filterOutlet],
  );
  const totalToday = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return visible
      .filter(s => s.status === "completed" && s.createdAt?.toDate() >= today)
      .reduce((sum, s) => sum + s.total, 0);
  }, [visible]);

  if (!canView) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <History className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-gray-400">You don't have permission to view POS sales.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <PageHeader icon={<History className="w-5 h-5" />} title="POS Sales History" />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-4 mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {["All", ...outletNames].map(name => (
              <button
                key={name}
                onClick={() => setFilterOutlet(name)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition border ${
                  filterOutlet === name
                    ? "bg-[#F97316]/20 text-[#F97316] border-[#F97316]/40"
                    : "bg-[#0B1120] text-gray-400 border-white/10 hover:border-white/20"
                }`}
              >
                {name}
              </button>
            ))}
          </div>
          <p className="text-sm text-gray-400">
            Today: <span className="text-white font-semibold">{formatLKR(totalToday)}</span>
          </p>
        </div>

        {loading ? (
          <LoadingBlock className="py-20" />
        ) : visible.length === 0 ? (
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-16 flex flex-col items-center gap-3">
            <History className="h-12 w-12 text-gray-700" />
            <p className="text-gray-400 font-medium">No sales yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map(sale => (
              <div key={sale.id} className="bg-[#162032] border border-white/10 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-white">
                      {sale.saleNumber}
                      <span className="text-gray-400 font-normal"> · {sale.outletName}</span>
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {sale.soldByName}
                      {sale.createdAt && ` · ${sale.createdAt.toDate().toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}
                      {` · ${sale.paymentMethod.replace("_", " ")}`}
                    </p>
                    <p className="text-xs text-gray-400 mt-1.5">
                      {sale.items.map(i => `${i.quantity} × ${i.itemName}`).join(", ")}
                    </p>
                    {sale.status === "voided" && (
                      <p className="text-xs text-red-400 mt-1.5">
                        Voided by {sale.voidedByName}{sale.voidReason ? ` · ${sale.voidReason}` : ""}
                      </p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`font-semibold ${sale.status === "voided" ? "text-gray-500 line-through" : "text-white"}`}>
                      {formatLKR(sale.total)}
                    </p>
                    {sale.status === "completed" && canVoid && (
                      <button
                        onClick={() => setVoidTarget(sale)}
                        className="mt-2 flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition ml-auto"
                      >
                        <Ban className="h-3 w-3" /> Void
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {voidTarget && (
        <VoidModal
          sale={voidTarget}
          centerId={centerId}
          uid={currentUser?.uid ?? ""}
          userName={currentUser?.displayName ?? currentUser?.email ?? "Staff"}
          onClose={() => setVoidTarget(null)}
        />
      )}
    </div>
  );
}
