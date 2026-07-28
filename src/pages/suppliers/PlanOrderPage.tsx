import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { collection, doc, getDoc, onSnapshot, orderBy, query } from "firebase/firestore";
import {
  ClipboardList, Check, AlertTriangle, Truck, Package, Send, ArrowLeft,
} from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import { LoadingBlock } from "../../components/LoadingProgress";
import type {
  DistributorStockRequest, InventoryItem, PurchaseOrderPlan, PurchaseOrderPlanLine, ServiceCenter, Supplier,
} from "../../types/auth";
import { savePlan, sendPlanSms } from "../../lib/purchaseOrderPlans";

// Planning an order is a per-supplier job, not a per-item one: a low-stock
// alert is what starts it, but every item that supplier carries — and
// anything a distributor is waiting on — belongs on the same trip.

const inputClass =
  "w-full bg-[#0B1120] border border-white/10 focus:border-[#F97316] focus:outline-none rounded-lg px-3 py-2 text-white placeholder-gray-600 text-sm transition";

function stockStatus(item: { currentQty: number; threshold: number }): "OK" | "Low" | "Out" {
  if (item.currentQty === 0) return "Out";
  if (item.currentQty <= item.threshold) return "Low";
  return "OK";
}

const STATUS_CHIP: Record<string, string> = {
  OK:  "bg-green-500/15 text-green-400 border-green-500/20",
  Low: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  Out: "bg-red-500/15 text-red-400 border-red-500/20",
};

export default function PlanOrderPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const centerId = currentUser?.centerId ?? "";
  const canPlan = usePermission("suppliers.planOrders");
  const supplierId = searchParams.get("supplierId") ?? "";
  const highlightItemId = searchParams.get("itemId") ?? "";

  const [loading, setLoading] = useState(true);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [requests, setRequests] = useState<DistributorStockRequest[]>([]);
  const [existingPlan, setExistingPlan] = useState<PurchaseOrderPlan | null>(null);
  const [center, setCenter] = useState<Partial<ServiceCenter> | null>(null);

  const [qty, setQty] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [savedPlan, setSavedPlan] = useState<PurchaseOrderPlan | null>(null);

  useEffect(() => {
    if (!centerId || !supplierId) { setLoading(false); return; }
    getDoc(doc(db, "servicecenters", centerId, "suppliers", supplierId)).then(snap => {
      setSupplier(snap.exists() ? ({ id: snap.id, ...snap.data() } as Supplier) : null);
    }).finally(() => setLoading(false));
  }, [centerId, supplierId]);

  useEffect(() => {
    if (!centerId) return;
    return onSnapshot(doc(db, "servicecenters", centerId), snap => {
      setCenter(snap.exists() ? (snap.data() as Partial<ServiceCenter>) : null);
    }, () => setCenter(null));
  }, [centerId]);

  useEffect(() => {
    if (!centerId || !supplierId) return;
    return onSnapshot(collection(db, "servicecenters", centerId, "inventory"), snap => {
      setItems(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() } as InventoryItem))
          .filter(i => !i.isArchived && i.supplierId === supplierId)
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    }, () => setItems([]));
  }, [centerId, supplierId]);

  useEffect(() => {
    if (!centerId) return;
    const q = query(
      collection(db, "servicecenters", centerId, "distributorStockRequests"),
      orderBy("createdAt", "desc"),
    );
    return onSnapshot(q, snap => {
      setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() } as DistributorStockRequest)));
    }, () => setRequests([]));
  }, [centerId]);

  const [planChecked, setPlanChecked] = useState(false);
  useEffect(() => {
    if (!centerId || !supplierId) return;
    return onSnapshot(doc(db, "servicecenters", centerId, "purchaseOrderPlans", supplierId), snap => {
      setExistingPlan(snap.exists() ? ({ id: snap.id, ...snap.data() } as PurchaseOrderPlan) : null);
      setPlanChecked(true);
    }, () => setPlanChecked(true));
  }, [centerId, supplierId]);

  // Seed quantities: an already-saved draft wins (so a plan reopened later
  // doesn't lose its edited quantities to the low-stock suggestion), otherwise
  // every low/out item gets a suggested amount, and the item that triggered
  // this trip is guaranteed at least 1 even if it's exactly at threshold.
  // Waits for the plan lookup to resolve first so a slow plan fetch can't
  // lose the race to the default-suggestion seeding below.
  useEffect(() => {
    if (items.length === 0 || !planChecked) return;
    setQty(prev => {
      if (Object.keys(prev).length > 0) return prev;
      const seeded: Record<string, string> = {};
      if (existingPlan) {
        for (const line of existingPlan.lines) seeded[line.itemId] = String(line.requestedQty);
        return seeded;
      }
      for (const item of items) {
        const st = stockStatus(item);
        if (st === "OK" && item.id !== highlightItemId) continue;
        const suggested = Math.max(item.threshold - item.currentQty, item.id === highlightItemId ? 1 : 0);
        if (suggested > 0) seeded[item.id] = String(suggested);
      }
      return seeded;
    });
    if (existingPlan?.note) setNote(prev => prev || existingPlan.note || "");
  }, [items, existingPlan, highlightItemId, planChecked]);

  const itemsById = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);

  // Pending "please stock more" asks against items this supplier carries.
  const relevantRequests = useMemo(
    () => requests.filter(r => r.status === "pending" && itemsById.has(r.itemId)),
    [requests, itemsById],
  );

  function setLineQty(itemId: string, value: string) {
    setQty(prev => ({ ...prev, [itemId]: value }));
    setError("");
  }

  function addFromRequest(req: DistributorStockRequest) {
    setQty(prev => {
      const current = parseFloat(prev[req.itemId] ?? "0") || 0;
      return { ...prev, [req.itemId]: String(Math.max(current, req.requestedQty)) };
    });
  }

  const draftLines: PurchaseOrderPlanLine[] = useMemo(() => {
    return items
      .map(item => {
        const raw = qty[item.id];
        const q = raw ? parseFloat(raw) : 0;
        if (!q || isNaN(q) || q <= 0) return null;
        return {
          itemId: item.id,
          itemName: item.name,
          unit: item.unit,
          category: item.category,
          currentQty: item.currentQty,
          threshold: item.threshold,
          requestedQty: q,
        };
      })
      .filter((l): l is PurchaseOrderPlanLine => l !== null);
  }, [items, qty]);

  async function handleSave() {
    if (!supplier) return;
    if (draftLines.length === 0) { setError("Enter a quantity for at least one item."); return; }
    setSaving(true);
    setError("");
    try {
      await savePlan({
        supplier,
        lines: draftLines,
        note,
        existing: existingPlan,
        actor: {
          centerId,
          uid: currentUser?.uid ?? "",
          userName: currentUser?.displayName ?? currentUser?.email ?? "Staff",
        },
      });
      const planSnap = await getDoc(doc(db, "servicecenters", centerId, "purchaseOrderPlans", supplier.id));
      if (planSnap.exists()) setSavedPlan({ id: planSnap.id, ...planSnap.data() } as PurchaseOrderPlan);
    } catch {
      setError("Could not save the plan. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSendSms() {
    if (!savedPlan) return;
    setSending(true);
    setError("");
    try {
      await sendPlanSms(savedPlan, center, {
        centerId,
        uid: currentUser?.uid ?? "",
        userName: currentUser?.displayName ?? currentUser?.email ?? "Staff",
      });
      navigate("/suppliers/orders");
    } catch {
      setError("Could not send the SMS. The plan is saved — try sending again from Purchase Orders.");
    } finally {
      setSending(false);
    }
  }

  if (!canPlan) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <ClipboardList className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-gray-400">You don't have permission to plan purchase orders.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <PageHeader icon={<ClipboardList className="w-5 h-5" />} title="Plan Purchase Order" />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading ? (
          <LoadingBlock className="py-20" />
        ) : !supplier ? (
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-16 flex flex-col items-center gap-3 text-center">
            <Truck className="h-12 w-12 text-gray-700" />
            <p className="text-gray-400 font-medium">Supplier not found</p>
            <button
              onClick={() => navigate("/suppliers")}
              className="mt-2 flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold px-4 py-2 rounded-xl transition text-sm"
            >
              Back to Suppliers
            </button>
          </div>
        ) : savedPlan ? (
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 text-center">
            <div className="w-14 h-14 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center mx-auto mb-4">
              <Check className="h-7 w-7 text-green-400" />
            </div>
            <h2 className="text-lg font-bold text-white">Order plan saved</h2>
            <p className="text-sm text-gray-400 mt-2">
              {savedPlan.lines.length} item{savedPlan.lines.length === 1 ? "" : "s"} planned for {supplier.companyName}.
              Send them a text to let them know, or come back and finalize it later.
            </p>
            {error && (
              <p className="text-sm text-red-400 flex items-center justify-center gap-1.5 mt-4">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {error}
              </p>
            )}
            <div className="flex gap-3 mt-8">
              <button
                onClick={() => navigate("/suppliers/orders")}
                className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 px-4 rounded-xl transition text-sm"
              >
                View Purchase Orders
              </button>
              <button
                onClick={handleSendSms}
                disabled={sending || !supplier.mobile}
                title={!supplier.mobile ? "This supplier has no mobile number on file" : undefined}
                className="flex-1 bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-60 text-white font-semibold py-2.5 px-4 rounded-xl transition text-sm flex items-center justify-center gap-2"
              >
                <Send className="h-4 w-4" />
                {sending ? "Sending…" : "Send SMS to Supplier"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <button
              onClick={() => navigate(-1)}
              className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>

            {/* Supplier */}
            <div className="bg-[#162032] border border-white/10 rounded-2xl p-5">
              <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-2">Supplier</h2>
              <p className="text-white font-medium">{supplier.companyName}</p>
              <p className="text-xs text-gray-400 mt-0.5">{supplier.name} · {supplier.brand} · {supplier.mobile}</p>
              {existingPlan && (
                <p className="text-xs text-amber-400 mt-2">
                  Continuing an existing {existingPlan.status === "sent" ? "sent" : "draft"} plan for this supplier —
                  saving will update it.
                </p>
              )}
            </div>

            {/* Distributor requests */}
            {relevantRequests.length > 0 && (
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-5">
                <h2 className="text-sm font-semibold text-amber-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" /> Distributor Requests
                </h2>
                <p className="text-xs text-gray-400 mb-3">
                  These distributors are waiting on items this supplier carries — worth adding to the order.
                </p>
                <div className="space-y-2">
                  {relevantRequests.map(req => {
                    const item = itemsById.get(req.itemId);
                    return (
                      <div
                        key={req.id}
                        className="flex items-center justify-between gap-3 bg-[#0B1120] border border-white/5 rounded-lg px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="text-sm text-white truncate">
                            {req.itemName} <span className="text-gray-400">· {req.requestedQty} {req.unit}</span>
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {req.distributorName}
                            {item && <span> · {item.currentQty} {item.unit} in stock now</span>}
                            {req.note && <span> · "{req.note}"</span>}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => addFromRequest(req)}
                          className="flex-shrink-0 text-xs font-medium bg-[#F97316]/10 hover:bg-[#F97316]/20 text-[#F97316] border border-[#F97316]/20 px-3 py-1.5 rounded-lg transition"
                        >
                          Add to Order
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Items from this supplier */}
            <div className="bg-[#162032] border border-white/10 rounded-2xl p-5">
              <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
                Items from {supplier.companyName}
              </h2>
              {items.length === 0 ? (
                <div className="text-center py-8">
                  <Package className="h-10 w-10 text-gray-700 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">No inventory items are linked to this supplier yet.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {items.map(item => {
                    const st = stockStatus(item);
                    const highlighted = item.id === highlightItemId;
                    return (
                      <div
                        key={item.id}
                        className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 border ${
                          highlighted ? "bg-[#F97316]/5 border-[#F97316]/30" : "bg-[#0B1120] border-white/5"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm text-white font-medium truncate">{item.name}</p>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${STATUS_CHIP[st]}`}>
                              {st}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {item.category} · {item.currentQty} {item.unit} in stock · threshold {item.threshold}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={qty[item.id] ?? ""}
                            onChange={e => setLineQty(item.id, e.target.value)}
                            placeholder="0"
                            className={`${inputClass} w-24 text-right`}
                          />
                          <span className="text-xs text-gray-500 w-12">{item.unit}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Note */}
            <div className="bg-[#162032] border border-white/10 rounded-2xl p-5">
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                Note for this order <span className="text-gray-600 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={note}
                onChange={e => setNote(e.target.value)}
                maxLength={300}
                placeholder="e.g. Need brake pads urgently, rest can wait"
                className={inputClass}
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <div className="flex gap-3 pb-8">
              <button
                type="button"
                onClick={() => navigate("/suppliers")}
                className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-3 px-4 rounded-xl transition text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex-1 bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-60 text-white font-semibold py-3 px-4 rounded-xl transition text-sm flex items-center justify-center gap-2"
              >
                <ClipboardList className="h-4 w-4" />
                {saving ? "Saving…" : "Save Order Plan"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
