import { useEffect, useMemo, useState } from "react";
import {
  collection, doc, getDocs, onSnapshot, orderBy, query, where, Timestamp,
} from "firebase/firestore";
import {
  ListChecks, Plus, Search, AlertTriangle, Check, X,
} from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import { safeSetDoc, safeUpdateDoc } from "../../lib/firestoreWrite";
import { nextCountNumber, finalizeStockCount } from "../../lib/stockCount";
import type { InventoryItem, StockCount, StockCountLine } from "../../types/auth";
import { LoadingBlock } from "../../components/LoadingProgress";

function round2(n: number): number {
  return parseFloat(n.toFixed(2));
}

export default function StockCountPage() {
  const { currentUser } = useAuth();
  const centerId = currentUser?.centerId ?? "";
  const uid = currentUser?.uid ?? "";
  const userName = currentUser?.displayName ?? currentUser?.email ?? "Staff";

  const canView = usePermission("inventory.stockCount");

  const [draft, setDraft] = useState<StockCount | null | undefined>(undefined);
  const [history, setHistory] = useState<StockCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState("");
  const [localLines, setLocalLines] = useState<StockCountLine[] | null>(null);

  useEffect(() => {
    if (!centerId || !canView) return;
    return onSnapshot(
      query(collection(db, "servicecenters", centerId, "stockCounts"), where("status", "==", "draft")),
      snap => {
        setDraft(snap.empty ? null : ({ id: snap.docs[0].id, ...snap.docs[0].data() } as StockCount));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [centerId, canView]);

  useEffect(() => {
    if (!centerId || !canView) return;
    return onSnapshot(
      query(
        collection(db, "servicecenters", centerId, "stockCounts"),
        where("status", "==", "finalized"),
        orderBy("finalizedAt", "desc"),
      ),
      snap => setHistory(snap.docs.map(d => ({ id: d.id, ...d.data() } as StockCount))),
      () => setHistory([]),
    );
  }, [centerId, canView]);

  // Sync local editable copy whenever a fresh draft doc arrives.
  useEffect(() => {
    if (draft) setLocalLines(draft.lines);
    else setLocalLines(null);
  }, [draft?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function startCount() {
    setStarting(true);
    setError("");
    try {
      const snap = await getDocs(
        query(collection(db, "servicecenters", centerId, "inventory"), where("isArchived", "!=", true)),
      );
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryItem));
      const lines: StockCountLine[] = items.map(item => ({
        itemId: item.id,
        itemName: item.name,
        unit: item.unit,
        systemQty: item.currentQty,
        countedQty: item.currentQty,
        variance: 0,
      }));
      const countNumber = await nextCountNumber(centerId);
      const ref = doc(collection(db, "servicecenters", centerId, "stockCounts"));
      await safeSetDoc(ref, {
        countNumber,
        status: "draft",
        lines,
        performedBy: uid,
        performedByName: userName,
        centerId,
        createdAt: Timestamp.now(),
      });
    } catch {
      setError("Could not start a stock count. Please try again.");
    } finally {
      setStarting(false);
    }
  }

  function updateCounted(itemId: string, countedQty: number) {
    setLocalLines(prev => prev?.map(l => l.itemId === itemId
      ? { ...l, countedQty, variance: round2(countedQty - l.systemQty) }
      : l) ?? null);
  }

  async function saveDraft() {
    if (!draft || !localLines) return;
    setSaving(true);
    setError("");
    try {
      await safeUpdateDoc(doc(db, "servicecenters", centerId, "stockCounts", draft.id), {
        lines: localLines,
      });
    } catch {
      setError("Could not save your progress. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleFinalize() {
    if (!draft || !localLines) return;
    setFinalizing(true);
    setError("");
    try {
      await safeUpdateDoc(doc(db, "servicecenters", centerId, "stockCounts", draft.id), { lines: localLines });
      await finalizeStockCount({ countId: draft.id, lines: localLines, actor: { centerId, uid, userName } });
      setConfirmFinalize(false);
    } catch {
      setError("Could not finalize the count. Please try again.");
    } finally {
      setFinalizing(false);
    }
  }

  const visibleLines = useMemo(() => {
    if (!localLines) return [];
    const q = search.trim().toLowerCase();
    return q ? localLines.filter(l => l.itemName.toLowerCase().includes(q)) : localLines;
  }, [localLines, search]);

  const varianceCount = useMemo(() => localLines?.filter(l => l.variance !== 0).length ?? 0, [localLines]);

  if (!canView) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <ListChecks className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-gray-400">You don't have permission to run a physical stock count.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <PageHeader
        icon={<ListChecks className="w-5 h-5" />}
        title="Physical Stock Count"
        actions={
          !draft ? (
            <button
              onClick={startCount}
              disabled={starting || loading}
              className="flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-60 text-white font-semibold px-4 py-2.5 rounded-xl transition text-sm"
            >
              <Plus className="h-4 w-4" /> {starting ? "Starting…" : "Start Stock Count"}
            </button>
          ) : undefined
        }
      />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-4 flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-300">{error}</p>
          </div>
        )}

        {loading ? (
          <LoadingBlock className="py-20" />
        ) : draft && localLines ? (
          <>
            <div className="bg-[#162032] border border-white/10 rounded-2xl p-4 mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">{draft.countNumber}</p>
                <p className="text-xs text-gray-500">
                  {localLines.length} items · {varianceCount} with a variance
                </p>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search item…"
                  className="pl-9 pr-4 py-2 bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg text-sm text-white placeholder-gray-600 transition"
                />
              </div>
            </div>

            <div className="bg-[#162032] border border-white/10 rounded-2xl overflow-hidden mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left">
                    <th className="px-4 py-3 text-gray-400 font-medium">Item</th>
                    <th className="px-4 py-3 text-gray-400 font-medium">System Qty</th>
                    <th className="px-4 py-3 text-gray-400 font-medium">Counted Qty</th>
                    <th className="px-4 py-3 text-gray-400 font-medium">Variance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {visibleLines.map(line => (
                    <tr key={line.itemId}>
                      <td className="px-4 py-3 text-white">{line.itemName}</td>
                      <td className="px-4 py-3 text-gray-300">{line.systemQty} {line.unit}</td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          step="0.01"
                          value={line.countedQty}
                          onChange={e => updateCounted(line.itemId, parseFloat(e.target.value) || 0)}
                          className="w-24 bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded px-2 py-1.5 text-white text-sm"
                        />
                      </td>
                      <td className={`px-4 py-3 font-medium ${line.variance > 0 ? "text-green-400" : line.variance < 0 ? "text-red-400" : "text-gray-500"}`}>
                        {line.variance > 0 ? "+" : ""}{line.variance}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={saveDraft}
                disabled={saving}
                className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium px-4 py-2.5 rounded-xl transition text-sm disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save Progress"}
              </button>
              <button
                onClick={() => setConfirmFinalize(true)}
                className="flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold px-4 py-2.5 rounded-xl transition text-sm"
              >
                <Check className="h-4 w-4" /> Finalize Count
              </button>
            </div>
          </>
        ) : (
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-16 flex flex-col items-center gap-3 mb-6">
            <ListChecks className="h-12 w-12 text-gray-700" />
            <p className="text-gray-400 font-medium">No stock count in progress</p>
            <p className="text-sm text-gray-500 max-w-sm text-center">
              Starting a count snapshots every active item's current quantity, then lets you walk the floor and enter
              what you actually counted.
            </p>
          </div>
        )}

        {history.length > 0 && (
          <div className="mt-8">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">History</h3>
            <div className="space-y-2">
              {history.map(count => {
                const variances = count.lines.filter(l => l.variance !== 0).length;
                return (
                  <div key={count.id} className="bg-[#162032] border border-white/10 rounded-xl p-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-white">{count.countNumber}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {count.performedByName}
                        {count.finalizedAt && ` · ${count.finalizedAt.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`}
                      </p>
                    </div>
                    <p className="text-xs text-gray-400">{count.lines.length} items · {variances} adjusted</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {confirmFinalize && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmFinalize(false)} />
          <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-start gap-3 mb-5">
              <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-base font-semibold text-white">Finalize Stock Count</h3>
                <p className="text-sm text-gray-400 mt-1">
                  This writes {varianceCount} adjusted quantit{varianceCount === 1 ? "y" : "ies"} back to inventory and
                  logs each one to the audit trail. This cannot be undone.
                </p>
              </div>
              <button onClick={() => setConfirmFinalize(false)} className="text-gray-500 hover:text-gray-300 ml-auto">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmFinalize(false)}
                className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 px-4 rounded-lg transition text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleFinalize}
                disabled={finalizing}
                className="flex-1 bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-60 text-white font-semibold py-2.5 px-4 rounded-lg transition text-sm"
              >
                {finalizing ? "Finalizing…" : "Finalize"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
