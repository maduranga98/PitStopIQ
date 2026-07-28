import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, doc, onSnapshot, Timestamp } from "firebase/firestore";
import {
  ClipboardList, Send, Truck, Trash2, Check, AlertTriangle, X,
} from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import { LoadingBlock } from "../../components/LoadingProgress";
import type { PurchaseOrderPlan, ServiceCenter } from "../../types/auth";
import { deletePlan, sendPlanSms } from "../../lib/purchaseOrderPlans";

// Purchase orders planned from a low-stock alert live here until the delivery
// actually arrives — at which point recordSupply() books it in and the plan
// is deleted. Nothing here is a permanent record; the goods-received note is.

function formatDate(ts?: Timestamp | null): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const STATUS_CHIP: Record<string, string> = {
  draft: "bg-gray-500/15 text-gray-300 border-gray-500/30",
  sent:  "bg-blue-500/15 text-blue-400 border-blue-500/30",
};

function ConfirmDelete({
  plan, onConfirm, onClose, loading,
}: {
  plan: PurchaseOrderPlan;
  onConfirm: () => void;
  onClose: () => void;
  loading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-start gap-3 mb-5">
          <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-base font-semibold text-white">Discard Order Plan</h3>
            <p className="text-sm text-gray-400 mt-1">
              Discard the plan for <strong className="text-white">{plan.supplierCompany}</strong>? Nothing was
              ordered or received — this just clears the draft.
            </p>
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
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold py-2.5 px-4 rounded-lg transition text-sm"
          >
            {loading ? "Discarding…" : "Discard"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PurchaseOrdersPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const centerId = currentUser?.centerId ?? "";
  const canPlan = usePermission("suppliers.planOrders");
  const canRecord = usePermission("suppliers.recordSupply");

  const [plans, setPlans] = useState<PurchaseOrderPlan[]>([]);
  const [center, setCenter] = useState<Partial<ServiceCenter> | null>(null);
  const [loading, setLoading] = useState(true);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PurchaseOrderPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!centerId || !canPlan) { setLoading(false); return; }
    return onSnapshot(collection(db, "servicecenters", centerId, "purchaseOrderPlans"), snap => {
      setPlans(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() } as PurchaseOrderPlan))
          .sort((a, b) => (b.updatedAt?.toMillis() ?? b.createdAt?.toMillis() ?? 0)
            - (a.updatedAt?.toMillis() ?? a.createdAt?.toMillis() ?? 0)),
      );
      setLoading(false);
    }, () => setLoading(false));
  }, [centerId, canPlan]);

  // Center contact details, used in the SMS body.
  useEffect(() => {
    if (!centerId) return;
    return onSnapshot(doc(db, "servicecenters", centerId), snap => {
      setCenter(snap.exists() ? (snap.data() as Partial<ServiceCenter>) : null);
    }, () => setCenter(null));
  }, [centerId]);

  async function handleSend(plan: PurchaseOrderPlan) {
    setSendingId(plan.id);
    setError("");
    try {
      await sendPlanSms(plan, center, {
        centerId,
        uid: currentUser?.uid ?? "",
        userName: currentUser?.displayName ?? currentUser?.email ?? "Staff",
      });
    } catch {
      setError(`Could not send the SMS to ${plan.supplierCompany}. Please try again.`);
    } finally {
      setSendingId(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await deletePlan(centerId, deleteTarget.supplierId);
      setDeleteTarget(null);
    } catch {
      setError("Could not discard the plan. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function markReceived(plan: PurchaseOrderPlan) {
    navigate(`/suppliers/supply?supplierId=${plan.supplierId}&planId=${plan.supplierId}`);
  }

  if (!canPlan) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <ClipboardList className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">Access Denied</h2>
          <p className="text-sm text-gray-400">You don't have permission to view purchase orders.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <PageHeader
        icon={<ClipboardList className="w-5 h-5" />}
        title="Purchase Orders"
        actions={
          <button
            onClick={() => navigate("/suppliers")}
            className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium px-4 py-2.5 rounded-xl transition text-sm"
          >
            <Truck className="h-4 w-4" /> Suppliers
          </button>
        }
      />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-5">
            <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-400">{error}</p>
            <button onClick={() => setError("")} className="ml-auto text-red-400/70 hover:text-red-300">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {loading ? (
          <LoadingBlock className="py-20" />
        ) : plans.length === 0 ? (
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-16 flex flex-col items-center gap-3 text-center">
            <ClipboardList className="h-12 w-12 text-gray-700" />
            <p className="text-gray-400 font-medium">No purchase orders planned</p>
            <p className="text-sm text-gray-500 max-w-sm">
              Start one from a low-stock item in Inventory or the Dashboard — it'll pull in everything else that
              supplier carries so you can order it all in one go.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {plans.map(plan => (
              <div key={plan.id} className="bg-[#162032] border border-white/10 rounded-2xl p-5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-white truncate">{plan.supplierCompany}</p>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STATUS_CHIP[plan.status]}`}>
                        {plan.status === "sent" ? "SMS Sent" : "Draft"}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {plan.supplierName} · {plan.supplierBrand} · {plan.supplierPhone}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {plan.lines.length} item{plan.lines.length === 1 ? "" : "s"} planned
                      {plan.smsSentAt && <> · texted {formatDate(plan.smsSentAt)}</>}
                    </p>
                    {plan.note && <p className="text-xs text-gray-400 mt-1.5">"{plan.note}"</p>}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {plan.lines.slice(0, 6).map(line => (
                    <span key={line.itemId} className="text-xs bg-[#0B1120] border border-white/5 rounded-full px-2.5 py-1 text-gray-300">
                      {line.itemName} · {line.requestedQty} {line.unit}
                    </span>
                  ))}
                  {plan.lines.length > 6 && (
                    <span className="text-xs text-gray-500 px-2 py-1">+{plan.lines.length - 6} more</span>
                  )}
                </div>

                <div className="flex gap-2 mt-4 flex-wrap">
                  <button
                    onClick={() => navigate(`/suppliers/orders/plan?supplierId=${plan.supplierId}`)}
                    className="flex items-center gap-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10 px-3 py-2 rounded-lg transition"
                  >
                    <ClipboardList className="h-3.5 w-3.5" /> Edit
                  </button>
                  <button
                    onClick={() => handleSend(plan)}
                    disabled={sendingId === plan.id || !plan.supplierPhone}
                    title={!plan.supplierPhone ? "This supplier has no mobile number on file" : undefined}
                    className="flex items-center gap-1.5 text-xs font-medium bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 px-3 py-2 rounded-lg transition disabled:opacity-50"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {sendingId === plan.id ? "Sending…" : plan.status === "sent" ? "Resend SMS" : "Send SMS"}
                  </button>
                  {canRecord && (
                    <button
                      onClick={() => markReceived(plan)}
                      className="flex items-center gap-1.5 text-xs font-medium bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20 px-3 py-2 rounded-lg transition"
                    >
                      <Check className="h-3.5 w-3.5" /> Mark Received
                    </button>
                  )}
                  <button
                    onClick={() => setDeleteTarget(plan)}
                    className="flex items-center gap-1.5 text-xs font-medium bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 px-3 py-2 rounded-lg transition ml-auto"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Discard
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {deleteTarget && (
        <ConfirmDelete
          plan={deleteTarget}
          loading={busy}
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
