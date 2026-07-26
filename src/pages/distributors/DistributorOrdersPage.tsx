import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, doc, onSnapshot, orderBy, query, Timestamp } from "firebase/firestore";
import {
  ClipboardList, Truck, AlertTriangle, Check, X, Package, Phone, ChevronDown, ChevronUp,
} from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import { safeUpdateDoc } from "../../lib/firestoreWrite";
import { LoadingBlock } from "../../components/LoadingProgress";
import type {
  DistributorOrder, DistributorOrderItem, DistributorOrderStatus, InventoryItem,
} from "../../types/auth";
import { checkStock, orderTotal, releasableItems, releaseOrder, round2 } from "../../lib/distributors";

const STATUS_CHIP: Record<DistributorOrderStatus, string> = {
  submitted: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  finalized: "bg-green-500/15 text-green-400 border-green-500/30",
  rejected:  "bg-red-500/15 text-red-400 border-red-500/30",
  cancelled: "bg-gray-500/15 text-gray-400 border-gray-500/30",
};

const STATUS_LABEL: Record<DistributorOrderStatus, string> = {
  submitted: "Awaiting review",
  finalized: "Released",
  rejected:  "Rejected",
  cancelled: "Cancelled",
};

function formatLKR(n: number): string {
  return `LKR ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateTime(ts?: Timestamp | null): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ── Review card ───────────────────────────────────────────────────────────────
// A submitted order is editable: the owner trims quantities to what they can
// actually spare (0 drops the line), then finalizes — which is the moment stock
// actually leaves the store room.

function OrderCard({
  order,
  stock,
  centerId,
  canFinalize,
  actorName,
  actorUid,
}: {
  order: DistributorOrder;
  stock: Map<string, InventoryItem>;
  centerId: string;
  canFinalize: boolean;
  actorName: string;
  actorUid: string;
}) {
  const editable = order.status === "submitted" && canFinalize;

  // Quantity edits live alongside the document rather than replacing it: null
  // means "no local edits yet". When the order document itself changes (another
  // device finalizing it, or the distributor amending before review), the edits
  // are dropped so the card never shows stale numbers.
  const [edited, setEdited] = useState<DistributorOrderItem[] | null>(null);
  const [baseline, setBaseline] = useState(order.items);
  if (baseline !== order.items) {
    setBaseline(order.items);
    setEdited(null);
  }
  const lines = edited ?? order.items;

  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(order.status === "submitted");
  const [confirmReject, setConfirmReject] = useState(false);

  const total = useMemo(() => orderTotal(releasableItems(lines)), [lines]);
  const requestedTotal = useMemo(
    () => round2(order.items.reduce((sum, i) => sum + i.requestedQty * i.unitPrice, 0)),
    [order.items],
  );

  function setApproved(itemId: string, value: string) {
    const parsed = value === "" ? 0 : parseFloat(value);
    setEdited(lines.map(l => {
      if (l.itemId !== itemId) return l;
      const qty = isNaN(parsed) || parsed < 0 ? 0 : round2(parsed);
      return { ...l, approvedQty: qty, lineTotal: round2(qty * l.unitPrice) };
    }));
    setError("");
  }

  async function handleFinalize() {
    const releasing = releasableItems(lines);
    if (releasing.length === 0) {
      setError("Nothing to release — set at least one quantity above zero, or reject the order.");
      return;
    }
    const blocked = checkStock(lines, stock);
    if (blocked) { setError(blocked); return; }

    setBusy(true);
    setError("");
    try {
      await releaseOrder({ ...order, items: lines }, stock, { centerId, userName: actorName, uid: actorUid }, reviewNote);
    } catch {
      setError("Could not finalize the order. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    setBusy(true);
    setError("");
    try {
      await safeUpdateDoc(doc(db, "servicecenters", centerId, "distributorOrders", order.id), {
        status: "rejected",
        reviewNote: reviewNote.trim() || null,
        reviewedAt: Timestamp.now(),
        reviewedBy: actorUid,
        reviewedByName: actorName,
      });
      setConfirmReject(false);
    } catch {
      setError("Could not reject the order. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-[#162032] border border-white/10 rounded-2xl overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-start justify-between gap-3 p-4 text-left hover:bg-white/[0.02] transition"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-semibold text-white">{order.orderNumber}</span>
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STATUS_CHIP[order.status]}`}>
              {STATUS_LABEL[order.status]}
            </span>
            {order.createdVia === "staff" && (
              <span className="text-xs px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-gray-400">
                Direct release
              </span>
            )}
          </div>
          <p className="text-sm text-gray-300 mt-1">{order.distributorName}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {order.items.length === 1 ? "1 line" : `${order.items.length} lines`} · {formatDateTime(order.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="text-right">
            <p className="text-sm font-semibold text-white">
              {formatLKR(order.status === "submitted" ? total : order.total)}
            </p>
            {order.status === "submitted" && total !== requestedTotal && (
              <p className="text-xs text-gray-500">requested {formatLKR(requestedTotal)}</p>
            )}
          </div>
          {expanded
            ? <ChevronUp className="h-4 w-4 text-gray-500" />
            : <ChevronDown className="h-4 w-4 text-gray-500" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-white/10 p-4 space-y-4">
          {order.distributorPhone && (
            <a
              href={`tel:${order.distributorPhone}`}
              className="inline-flex items-center gap-1.5 text-xs text-[#F97316] hover:text-[#fb923c]"
            >
              <Phone className="h-3.5 w-3.5" /> {order.distributorPhone}
            </a>
          )}

          {order.note && (
            <div className="bg-[#0B1120] border border-white/5 rounded-lg px-3 py-2">
              <p className="text-xs text-gray-500 mb-0.5">Note from the distributor</p>
              <p className="text-sm text-gray-300">{order.note}</p>
            </div>
          )}

          {/* Lines */}
          <div className="space-y-2">
            {lines.map(line => {
              const item = stock.get(line.itemId);
              const short = item != null && item.currentQty < line.approvedQty;
              return (
                <div
                  key={line.itemId}
                  className="bg-[#0B1120] border border-white/5 rounded-lg px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white truncate">{line.itemName}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Requested {line.requestedQty} {line.unit} · {formatLKR(line.unitPrice)} each
                      {item
                        ? <> · <span className={short ? "text-red-400" : "text-gray-500"}>{item.currentQty} {item.unit} in stock</span></>
                        : <> · <span className="text-red-400">no longer in inventory</span></>}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {editable ? (
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-500">Release</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.approvedQty}
                          onChange={e => setApproved(line.itemId, e.target.value)}
                          className={`w-24 bg-[#162032] border rounded-lg px-2.5 py-1.5 text-white text-sm focus:outline-none transition ${
                            short ? "border-red-500/50 focus:border-red-500" : "border-white/10 focus:border-[#F97316]"
                          }`}
                        />
                        <span className="text-xs text-gray-500">{line.unit}</span>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-300">
                        {line.approvedQty} {line.unit}
                      </p>
                    )}
                    <p className="text-sm font-medium text-white w-28 text-right">{formatLKR(line.lineTotal)}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between border-t border-white/10 pt-3">
            <span className="text-sm text-gray-400">
              {order.status === "submitted" ? "Total to release" : "Total"}
            </span>
            <span className="text-base font-semibold text-white">
              {formatLKR(order.status === "submitted" ? total : order.total)}
            </span>
          </div>

          {order.status !== "submitted" && order.reviewedByName && (
            <p className="text-xs text-gray-500">
              {order.status === "finalized" ? "Released" : "Rejected"} by {order.reviewedByName} ·{" "}
              {formatDateTime(order.finalizedAt ?? order.reviewedAt)}
            </p>
          )}
          {order.status !== "submitted" && order.reviewNote && (
            <p className="text-xs text-gray-400">Note: {order.reviewNote}</p>
          )}

          {error && (
            <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}

          {editable && (
            <>
              <input
                type="text"
                value={reviewNote}
                onChange={e => setReviewNote(e.target.value)}
                placeholder="Note for the record (optional)"
                className="w-full bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-4 py-2.5 text-white placeholder-gray-600 text-sm transition"
              />

              {confirmReject ? (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-400 flex-1">Reject this order without releasing anything?</span>
                  <button
                    onClick={() => setConfirmReject(false)}
                    className="px-3 py-1.5 text-xs text-gray-400 hover:text-white border border-white/10 rounded-lg transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleReject}
                    disabled={busy}
                    className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 border border-red-500/30 rounded-lg transition disabled:opacity-60"
                  >
                    {busy ? "Rejecting…" : "Reject order"}
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={handleFinalize}
                    disabled={busy}
                    className="flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold bg-[#F97316] hover:bg-[#ea6c0f] text-white px-3 py-2.5 rounded-lg transition disabled:opacity-60"
                  >
                    <Truck className="h-4 w-4" />
                    {busy ? "Releasing…" : "Finalize & Release"}
                  </button>
                  <button
                    onClick={() => setConfirmReject(true)}
                    disabled={busy}
                    className="flex-1 flex items-center justify-center gap-1.5 text-sm font-medium bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 px-3 py-2.5 rounded-lg transition disabled:opacity-60"
                  >
                    <X className="h-4 w-4" /> Reject
                  </button>
                </div>
              )}
              <p className="text-xs text-gray-600">
                Finalizing deducts the released quantities from stock and records the movement against{" "}
                {order.distributorName}.
              </p>
            </>
          )}

          {order.status === "finalized" && (
            <p className="text-xs text-green-400/80 flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5" /> Stock has been deducted and handed over.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = "pending" | "history";

export default function DistributorOrdersPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const centerId = currentUser?.centerId ?? "";
  const actorName = currentUser?.displayName ?? currentUser?.email ?? "Staff";
  const actorUid = currentUser?.uid ?? "";

  const canView     = usePermission("distributors.viewOrders");
  const canFinalize = usePermission("distributors.finalizeOrders");

  const [orders, setOrders] = useState<DistributorOrder[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("pending");

  useEffect(() => {
    if (!centerId) return;
    const q = query(
      collection(db, "servicecenters", centerId, "distributorOrders"),
      orderBy("createdAt", "desc"),
    );
    return onSnapshot(q, snap => {
      setOrders(snap.docs.map(d => ({ id: d.id, ...d.data() } as DistributorOrder)));
      setLoading(false);
    }, () => setLoading(false));
  }, [centerId]);

  useEffect(() => {
    if (!centerId) return;
    return onSnapshot(collection(db, "servicecenters", centerId, "inventory"), snap => {
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() } as InventoryItem)));
    }, () => setItems([]));
  }, [centerId]);

  const stock = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);

  const visible = useMemo(
    () => orders.filter(o => (tab === "pending" ? o.status === "submitted" : o.status !== "submitted")),
    [orders, tab],
  );
  const pendingCount = orders.filter(o => o.status === "submitted").length;

  if (!canView) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <ClipboardList className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-gray-400">You don't have permission to view distributor orders.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <PageHeader
        icon={<ClipboardList className="w-5 h-5" />}
        title="Distributor Orders"
        actions={
          <button
            onClick={() => navigate("/distributors")}
            className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium px-4 py-2.5 rounded-xl transition text-sm"
          >
            <Truck className="h-4 w-4" />
            Distributors
          </button>
        }
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
                  {key === "pending" ? `To review (${pendingCount})` : "History"}
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
              {tab === "pending" ? "No orders waiting for review" : "Nothing in the history yet"}
            </p>
            {tab === "pending" && orders.length === 0 && (
              <p className="text-sm text-gray-500 max-w-sm">
                Orders show up here as soon as a distributor sends one from their catalog link.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map(order => (
              <OrderCard
                key={order.id}
                order={order}
                stock={stock}
                centerId={centerId}
                canFinalize={canFinalize}
                actorName={actorName}
                actorUid={actorUid}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
