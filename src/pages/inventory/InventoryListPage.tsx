import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection, query, where, onSnapshot, doc,
  arrayUnion, arrayRemove, Timestamp, getDocs, orderBy,
} from "firebase/firestore";
import { safeUpdateDoc, safeDeleteDoc, safeSetDoc } from "../../lib/firestoreWrite";
import {
  Package, Plus, Search, Edit2, Archive,
  Trash2, AlertTriangle, X, ChevronUp,
  ChevronDown, Phone, ClipboardList, Tags,
  Truck, Check,
} from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import type { Distributor, InventoryItem, ServiceJob } from "../../types/auth";
import { LoadingBlock } from "../../components/LoadingProgress";
import {
  MAX_CATEGORY_LENGTH, buildCategoryList, isDefaultCategory, validateCategoryName,
} from "../../lib/inventoryOptions";
import { distributorUnitPrice, releaseItemDirect } from "../../lib/distributors";
import {
  distributorPriceOf, formatPrice, markedPriceOf, outletPriceOf,
  purchasePriceOf, serviceCenterPriceOf,
} from "../../lib/inventoryPricing";


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

// ── Price book cell ───────────────────────────────────────────────────────────
// The four selling prices at a glance, with the cost underneath for the roles
// allowed to see it. Service-center price leads because it's the one the
// workshop bills against every day.

function PriceCell({ item, showCost }: { item: InventoryItem; showCost: boolean }) {
  return (
    <div className="text-xs leading-relaxed">
      <p className="text-white font-medium">
        Service {formatPrice(serviceCenterPriceOf(item))}
      </p>
      <p className="text-gray-400">
        Dist {formatPrice(distributorPriceOf(item))} · Outlet {formatPrice(outletPriceOf(item))}
      </p>
      <p className="text-gray-600">
        MRP {formatPrice(markedPriceOf(item))}
        {showCost && <> · Cost {formatPrice(purchasePriceOf(item))}</>}
      </p>
    </div>
  );
}

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
      await safeUpdateDoc(doc(db, "servicecenters", centerId, "inventory", item.id), {
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

// ── Manage Categories Modal ───────────────────────────────────────────────────

function ManageCategoriesModal({
  centerId,
  categories,
  customCategories,
  itemsByCategory,
  onClose,
}: {
  centerId: string;
  categories: string[];
  customCategories: string[];
  itemsByCategory: Record<string, number>;
  onClose: () => void;
}) {
  const [newCategory, setNewCategory] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleAdd() {
    const trimmed = newCategory.trim();
    const problem = validateCategoryName(trimmed, categories);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError("");
    try {
      await safeSetDoc(
        doc(db, "servicecenters", centerId),
        { customInventoryCategories: arrayUnion(trimmed) },
        { merge: true },
      );
      setNewCategory("");
    } catch {
      setError("Could not save the category. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(category: string) {
    setBusy(true);
    setError("");
    try {
      await safeSetDoc(
        doc(db, "servicecenters", centerId),
        { customInventoryCategories: arrayRemove(category) },
        { merge: true },
      );
    } catch {
      setError("Could not remove the category. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Item Categories</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={newCategory}
            onChange={e => { setNewCategory(e.target.value); setError(""); }}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } }}
            placeholder="New category name"
            maxLength={MAX_CATEGORY_LENGTH}
            className="flex-1 bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-4 py-2.5 text-white placeholder-gray-600 text-sm transition"
          />
          <button
            onClick={handleAdd}
            disabled={busy}
            className="flex-shrink-0 flex items-center gap-1.5 bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-60 text-white font-semibold px-3 rounded-lg transition text-sm"
          >
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>

        {error && (
          <p className="text-sm text-red-400 flex items-center gap-1.5 mb-3">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {error}
          </p>
        )}

        <div className="max-h-72 overflow-y-auto space-y-1.5">
          {categories.map(cat => {
            const custom = customCategories.includes(cat) && !isDefaultCategory(cat);
            const count = itemsByCategory[cat] ?? 0;
            return (
              <div
                key={cat}
                className="flex items-center justify-between gap-3 bg-[#0B1120] border border-white/5 rounded-lg px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">{cat}</p>
                  <p className="text-xs text-gray-500">
                    {count === 1 ? "1 item" : `${count} items`}
                    {!custom && " · built-in"}
                  </p>
                </div>
                {custom && (
                  <button
                    onClick={() => handleRemove(cat)}
                    disabled={busy}
                    title={count > 0
                      ? "Removing this only takes it off the list — items already using it keep their category."
                      : "Remove category"}
                    className="p-1.5 text-gray-500 hover:text-red-400 transition rounded-lg hover:bg-red-500/5 flex-shrink-0 disabled:opacity-60"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-xs text-gray-600 mt-4">
          Built-in categories can't be removed. Removing a custom category leaves existing items untouched — it
          just stops being offered on new items.
        </p>
      </div>
    </div>
  );
}

// ── Release to Distributor Modal ──────────────────────────────────────────────

function ReleaseModal({
  item,
  distributors,
  centerId,
  userName,
  uid,
  onClose,
}: {
  item: InventoryItem;
  distributors: Distributor[];
  centerId: string;
  userName: string;
  uid: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [distributorId, setDistributorId] = useState(distributors.length === 1 ? distributors[0].id : "");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const distributor = distributors.find(d => d.id === distributorId);
  const unitPrice = distributorUnitPrice(item);
  const parsedQty = parseFloat(qty);
  const lineTotal = !isNaN(parsedQty) && parsedQty > 0 ? parsedQty * unitPrice : 0;

  async function handleRelease() {
    if (!distributor) { setError("Pick a distributor."); return; }
    if (!qty || isNaN(parsedQty) || parsedQty <= 0) { setError("Enter a positive quantity."); return; }
    if (parsedQty > item.currentQty) {
      setError(`Only ${item.currentQty} ${item.unit} in stock.`);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const orderNumber = await releaseItemDirect({
        item,
        distributor,
        quantity: parsedQty,
        note,
        actor: { centerId, userName, uid },
      });
      setDone(orderNumber);
    } catch {
      setError("Could not release the stock. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Release to Distributor</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition">
            <X className="h-5 w-5" />
          </button>
        </div>

        {done ? (
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center mx-auto mb-3">
              <Check className="h-6 w-6 text-green-400" />
            </div>
            <p className="text-sm text-white font-medium">
              Released {parsedQty} {item.unit} of {item.name}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Recorded as {done} for {distributor?.name}.
            </p>
            <div className="flex gap-3 mt-6">
              <button
                onClick={onClose}
                className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 px-4 rounded-lg transition text-sm"
              >
                Done
              </button>
              <button
                onClick={() => navigate("/distributors/orders")}
                className="flex-1 bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold py-2.5 px-4 rounded-lg transition text-sm"
              >
                View Orders
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="bg-[#0B1120] rounded-xl p-4 mb-5 border border-white/5">
              <p className="text-sm font-semibold text-white">{item.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">{item.category} · {item.unit}</p>
              <p className="text-xs text-gray-500 mt-1">
                In stock: <span className="text-white font-medium">{item.currentQty} {item.unit}</span>
                {unitPrice > 0 && <> · LKR {unitPrice.toLocaleString()} per {item.unit.toLowerCase().replace(/s$/, "")}</>}
              </p>
            </div>

            {distributors.length === 0 ? (
              <div className="text-center py-4">
                <Truck className="h-10 w-10 text-gray-700 mx-auto mb-3" />
                <p className="text-sm text-gray-400">No active distributors yet.</p>
                <button
                  onClick={() => navigate("/distributors")}
                  className="mt-4 bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold py-2.5 px-4 rounded-lg transition text-sm"
                >
                  Add a Distributor
                </button>
              </div>
            ) : (
              <>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">
                      Distributor <span className="text-red-400">*</span>
                    </label>
                    <select
                      value={distributorId}
                      onChange={e => { setDistributorId(e.target.value); setError(""); }}
                      className="w-full bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-4 py-2.5 text-white text-sm transition appearance-none"
                    >
                      <option value="">Select distributor…</option>
                      {distributors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">
                      Quantity to Release <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      max={item.currentQty}
                      value={qty}
                      onChange={e => { setQty(e.target.value); setError(""); }}
                      placeholder={`e.g. 5 ${item.unit}`}
                      className="w-full bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-4 py-2.5 text-white placeholder-gray-600 text-sm transition"
                    />
                    {lineTotal > 0 && (
                      <p className="text-xs text-gray-500 mt-1">
                        Value: <span className="text-white">LKR {lineTotal.toLocaleString()}</span>
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">
                      Note <span className="text-gray-600 font-normal">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={note}
                      onChange={e => setNote(e.target.value)}
                      placeholder="e.g. Collected in person, paid cash"
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
                    onClick={handleRelease}
                    disabled={saving}
                    className="flex-1 bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-60 text-white font-semibold py-2.5 px-4 rounded-lg transition text-sm flex items-center justify-center gap-2"
                  >
                    <Truck className="h-4 w-4" />
                    {saving ? "Releasing…" : "Release Stock"}
                  </button>
                </div>
              </>
            )}
          </>
        )}
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

  const canViewInventory    = usePermission("inventory.view");
  const canCreateInventory  = usePermission("inventory.create");
  const canEditInventory    = usePermission("inventory.edit");
  const canDeleteInventory  = usePermission("inventory.delete");
  const canRestockInventory = usePermission("inventory.restock");
  const canRequestStock     = usePermission("inventory.request");
  const canApproveRequests  = usePermission("inventory.approveRequests");
  const canManageCategories = usePermission("inventory.manageCategories");
  const canReleaseStock     = usePermission("distributors.release");
  // What the workshop paid is commercially sensitive — it rides with the right
  // to change an item's price book rather than with plain read access.
  const canViewCost         = usePermission("inventory.edit");

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);


  // Filters & sort
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("All");
  const [statusFilter, setStatusFilter] = useState<"All" | "LowOut">("All");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Category options: built-ins + the center's custom list
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [distributors, setDistributors] = useState<Distributor[]>([]);

  // Modals
  const [restockItem, setRestockItem] = useState<InventoryItem | null>(null);
  // Held by id, not by value: releasing deducts stock, so the modal has to see
  // the live quantity rather than whatever it was when the modal opened.
  const [releaseItemId, setReleaseItemId] = useState<string | null>(null);
  const [manageCategories, setManageCategories] = useState(false);
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
      const unsub2 = onSnapshot(q2, snap2 => {
        setItems(
          snap2.docs
            .map(d => ({ id: d.id, ...d.data() } as InventoryItem))
            .filter(i => !i.isArchived)
        );
        setLoading(false);
      }, () => {
        // Both queries failed — stop loading and show empty state
        setLoading(false);
      });
      return unsub2;
    });
  }, [centerId]);

  // Custom categories live on the center doc — listen so the manage-categories
  // modal reflects an add/remove without a reload.
  useEffect(() => {
    if (!centerId) return;
    return onSnapshot(doc(db, "servicecenters", centerId), snap => {
      const custom = (snap.data() as { customInventoryCategories?: string[] } | undefined)?.customInventoryCategories;
      setCustomCategories(custom ?? []);
    }, () => setCustomCategories([]));
  }, [centerId]);

  // Active distributors, for the release action. Roles that can't release stock
  // also can't read the collection, so don't even open the listener for them.
  useEffect(() => {
    if (!centerId || !canReleaseStock) return;
    return onSnapshot(collection(db, "servicecenters", centerId, "distributors"), snap => {
      setDistributors(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() } as Distributor))
          .filter(d => d.isActive !== false)
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    }, () => setDistributors([]));
  }, [centerId, canReleaseStock]);

  const categories = useMemo(
    () => buildCategoryList(customCategories, items.map(i => i.category)),
    [customCategories, items],
  );

  const releaseTarget = useMemo(
    () => (releaseItemId ? items.find(i => i.id === releaseItemId) ?? null : null),
    [releaseItemId, items],
  );

  const itemsByCategory = useMemo(() => {
    const counts: Record<string, number> = {};
    items.forEach(i => { counts[i.category] = (counts[i.category] ?? 0) + 1; });
    return counts;
  }, [items]);

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
      await safeUpdateDoc(doc(db, "servicecenters", centerId, "inventory", archiveTarget.id), {
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
      await safeDeleteDoc(doc(db, "servicecenters", centerId, "inventory", deleteTarget.id));
      setDeleteTarget(null);
    } finally {
      setModalLoading(false);
    }
  }

  if (!canViewInventory) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <Package className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-gray-400">You don't have permission to view Inventory.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <PageHeader
        icon={<Package className="w-5 h-5" />}
        title="Inventory"
        actions={
          <div className="flex items-center gap-2">
            {canManageCategories && (
              <button
                onClick={() => setManageCategories(true)}
                className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium px-4 py-2.5 rounded-xl transition text-sm"
              >
                <Tags className="h-4 w-4" />
                Categories
              </button>
            )}
            {(canRequestStock || canApproveRequests) && (
              <button
                onClick={() => navigate("/inventory/requests")}
                className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium px-4 py-2.5 rounded-xl transition text-sm"
              >
                <ClipboardList className="h-4 w-4" />
                {canApproveRequests ? "Requests" : "Request Item"}
              </button>
            )}
            {canCreateInventory && (
              <button
                onClick={() => navigate("/inventory/add")}
                className="flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold px-4 py-2.5 rounded-xl transition text-sm"
              >
                <Plus className="h-4 w-4" />
                Add Item
              </button>
            )}
          </div>
        }
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

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
            {["All", ...categories].map(cat => (
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
          <LoadingBlock className="py-20" />
        ) : displayed.length === 0 ? (
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-16 flex flex-col items-center gap-3">
            <Package className="h-12 w-12 text-gray-700" />
            <p className="text-gray-400 font-medium">
              {items.length === 0 ? "No inventory items yet" : "No items match your filters"}
            </p>
            {items.length === 0 && canCreateInventory && (
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
                    <th className="px-5 py-3.5 text-gray-400 font-medium">Prices</th>
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
                            {(item.supplierCompany || item.supplierName) && (
                              <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1 flex-wrap">
                                {item.supplierCompany || item.supplierName}
                                {item.supplierBrand && <span className="text-gray-600">· {item.supplierBrand}</span>}
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
                          <PriceCell item={item} showCost={canViewCost} />
                        </td>
                        <td className="px-5 py-4">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${STATUS_CHIP[st]}`}>
                            {st}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center justify-end gap-2">
                            {canRestockInventory && (
                              <button
                                onClick={() => setRestockItem(item)}
                                className="flex items-center gap-1.5 text-xs font-medium bg-[#F97316]/10 hover:bg-[#F97316]/20 text-[#F97316] border border-[#F97316]/20 px-3 py-1.5 rounded-lg transition"
                              >
                                <Plus className="h-3.5 w-3.5" />
                                Add Stock
                              </button>
                            )}
                            {canReleaseStock && (
                              <button
                                onClick={() => setReleaseItemId(item.id)}
                                disabled={item.currentQty <= 0}
                                title={item.currentQty <= 0 ? "Nothing in stock to release" : "Release to a distributor"}
                                className="flex items-center gap-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10 px-3 py-1.5 rounded-lg transition disabled:opacity-40 disabled:hover:bg-white/5"
                              >
                                <Truck className="h-3.5 w-3.5" />
                                Release
                              </button>
                            )}
                            {canEditInventory && (
                              <button
                                onClick={() => navigate(`/inventory/${item.id}/edit`)}
                                className="p-1.5 text-gray-500 hover:text-white transition rounded-lg hover:bg-white/5"
                                title="Edit"
                              >
                                <Edit2 className="h-4 w-4" />
                              </button>
                            )}
                            {canEditInventory && (
                              <button
                                onClick={() => setArchiveTarget(item)}
                                className="p-1.5 text-gray-500 hover:text-amber-400 transition rounded-lg hover:bg-amber-500/5"
                                title="Archive"
                              >
                                <Archive className="h-4 w-4" />
                              </button>
                            )}
                            {canDeleteInventory && (
                              <button
                                onClick={() => initiateDelete(item)}
                                className="p-1.5 text-gray-500 hover:text-red-400 transition rounded-lg hover:bg-red-500/5"
                                title="Delete"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
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
                    <div className="bg-[#0B1120] border border-white/5 rounded-lg px-3 py-2 mb-3">
                      <PriceCell item={item} showCost={canViewCost} />
                    </div>
                    {(canRestockInventory || canEditInventory || canDeleteInventory || canReleaseStock) && (
                      <div className="flex gap-2">
                        {canRestockInventory && (
                          <button
                            onClick={() => setRestockItem(item)}
                            className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium bg-[#F97316]/10 hover:bg-[#F97316]/20 text-[#F97316] border border-[#F97316]/20 px-3 py-2 rounded-lg transition"
                          >
                            <Plus className="h-3.5 w-3.5" /> Add Stock
                          </button>
                        )}
                        {canReleaseStock && (
                          <button
                            onClick={() => setReleaseItemId(item.id)}
                            disabled={item.currentQty <= 0}
                            className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10 px-3 py-2 rounded-lg transition disabled:opacity-40"
                          >
                            <Truck className="h-3.5 w-3.5" /> Release
                          </button>
                        )}
                        {canEditInventory && (
                          <button
                            onClick={() => navigate(`/inventory/${item.id}/edit`)}
                            className="p-2 text-gray-500 hover:text-white transition rounded-lg bg-white/5"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                        )}
                        {canEditInventory && (
                          <button
                            onClick={() => setArchiveTarget(item)}
                            className="p-2 text-gray-500 hover:text-amber-400 transition rounded-lg bg-white/5"
                          >
                            <Archive className="h-4 w-4" />
                          </button>
                        )}
                        {canDeleteInventory && (
                          <button
                            onClick={() => initiateDelete(item)}
                            className="p-2 text-gray-500 hover:text-red-400 transition rounded-lg bg-white/5"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    )}
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

      {/* Release to Distributor */}
      {releaseTarget && (
        <ReleaseModal
          item={releaseTarget}
          distributors={distributors}
          centerId={centerId}
          userName={currentUser?.displayName ?? currentUser?.email ?? "Staff"}
          uid={currentUser?.uid ?? ""}
          onClose={() => setReleaseItemId(null)}
        />
      )}

      {/* Manage Categories */}
      {manageCategories && (
        <ManageCategoriesModal
          centerId={centerId}
          categories={categories}
          customCategories={customCategories}
          itemsByCategory={itemsByCategory}
          onClose={() => setManageCategories(false)}
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
              await safeUpdateDoc(doc(db, "servicecenters", centerId, "inventory", deleteTarget.id), {
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
