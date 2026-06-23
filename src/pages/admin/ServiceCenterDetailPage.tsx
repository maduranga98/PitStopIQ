import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  doc, getDoc, updateDoc, collection, getDocs,
  addDoc, serverTimestamp, orderBy, query, Timestamp,
} from "firebase/firestore";
import { db } from "../../config/firebase";
import {
  ArrowLeft, CheckCircle, XCircle, CreditCard, Plus,
  Phone, MapPin, Calendar, Building2,
} from "lucide-react";
import type { ServiceCenter, ServiceCenterPayment } from "../../types/auth";
import { useSuperAdmin } from "../../contexts/SuperAdminContext";

export default function ServiceCenterDetailPage() {
  const { centerId } = useParams<{ centerId: string }>();
  const navigate = useNavigate();
  const { superAdmin } = useSuperAdmin();

  const [center, setCenter] = useState<ServiceCenter | null>(null);
  const [payments, setPayments] = useState<ServiceCenterPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [blocking, setBlocking] = useState(false);

  // Payment form state
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payPeriod, setPayPeriod] = useState<"monthly" | "yearly">("monthly");
  const [payNotes, setPayNotes] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);

  useEffect(() => {
    if (!centerId) return;
    Promise.all([
      getDoc(doc(db, "servicecenters", centerId)),
      getDocs(query(collection(db, "servicecenters", centerId, "payments"), orderBy("createdAt", "desc"))),
    ]).then(([centerSnap, paymentsSnap]) => {
      if (centerSnap.exists()) {
        setCenter({ id: centerSnap.id, ...centerSnap.data() } as ServiceCenter);
      }
      setPayments(paymentsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as ServiceCenterPayment)));
      setLoading(false);
    });
  }, [centerId]);

  async function toggleBlock() {
    if (!center || !centerId) return;
    const newStatus = center.status === "blocked" ? "active" : "blocked";
    const confirmed = window.confirm(
      newStatus === "blocked"
        ? `Block "${center.name}"? They will be unable to access the system.`
        : `Unblock "${center.name}"? They will regain access.`
    );
    if (!confirmed) return;
    setBlocking(true);
    await updateDoc(doc(db, "servicecenters", centerId), { status: newStatus });
    setCenter((c) => c ? { ...c, status: newStatus } : c);
    setBlocking(false);
  }

  async function markPayment() {
    if (!centerId || !superAdmin || !payAmount) return;
    setSavingPayment(true);
    const payment: Omit<ServiceCenterPayment, "id"> = {
      centerId,
      amount: parseFloat(payAmount),
      plan: center?.plan ?? "basic",
      period: payPeriod,
      status: "paid",
      paidAt: Timestamp.now(),
      markedBy: superAdmin.id,
      markedByName: superAdmin.displayName,
      notes: payNotes || undefined,
      createdAt: Timestamp.now(),
    };
    const ref = await addDoc(collection(db, "servicecenters", centerId, "payments"), {
      ...payment,
      paidAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    });
    setPayments((prev) => [{ id: ref.id, ...payment }, ...prev]);
    setPayAmount("");
    setPayNotes("");
    setShowPaymentForm(false);
    setSavingPayment(false);
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="h-8 w-48 bg-gray-900 rounded-lg animate-pulse mb-4" />
        <div className="h-40 bg-gray-900 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (!center) {
    return (
      <div className="p-8 text-gray-400">Service center not found.</div>
    );
  }

  const isBlocked = center.status === "blocked";

  return (
    <div className="p-8 max-w-2xl">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">{center.name}</h1>
            {isBlocked ? (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">Blocked</span>
            ) : (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-500/15 text-green-400">Active</span>
            )}
          </div>
          <p className="text-sm text-gray-400 mt-1">{center.id}</p>
        </div>
        <button
          onClick={toggleBlock}
          disabled={blocking}
          className={`flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-60 ${
            isBlocked
              ? "bg-green-500/15 text-green-400 hover:bg-green-500/25"
              : "bg-red-500/15 text-red-400 hover:bg-red-500/25"
          }`}
        >
          {isBlocked ? (
            <><CheckCircle className="w-4 h-4" /> Unblock</>
          ) : (
            <><XCircle className="w-4 h-4" /> Block</>
          )}
        </button>
      </div>

      {/* Info Card */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-5 grid grid-cols-2 gap-4">
        <InfoRow icon={Phone} label="Phone" value={center.phone} />
        <InfoRow icon={MapPin} label="District" value={center.district} />
        <InfoRow icon={Building2} label="Address" value={center.address} />
        <InfoRow
          icon={Calendar}
          label="Registered"
          value={center.createdAt ? new Date((center.createdAt as unknown as Timestamp).seconds * 1000).toLocaleDateString() : "—"}
        />
        <div className="col-span-2">
          <p className="text-xs text-gray-500 mb-1">Plan</p>
          <span className={`text-sm font-medium px-3 py-1 rounded-full ${
            center.plan === "pro" ? "bg-orange-500/15 text-orange-400" : "bg-gray-800 text-gray-300"
          }`}>
            {center.plan.toUpperCase()} · {center.smsQuotaUsed}/{center.smsQuotaLimit} SMS used
          </span>
        </div>
        {center.ownerName && (
          <InfoRow icon={Building2} label="Owner" value={`${center.ownerName} · ${center.ownerPhone ?? ""}`} />
        )}
      </div>

      {/* Payments */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-orange-400" />
            Payment History
          </h2>
          <button
            onClick={() => setShowPaymentForm((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-medium text-orange-400 hover:text-orange-300 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Mark Payment
          </button>
        </div>

        {showPaymentForm && (
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 mb-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-gray-400">Amount (LKR)</label>
                <input
                  type="number"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-orange-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-400">Period</label>
                <select
                  value={payPeriod}
                  onChange={(e) => setPayPeriod(e.target.value as "monthly" | "yearly")}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-orange-500"
                >
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-400">Notes (optional)</label>
              <input
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
                placeholder="e.g. Bank transfer ref #123"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-orange-500"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={markPayment}
                disabled={savingPayment || !payAmount}
                className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white text-sm font-medium py-1.5 rounded-lg transition-colors"
              >
                {savingPayment ? "Saving…" : "Confirm Payment"}
              </button>
              <button
                onClick={() => setShowPaymentForm(false)}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium py-1.5 rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {payments.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-6">No payments recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-3 border-b border-gray-800 last:border-0">
                <div>
                  <p className="text-sm font-medium text-white">
                    LKR {p.amount.toLocaleString()}
                    <span className="text-xs text-gray-400 ml-2">{p.plan.toUpperCase()} · {p.period}</span>
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {p.paidAt ? new Date((p.paidAt as Timestamp).seconds * 1000).toLocaleDateString() : "—"}
                    {p.notes && ` · ${p.notes}`}
                  </p>
                </div>
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-500/15 text-green-400">
                  {p.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-1 flex items-center gap-1.5">
        <Icon className="w-3 h-3" />
        {label}
      </p>
      <p className="text-sm text-gray-200">{value || "—"}</p>
    </div>
  );
}
