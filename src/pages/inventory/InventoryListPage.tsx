import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection, query, where, onSnapshot, doc, updateDoc,
  arrayUnion, Timestamp, getDocs, deleteDoc, orderBy,
} from "firebase/firestore";
import {
  Package, Plus, Search, Edit2, Archive,
  Trash2, AlertTriangle, X, ChevronUp,
  ChevronDown, Phone,
} from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type { InventoryItem, UserRole, ServiceJob } from "../../types/auth";

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORIES = ["Lubricants", "Filters", "Brake Parts", "Tyres", "Electrical", "Consumables", "Other"] as const;

const canManage = (role?: UserRole) => role === "Owner" || role === "Manager";
const canView = (role?: UserRole) =>
  role === "Owner" || role === "Manager" || role === "Cashier";

function stockStatus(item: InventoryItem): "OK" | "Low" | "Out" {
  if (item.currentQty === 0) return "Out";
  if (item.currentQty <= item.threshold) return "Low";
  return "OK";
}

const STATUS_CHIP: Record<string, string> = {
  OK:  "bg-green-500/15 text-green-400 border-green-500/20",
  Low: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  Out: "bg-red-500/15 text-red-400 border-red-500/20",
};

// ── Restock Modal ─────────────────────────────────────────────────────────────

function RestockModal({
  item,
  centerId,
  userName,
  onClose,
}: {
  item: InventoryItem;
  centerId: string;
  userName: string;
  onClose: () => void;
}) {
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleRestock() {
    const parsed = parseFloat(qty);
    if (!qty || isNaN(parsed) || parsed <= 0) {
      setError("Enter a positive quantity to add.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const newQty = parseFloat((item.currentQty + parsed).toFixed(2));
      const entry = {
        addedQty: parsed,
        addedBy: userName,
        timestamp: Timestamp.now(),
        note: note.trim() || null,
      };
      await updateDoc(doc(db, "servicecenters", centerId, "inventory", item.id), {
        currentQty: newQty,
        restockLog: arrayUnion(entry),
        updatedAt: Timestamp.now(),
      });
      onClose();
    } catch {
      setError("Failed to restock. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Add Stock</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="bg-[#0B1120] rounded-xl p-4 mb-5 border border-white/5">
          <p className="text-sm font-semibold text-white">{item.name}</p>
          <p className="text-xs text-gray-400 mt-0.5">{item.category} · {item.unit}</p>
          <p className="text-xs text-gray-500 mt-1">
            Current stock: <span className="text-white font-medium">{item.currentQty} {item.unit}</span>
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Quantity to Add <span className="text-red-400">*</span>
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={qty}
              onChange={e => setQty(e.target.value)}
              placeholder="e.g. 10"
              className="w-full bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-4 py-2.5 text-white placeholder-gray-600 text-sm transition"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Note <span className="text-gray-600 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. Purchased from Kandy Auto Parts, invoice #2341"
              className="w-full bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-4 py-2.5 text-white placeholder-gray-600 text-sm transition"
            />
          </div>
          {error && (
            <p className="text-sm text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {error}
            </p>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 px-4 rounded-lg transition text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleRestock}
            disabled={saving}
            className="flex-1 bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-60 text-white font-semibold py-2.5 px-4 rounded-lg transition text-sm flex items-center justify-center gap-2"
          >
            {saving ? (
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : <Plus className="h-4 w-4" />}
            Add Stock
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Archive / Delete Confirm Modal ────────────────────────────────────────────

function ConfirmModal({
  title,
  body,
  confirmLabel,
  confirmClass,
  onConfirm,
  onClose,
  loading,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  confirmClass: string;
  onConfirm: () => void;
  onClose: () => void;
  loading?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-start gap-3 mb-5">
          <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-base font-semibold text-white">{title}</h3>
            <div className="text-sm text-gray-400 mt-1">{body}</div>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 px-4 rounded-lg transition text-sm"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 ${confirmClass} disabled:opacity-60 text-white font-semibold py-2.5 px-4 rounded-lg transition text-sm`}
          >
            {loading ? "Processing…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type SortKey = "name" | "qty" | "status";
type SortDir = "asc" | "desc";

export default function InventoryListPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const centerId = currentUser?.centerId ?? "";
  const role = currentUser?.role;
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);


  // Filters & sort
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("All");
  const [statusFilter, setStatusFilter] = useState<"All" | "LowOut">("All");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Modals
  const [restockItem, setRestockItem] = useState<InventoryItem | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<InventoryItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InventoryItem | null>(null);
  const [deleteBlocked, setDeleteBlocked] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);

  // Real-time inventory listener
  useEffect(() => {
    if (!centerId) return;
    const q = query(
      collection(db, "servicecenters", centerId, "inventory"),
      where("isArchived", "!=", true),
      orderBy("isArchived"),
      orderBy("name"),
    );
    return onSnapshot(q, snap => {
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryItem)));
      setLoading(false);
    }, () => {
      // Fallback if index not ready: load without ordering
      const q2 = query(collection(db, "servicecenters", centerId, "inventory"));
      onSnapshot(q2, snap2 => {
        setItems(
          snap2.docs
            .map(d => ({ id: d.id, ...d.data() } as InventoryItem))
            .filter(i => !i.isArchived)
        );
        setLoading(false);
      });
    });
  }, [centerId]);

  // Derived: filtered + sorted list
  const displayed = useMemo(() => {
    let list = [...items];

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(i => i.name.toLowerCase().includes(q));
    }
    if (categoryFilter !== "All") {
      list = list.filter(i => i.category === categoryFilter);
    }
    if (statusFilter === "LowOut") {
      list = list.filter(i => stockStatus(i) !== "OK");
    }

    const statusOrder = { Out: 0, Low: 1, OK: 2 };
    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "qty") cmp = a.currentQty - b.currentQty;
      else if (sortKey === "status") cmp = statusOrder[stockStatus(a)] - statusOrder[stockStatus(b)];
      return sortDir === "asc" ? cmp : -cmp;
    });

    return list;
  }, [items, search, categoryFilter, statusFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <ChevronUp className="h-3.5 w-3.5 text-gray-600" />;
    return sortDir === "asc"
      ? <ChevronUp className="h-3.5 w-3.5 text-[#F97316]" />
      : <ChevronDown className="h-3.5 w-3.5 text-[#F97316]" />;
  }

  // Archive
  async function handleArchive() {
    if (!archiveTarget) return;
    setModalLoading(true);
    try {
      await updateDoc(doc(db, "servicecenters", centerId, "inventory", archiveTarget.id), {
        isArchived: true,
        updatedAt: Timestamp.now(),
      });
      setArchiveTarget(null);
    } finally {
      setModalLoading(false);
    }
  }

  // Delete — check if item used in last 6 months
  async function initiateDelete(item: InventoryItem) {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const recentJobsSnap = await getDocs(
      query(
        collection(db, "servicecenters", centerId, "jobs"),
        where("createdAt", ">=", Timestamp.fromDate(sixMonthsAgo))
      )
    );

    const usedInRecentJob = recentJobsSnap.docs.some(d => {
      const job = d.data() as ServiceJob;
      return (job.partsUsed ?? []).some((p) => p.itemId === item.id);
    });

    setDeleteBlocked(usedInRecentJob);
    setDeleteTarget(item);
  }

  async function handleDelete() {
    if (!deleteTarget || deleteBlocked) return;
    setModalLoading(true);
    try {
      await deleteDoc(doc(db, "servicecenters", centerId, "inventory", deleteTarget.id));
      setDeleteTarget(null);
    } finally {
      setModalLoading(false);
    }
  }

  // Access guard
  if (!canView(role)) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <p className="text-gray-400">You don't have permission to view inventory.</p>
      </div>
    );
  }

  const lowCount = items.filter(i => stockStatus(i) !== "OK").length;

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">


      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Package className="h-6 w-6 text-[#F97316]" />
              Inventory
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {items.length} item{items.length !== 1 ? "s" : ""} in stock
              {lowCount > 0 && (
                <span className="ml-2 text-amber-400 font-medium">· {lowCount} need restocking</span>
              )}
            </p>
          </div>
          {canManage(role) && (
            <button
              onClick={() => navigate("/inventory/add")}
              className="flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold px-4 py-2.5 rounded-xl transition text-sm"
            >
              <Plus className="h-4 w-4" />
              Add Item
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-4 mb-6 space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by item name…"
                className="w-full pl-9 pr-4 py-2.5 bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-xl text-sm text-white placeholder-gray-600 transition"
              />
            </div>

            {/* Status filter */}
            <div className="flex gap-2">
              <button
                onClick={() => setStatusFilter("All")}
                className={`px-3 py-2 rounded-xl text-sm font-medium transition border ${
                  statusFilter === "All"
                    ? "bg-[#F97316]/20 text-[#F97316] border-[#F97316]/40"
                    : "bg-[#0B1120] text-gray-400 border-white/10 hover:border-white/20"
                }`}
              >
                All
              </button>
              <button
                onClick={() => setStatusFilter("LowOut")}
                className={`px-3 py-2 rounded-xl text-sm font-medium transition border flex items-center gap-1.5 ${
                  statusFilter === "LowOut"
                    ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
                    : "bg-[#0B1120] text-gray-400 border-white/10 hover:border-white/20"
                }`}
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                Low &amp; Out
              </button>
            </div>
          </div>

          {/* Category filter */}
          <div className="flex flex-wrap gap-2">
            {["All", ...CATEGORIES].map(cat => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition border ${
                  categoryFilter === cat
                    ? "bg-[#F97316]/20 text-[#F97316] border-[#F97316]/40"
                    : "bg-[#0B1120] text-gray-400 border-white/10 hover:border-white/20"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <svg className="animate-spin h-8 w-8 text-[#F97316]" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : displayed.length === 0 ? (
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-16 flex flex-col items-center gap-3">
            <Package className="h-12 w-12 text-gray-700" />
            <p className="text-gray-400 font-medium">
              {items.length === 0 ? "No inventory items yet" : "No items match your filters"}
            </p>
            {canManage(role) && items.length === 0 && (
              <button
                onClick={() => navigate("/inventory/add")}
                className="mt-2 flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold px-4 py-2 rounded-xl transition text-sm"
              >
                <Plus className="h-4 w-4" /> Add First Item
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block bg-[#162032] border border-white/10 rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left">
                    <th className="px-5 py-3.5 text-gray-400 font-medium">
                      <button onClick={() => toggleSort("name")} className="flex items-center gap-1 hover:text-white transition">
                        Item Name <SortIcon k="name" />
                      </button>
                    </th>
                    <th className="px-5 py-3.5 text-gray-400 font-medium">Category</th>
                    <th className="px-5 py-3.5 text-gray-400 font-medium">Unit</th>
                    <th className="px-5 py-3.5 text-gray-400 font-medium">
                      <button onClick={() => toggleSort("qty")} className="flex items-center gap-1 hover:text-white transition">
                        Current Qty <SortIcon k="qty" />
                      </button>
                    </th>
                    <th className="px-5 py-3.5 text-gray-400 font-medium">Threshold</th>
                    <th className="px-5 py-3.5 text-gray-400 font-medium">
                      <button onClick={() => toggleSort("status")} className="flex items-center gap-1 hover:text-white transition">
                        Status <SortIcon k="status" />
                      </button>
                    </th>
                    <th className="px-5 py-3.5 text-gray-400 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {displayed.map(item => {
                    const st = stockStatus(item);
                    return (
                      <tr key={item.id} className="hover:bg-white/2 transition group">
                        <td className="px-5 py-4">
                          <div>
                            <p className="font-medium text-white">{item.name}</p>
                            {item.supplierName && (
                              <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                                {item.supplierName}
                                {item.supplierPhone && (
                                  <a
                                    href={`tel:${item.supplierPhone}`}
                                    className="inline-flex items-center gap-0.5 text-[#F97316] hover:text-[#fb923c]"
                                    onClick={e => e.stopPropagation()}
                                  >
                                    <Phone className="h-3 w-3" /> {item.supplierPhone}
                                  </a>
                                )}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-4 text-gray-300">{item.category}</td>
                        <td className="px-5 py-4 text-gray-300">{item.unit}</td>
                        <td className="px-5 py-4">
                          <span className={`font-semibold ${st === "Out" ? "text-red-400" : st === "Low" ? "text-amber-400" : "text-white"}`}>
                            {item.currentQty}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-gray-400">{item.threshold}</td>
                        <td className="px-5 py-4">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${STATUS_CHIP[st]}`}>
                            {st}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => setRestockItem(item)}
                              className="flex items-center gap-1.5 text-xs font-medium bg-[#F97316]/10 hover:bg-[#F97316]/20 text-[#F97316] border border-[#F97316]/20 px-3 py-1.5 rounded-lg transition"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              Add Stock
                            </button>
                            {canManage(role) && (
                              <>
                                <button
                                  onClick={() => navigate(`/inventory/${item.id}/edit`)}
                                  className="p-1.5 text-gray-500 hover:text-white transition rounded-lg hover:bg-white/5"
                                  title="Edit"
                                >
                                  <Edit2 className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => setArchiveTarget(item)}
                                  className="p-1.5 text-gray-500 hover:text-amber-400 transition rounded-lg hover:bg-amber-500/5"
                                  title="Archive"
                                >
                                  <Archive className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => initiateDelete(item)}
                                  className="p-1.5 text-gray-500 hover:text-red-400 transition rounded-lg hover:bg-red-500/5"
                                  title="Delete"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {displayed.map(item => {
                const st = stockStatus(item);
                return (
                  <div key={item.id} className="bg-[#162032] border border-white/10 rounded-2xl p-4">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-white">{item.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{item.category}</p>
                      </div>
                      <span className={`flex-shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${STATUS_CHIP[st]}`}>
                        {st}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm mb-3">
                      <div>
                        <span className="text-gray-500 text-xs">Qty: </span>
                        <span className={`font-semibold ${st === "Out" ? "text-red-400" : st === "Low" ? "text-amber-400" : "text-white"}`}>
                          {item.currentQty}
                        </span>
                        <span className="text-gray-500 text-xs ml-1">{item.unit}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 text-xs">Threshold: </span>
                        <span className="text-gray-300">{item.threshold}</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setRestockItem(item)}
                        className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium bg-[#F97316]/10 hover:bg-[#F97316]/20 text-[#F97316] border border-[#F97316]/20 px-3 py-2 rounded-lg transition"
                      >
                        <Plus className="h-3.5 w-3.5" /> Add Stock
                      </button>
                      {canManage(role) && (
                        <>
                          <button
                            onClick={() => navigate(`/inventory/${item.id}/edit`)}
                            className="p-2 text-gray-500 hover:text-white transition rounded-lg bg-white/5"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setArchiveTarget(item)}
                            className="p-2 text-gray-500 hover:text-amber-400 transition rounded-lg bg-white/5"
                          >
                            <Archive className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => initiateDelete(item)}
                            className="p-2 text-gray-500 hover:text-red-400 transition rounded-lg bg-white/5"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Restock Modal */}
      {restockItem && (
        <RestockModal
          item={restockItem}
          centerId={centerId}
          userName={currentUser?.displayName ?? currentUser?.email ?? "Staff"}
          onClose={() => setRestockItem(null)}
        />
      )}

      {/* Archive Confirm */}
      {archiveTarget && (
        <ConfirmModal
          title="Archive Item"
          body={
            <>
              Archive <strong className="text-white">{archiveTarget.name}</strong>? It will be hidden from the active
              inventory list but remain in historical service records.
            </>
          }
          confirmLabel="Archive"
          confirmClass="bg-amber-500 hover:bg-amber-600"
          onConfirm={handleArchive}
          onClose={() => setArchiveTarget(null)}
          loading={modalLoading}
        />
      )}

      {/* Delete Confirm */}
      {deleteTarget && (
        deleteBlocked ? (
          <ConfirmModal
            title="Cannot Delete Item"
            body={
              <>
                <strong className="text-white">{deleteTarget.name}</strong> has been used in recent services (within
                the last 6 months). Archive instead of deleting?
              </>
            }
            confirmLabel="Archive Instead"
            confirmClass="bg-amber-500 hover:bg-amber-600"
            onConfirm={async () => {
              setModalLoading(true);
              await updateDoc(doc(db, "servicecenters", centerId, "inventory", deleteTarget.id), {
                isArchived: true,
                updatedAt: Timestamp.now(),
              });
              setDeleteTarget(null);
              setModalLoading(false);
            }}
            onClose={() => setDeleteTarget(null)}
            loading={modalLoading}
          />
        ) : (
          <ConfirmModal
            title="Delete Item"
            body={
              <>
                Permanently delete <strong className="text-white">{deleteTarget.name}</strong>? This cannot be undone.
              </>
            }
            confirmLabel="Delete"
            confirmClass="bg-red-600 hover:bg-red-700"
            onConfirm={handleDelete}
            onClose={() => setDeleteTarget(null)}
            loading={modalLoading}
          />
        )
      )}
    </div>
  );
}
