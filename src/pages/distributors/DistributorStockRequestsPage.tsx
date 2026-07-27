import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, doc, onSnapshot, orderBy, query, Timestamp } from "firebase/firestore";
import {
  PackagePlus, Package, Check, X, AlertTriangle, Truck, Clock, Edit2,
} from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import { safeUpdateDoc } from "../../lib/firestoreWrite";
import { LoadingBlock } from "../../components/LoadingProgress";
import type {
  DistributorStockRequest, DistributorStockRequestStatus, InventoryItem,
} from "../../types/auth";
import { distributorPriceOf, formatLKR } from "../../lib/inventoryPricing";

// A distributor can only order what's on the shelf. When they need more, the
// portal drops the ask here — it reserves nothing, so the only decision to make
// is whether to buy more in, and to tell them either way.

const STATUS_CHIP: Record<DistributorStockRequestStatus, string> = {
  pending:      "bg-amber-500/15 text-amber-400 border-amber-500/30",
  acknowledged: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  fulfilled:    "bg-green-500/15 text-green-400 border-green-500/30",
  declined:     "bg-red-500/15 text-red-400 border-red-500/30",
};

const STATUS_LABEL: Record<DistributorStockRequestStatus, string> = {
  pending:      "Pending",
  acknowledged: "More ordered",
  fulfilled:    "Fulfilled",
  declined:     "Declined",
};

function formatDate(ts?: Timestamp | null): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// ── Decision modal ────────────────────────────────────────────────────────────

function DecideModal({
  request, status, centerId, actor, onClose,
}: {
  request: DistributorStockRequest;
  status: Exclude<DistributorStockRequestStatus, "pending">;
  centerId: string;
  actor: { uid: string; name: string };
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const title = status === "declined"
    ? "Decline Request"
    : status === "fulfilled" ? "Mark as Fulfilled" : "Acknowledge Request";
  const blurb = status === "declined"
    ? "The distributor is told you can't supply this."
    : status === "fulfilled"
      ? "Use this once the stock is in and they can order it again."
      : "Tells the distributor more stock has been ordered from your supplier.";

  async function save() {
    setBusy(true);
    setError("");
    try {
      await safeUpdateDoc(
        doc(db, "servicecenters", centerId, "distributorStockRequests", request.id),
        {
          status,
          reviewNote: note.trim() || null,
          reviewedAt: Timestamp.now(),
          reviewedBy: actor.uid,
          reviewedByName: actor.name,
        },
      );
      onClose();
    } catch {
      setError("Could not update the request. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="bg-[#0B1120] border border-white/5 rounded-xl p-4 mb-5">
          <p className="text-sm font-semibold text-white">{request.itemName}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {request.requestedQty} {request.unit} for {request.distributorName}
          </p>
        </div>

        <p className="text-xs text-gray-500 mb-4">{blurb}</p>

        <label className="block text-sm font-medium text-gray-300 mb-1.5">
          Message to the distributor <span className="text-gray-600 font-normal">(optional)</span>
        </label>
        <input
          type="text"
          value={note}
          onChange={e => setNote(e.target.value)}
          maxLength={300}
          placeholder="e.g. Arriving Thursday, I'll message you"
          className="w-full bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-4 py-2.5 text-white placeholder-gray-600 text-sm transition"
        />

        {error && (
          <p className="text-sm text-red-400 flex items-center gap-1.5 mt-3">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {error}
          </p>
        )}

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 px-4 rounded-lg transition text-sm"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy}
            className={`flex-1 disabled:opacity-60 text-white font-semibold py-2.5 px-4 rounded-lg transition text-sm ${
              status === "declined" ? "bg-red-600 hover:bg-red-700" : "bg-[#F97316] hover:bg-[#ea6c0f]"
            }`}
          >
            {busy ? "Saving…" : title}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = "pending" | "history";

export default function DistributorStockRequestsPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const centerId = currentUser?.centerId ?? "";
  const canManage = usePermission("distributors.manageStockRequests");
  const canViewOrders = usePermission("distributors.viewOrders");
  const canEditInventory = usePermission("inventory.edit");

  const [requests, setRequests] = useState<DistributorStockRequest[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("pending");
  const [decision, setDecision] = useState<{
    request: DistributorStockRequest;
    status: Exclude<DistributorStockRequestStatus, "pending">;
  } | null>(null);

  useEffect(() => {
    if (!centerId || !(canManage || canViewOrders)) return;
    const q = query(
      collection(db, "servicecenters", centerId, "distributorStockRequests"),
      orderBy("createdAt", "desc"),
    );
    return onSnapshot(q, snap => {
      setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() } as DistributorStockRequest)));
      setLoading(false);
    }, () => setLoading(false));
  }, [centerId, canManage, canViewOrders]);

  useEffect(() => {
    if (!centerId) return;
    return onSnapshot(collection(db, "servicecenters", centerId, "inventory"), snap => {
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryItem)));
    }, () => setItems([]));
  }, [centerId]);

  const itemsById = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);

  const visible = useMemo(
    () => requests.filter(r => (tab === "pending" ? r.status === "pending" : r.status !== "pending")),
    [requests, tab],
  );
  const pendingCount = requests.filter(r => r.status === "pending").length;

  if (!canManage && !canViewOrders) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <PackagePlus className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-gray-400">You don't have permission to view distributor stock requests.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <PageHeader
        icon={<PackagePlus className="w-5 h-5" />}
        title="Distributor Stock Requests"
        below={
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-3">
            <div className="flex bg-white/5 rounded-lg p-0.5 gap-0.5 w-fit">
              {(["pending", "history"] as Tab[]).map(key => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                    tab === key ? "bg-orange-500 text-white" : "text-gray-400 hover:text-white"
                  }`}
                >
                  {key === "pending" ? `Pending (${pendingCount})` : "History"}
                </button>
              ))}
            </div>
          </div>
        }
      />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {loading ? (
          <LoadingBlock className="py-20" />
        ) : visible.length === 0 ? (
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-16 flex flex-col items-center gap-3 text-center">
            <Package className="h-12 w-12 text-gray-700" />
            <p className="text-gray-400 font-medium">
              {tab === "pending" ? "No stock requests waiting" : "Nothing in the history yet"}
            </p>
            <p className="text-sm text-gray-500 max-w-sm">
              A distributor can only order what's in stock. When they need more, the ask lands here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map(req => {
              const item = itemsById.get(req.itemId);
              const shortfall = item ? req.requestedQty - item.currentQty : null;
              return (
                <div key={req.id} className="bg-[#162032] border border-white/10 rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="font-semibold text-white truncate">
                        {req.itemName}
                        <span className="text-gray-400 font-normal"> · {req.requestedQty} {req.unit}</span>
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <Truck className="h-3 w-3" /> {req.distributorName}
                        <span>· {formatDate(req.createdAt)}</span>
                      </p>

                      <p className="text-xs text-gray-500 mt-1.5">
                        {item ? (
                          <>
                            {item.currentQty} {item.unit} in stock now
                            {shortfall != null && shortfall > 0 && (
                              <span className="text-amber-400"> · {parseFloat(shortfall.toFixed(2))} {item.unit} short</span>
                            )}
                            <span className="text-gray-600">
                              {" "}· {formatLKR(distributorPriceOf(item))} to this distributor
                            </span>
                          </>
                        ) : (
                          <span className="text-red-400">No longer in inventory</span>
                        )}
                      </p>

                      <p className="text-xs text-gray-600 mt-1">
                        They had {req.availableQtyAtRequest} {req.unit} available when they asked.
                      </p>

                      {req.note && <p className="text-xs text-gray-400 mt-1.5">Their note: {req.note}</p>}
                      {req.status !== "pending" && (
                        <p className="text-xs text-gray-500 mt-1.5">
                          {STATUS_LABEL[req.status]}
                          {req.reviewedByName ? ` by ${req.reviewedByName}` : ""}
                          {req.reviewNote ? ` — "${req.reviewNote}"` : ""}
                        </p>
                      )}
                    </div>

                    <span className={`flex-shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${STATUS_CHIP[req.status]}`}>
                      {STATUS_LABEL[req.status]}
                    </span>
                  </div>

                  {canManage && req.status !== "fulfilled" && req.status !== "declined" && (
                    <div className="flex gap-2 mt-4 flex-wrap">
                      {req.status === "pending" && (
                        <button
                          onClick={() => setDecision({ request: req, status: "acknowledged" })}
                          className="flex-1 min-w-[9rem] flex items-center justify-center gap-1.5 text-xs font-medium bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 px-3 py-2 rounded-lg transition"
                        >
                          <Clock className="h-3.5 w-3.5" /> More Ordered
                        </button>
                      )}
                      <button
                        onClick={() => setDecision({ request: req, status: "fulfilled" })}
                        className="flex-1 min-w-[9rem] flex items-center justify-center gap-1.5 text-xs font-medium bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20 px-3 py-2 rounded-lg transition"
                      >
                        <Check className="h-3.5 w-3.5" /> Stock Is In
                      </button>
                      <button
                        onClick={() => setDecision({ request: req, status: "declined" })}
                        className="flex-1 min-w-[9rem] flex items-center justify-center gap-1.5 text-xs font-medium bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 px-3 py-2 rounded-lg transition"
                      >
                        <X className="h-3.5 w-3.5" /> Decline
                      </button>
                      {item && canEditInventory && (
                        <button
                          onClick={() => navigate(`/inventory/${item.id}/edit`)}
                          title="Open the item in inventory"
                          className="flex items-center justify-center gap-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10 px-3 py-2 rounded-lg transition"
                        >
                          <Edit2 className="h-3.5 w-3.5" /> Item
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {decision && (
        <DecideModal
          request={decision.request}
          status={decision.status}
          centerId={centerId}
          actor={{
            uid: currentUser?.uid ?? "",
            name: currentUser?.displayName ?? currentUser?.email ?? "Staff",
          }}
          onClose={() => setDecision(null)}
        />
      )}
    </div>
  );
}
