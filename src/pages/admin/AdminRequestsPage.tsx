import { useEffect, useState } from "react";
import {
  collection, getDocs,
  doc, orderBy, query, serverTimestamp,
} from "firebase/firestore";
import { safeUpdateDoc, safeAddDoc } from "../../lib/firestoreWrite";
import { db } from "../../config/firebase";
import {
  Upload, CheckCircle, XCircle, ExternalLink, Clock,
  RefreshCw,
} from "lucide-react";
import type { UpgradeRequest, PaymentSlipRequest } from "../../types/auth";
import { useSuperAdmin } from "../../contexts/SuperAdminContext";

type Tab = "upgrade" | "payment";

export default function AdminRequestsPage() {
  const { superAdmin } = useSuperAdmin();
  const [tab, setTab] = useState<Tab>("upgrade");
  const [upgradeRequests, setUpgradeRequests] = useState<UpgradeRequest[]>([]);
  const [slipRequests, setSlipRequests] = useState<PaymentSlipRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [confirmingSlipId, setConfirmingSlipId] = useState<string | null>(null);
  const [viewSlip, setViewSlip] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<"pending" | "all">("pending");

  async function loadData() {
    setLoading(true);
    const [upgradeSnap, slipSnap] = await Promise.all([
      getDocs(query(collection(db, "upgradeRequests"), orderBy("createdAt", "desc"))),
      getDocs(query(collection(db, "paymentSlipRequests"), orderBy("createdAt", "desc"))),
    ]);
    setUpgradeRequests(upgradeSnap.docs.map((d) => ({ id: d.id, ...d.data() } as UpgradeRequest)));
    setSlipRequests(slipSnap.docs.map((d) => ({ id: d.id, ...d.data() } as PaymentSlipRequest)));
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  async function approveUpgrade(req: UpgradeRequest) {
    if (!superAdmin) return;
    setReviewingId(req.id);
    try {
      await safeUpdateDoc(doc(db, "upgradeRequests", req.id), {
        status: "approved",
        reviewedAt: serverTimestamp(),
        reviewedBy: superAdmin.id,
        reviewedByName: superAdmin.displayName || superAdmin.email,
      });
      await safeUpdateDoc(doc(db, "servicecenters", req.centerId), {
        plan: "pro",
        smsQuotaLimit: 1000,
      });
      await safeAddDoc(collection(db, "servicecenters", req.centerId, "payments"), {
        centerId: req.centerId,
        amount: req.amount,
        plan: "pro",
        period: req.period,
        status: "paid",
        paidAt: serverTimestamp(),
        markedBy: superAdmin.id,
        markedByName: superAdmin.displayName || superAdmin.email,
        notes: "Auto-recorded from upgrade request approval",
        upgradeRequestId: req.id,
        createdAt: serverTimestamp(),
      });
      setUpgradeRequests((prev) =>
        prev.map((r) => r.id === req.id ? { ...r, status: "approved" } : r)
      );
    } finally {
      setReviewingId(null);
    }
  }

  async function rejectUpgrade(req: UpgradeRequest) {
    if (!superAdmin) return;
    const reason = window.prompt("Rejection reason (optional):");
    setReviewingId(req.id);
    try {
      await safeUpdateDoc(doc(db, "upgradeRequests", req.id), {
        status: "rejected",
        reviewedAt: serverTimestamp(),
        reviewedBy: superAdmin.id,
        reviewedByName: superAdmin.displayName || superAdmin.email,
        ...((reason || req.notes) ? { notes: reason || req.notes } : {}),
      });
      setUpgradeRequests((prev) =>
        prev.map((r) => r.id === req.id ? { ...r, status: "rejected" } : r)
      );
    } finally {
      setReviewingId(null);
    }
  }

  async function confirmSlip(req: PaymentSlipRequest) {
    if (!superAdmin) return;
    setConfirmingSlipId(req.id);
    try {
      await safeUpdateDoc(doc(db, "paymentSlipRequests", req.id), {
        status: "confirmed",
        reviewedAt: serverTimestamp(),
        reviewedBy: superAdmin.id,
        reviewedByName: superAdmin.displayName || superAdmin.email,
      });
      await safeAddDoc(collection(db, "servicecenters", req.centerId, "payments"), {
        centerId: req.centerId,
        amount: req.amount,
        plan: req.plan,
        period: req.period,
        status: "paid",
        paidAt: serverTimestamp(),
        markedBy: superAdmin.id,
        markedByName: superAdmin.displayName || superAdmin.email,
        notes: "Confirmed from payment slip submission",
        createdAt: serverTimestamp(),
      });
      setSlipRequests((prev) =>
        prev.map((r) => r.id === req.id ? { ...r, status: "confirmed" } : r)
      );
    } finally {
      setConfirmingSlipId(null);
    }
  }

  async function rejectSlip(req: PaymentSlipRequest) {
    if (!superAdmin) return;
    const reason = window.prompt("Rejection reason (optional):");
    setConfirmingSlipId(req.id);
    try {
      await safeUpdateDoc(doc(db, "paymentSlipRequests", req.id), {
        status: "rejected",
        reviewedAt: serverTimestamp(),
        reviewedBy: superAdmin.id,
        reviewedByName: superAdmin.displayName || superAdmin.email,
        ...(reason ? { notes: reason } : {}),
      });
      setSlipRequests((prev) =>
        prev.map((r) => r.id === req.id ? { ...r, status: "rejected" } : r)
      );
    } finally {
      setConfirmingSlipId(null);
    }
  }

  const filteredUpgrade = filterStatus === "pending"
    ? upgradeRequests.filter((r) => r.status === "pending")
    : upgradeRequests;
  const filteredSlip = filterStatus === "pending"
    ? slipRequests.filter((r) => r.status === "pending")
    : slipRequests;

  const pendingUpgradeCount = upgradeRequests.filter((r) => r.status === "pending").length;
  const pendingSlipCount = slipRequests.filter((r) => r.status === "pending").length;

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Requests</h1>
          <p className="text-sm text-gray-400 mt-1">Review upgrade and payment slip submissions</p>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit">
        <TabButton
          active={tab === "upgrade"}
          onClick={() => setTab("upgrade")}
          label="Upgrade Requests"
          badge={pendingUpgradeCount}
        />
        <TabButton
          active={tab === "payment"}
          onClick={() => setTab("payment")}
          label="Payment Slips"
          badge={pendingSlipCount}
        />
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setFilterStatus("pending")}
          className={`text-xs px-3 py-1 rounded-full transition-colors ${
            filterStatus === "pending"
              ? "bg-amber-500/20 text-amber-400"
              : "text-gray-500 hover:text-gray-300"
          }`}
        >
          Pending only
        </button>
        <button
          onClick={() => setFilterStatus("all")}
          className={`text-xs px-3 py-1 rounded-full transition-colors ${
            filterStatus === "all"
              ? "bg-gray-700 text-gray-200"
              : "text-gray-500 hover:text-gray-300"
          }`}
        >
          All
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-gray-900 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : tab === "upgrade" ? (
        <UpgradeList
          requests={filteredUpgrade}
          reviewingId={reviewingId}
          onApprove={approveUpgrade}
          onReject={rejectUpgrade}
          onViewSlip={setViewSlip}
        />
      ) : (
        <SlipList
          requests={filteredSlip}
          confirmingId={confirmingSlipId}
          onConfirm={confirmSlip}
          onReject={rejectSlip}
          onViewSlip={setViewSlip}
        />
      )}

      {/* Slip lightbox */}
      {viewSlip && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setViewSlip(null)}
        >
          <div className="relative max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setViewSlip(null)}
              className="absolute -top-10 right-0 text-white/60 hover:text-white text-sm"
            >
              Close ✕
            </button>
            <img src={viewSlip} alt="payment slip" className="w-full rounded-xl shadow-2xl" />
            <a
              href={viewSlip}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 flex items-center justify-center gap-2 text-xs text-orange-400 hover:text-orange-300"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Open full size
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({
  active, onClick, label, badge,
}: { active: boolean; onClick: () => void; label: string; badge: number }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        active ? "bg-orange-500/15 text-orange-400" : "text-gray-400 hover:text-white"
      }`}
    >
      {label}
      {badge > 0 && (
        <span className="bg-amber-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
          {badge}
        </span>
      )}
    </button>
  );
}

function UpgradeList({
  requests, reviewingId, onApprove, onReject, onViewSlip,
}: {
  requests: UpgradeRequest[];
  reviewingId: string | null;
  onApprove: (r: UpgradeRequest) => void;
  onReject: (r: UpgradeRequest) => void;
  onViewSlip: (url: string) => void;
}) {
  if (requests.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center">
        <Upload className="w-8 h-8 text-gray-700 mx-auto mb-3" />
        <p className="text-sm text-gray-500">No upgrade requests</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {requests.map((req) => (
        <div key={req.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">{req.centerName}</p>
              <p className="text-sm text-gray-300 mt-0.5">
                Pro Plan — {req.period === "yearly" ? "Yearly" : "Monthly"}
                <span className="text-gray-400 ml-2">LKR {req.amount.toLocaleString()}</span>
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Payment code: <span className="font-mono text-orange-400">{req.paymentCode}</span>
                {req.createdAt && (
                  <span className="ml-2">
                    · {new Date((req.createdAt as any).seconds * 1000).toLocaleDateString()}
                  </span>
                )}
              </p>
              {req.notes && <p className="text-xs text-gray-500 mt-0.5">{req.notes}</p>}
            </div>
            <StatusBadge status={req.status} />
          </div>

          <button
            onClick={() => onViewSlip(req.slipUrl)}
            className="flex items-center gap-2 text-xs text-orange-400 hover:text-orange-300 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            View Payment Slip
          </button>

          {req.status === "pending" && (
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => onApprove(req)}
                disabled={reviewingId === req.id}
                className="flex-1 flex items-center justify-center gap-1.5 bg-green-500/15 hover:bg-green-500/25 text-green-400 text-xs font-medium py-2 rounded-lg transition disabled:opacity-60"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                {reviewingId === req.id ? "Processing…" : "Approve & Upgrade to Pro"}
              </button>
              <button
                onClick={() => onReject(req)}
                disabled={reviewingId === req.id}
                className="flex-1 flex items-center justify-center gap-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium py-2 rounded-lg transition disabled:opacity-60"
              >
                <XCircle className="w-3.5 h-3.5" />
                Reject
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function SlipList({
  requests, confirmingId, onConfirm, onReject, onViewSlip,
}: {
  requests: PaymentSlipRequest[];
  confirmingId: string | null;
  onConfirm: (r: PaymentSlipRequest) => void;
  onReject: (r: PaymentSlipRequest) => void;
  onViewSlip: (url: string) => void;
}) {
  if (requests.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center">
        <Upload className="w-8 h-8 text-gray-700 mx-auto mb-3" />
        <p className="text-sm text-gray-500">No payment slip submissions</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {requests.map((req) => (
        <div key={req.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">{req.centerName}</p>
              <p className="text-sm text-gray-300 mt-0.5">
                {req.plan.toUpperCase()} Plan — {req.period === "yearly" ? "Yearly" : "Monthly"}
                <span className="text-gray-400 ml-2">LKR {req.amount.toLocaleString()}</span>
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Payment code: <span className="font-mono text-orange-400">{req.paymentCode}</span>
                {req.createdAt && (
                  <span className="ml-2">
                    · {new Date((req.createdAt as any).seconds * 1000).toLocaleDateString()}
                  </span>
                )}
              </p>
              {req.notes && <p className="text-xs text-gray-500 mt-0.5">{req.notes}</p>}
            </div>
            <StatusBadgeSlip status={req.status} />
          </div>

          <button
            onClick={() => onViewSlip(req.slipUrl)}
            className="flex items-center gap-2 text-xs text-orange-400 hover:text-orange-300 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            View Payment Slip
          </button>

          {req.status === "pending" && (
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => onConfirm(req)}
                disabled={confirmingId === req.id}
                className="flex-1 flex items-center justify-center gap-1.5 bg-green-500/15 hover:bg-green-500/25 text-green-400 text-xs font-medium py-2 rounded-lg transition disabled:opacity-60"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                {confirmingId === req.id ? "Processing…" : "Confirm Payment"}
              </button>
              <button
                onClick={() => onReject(req)}
                disabled={confirmingId === req.id}
                className="flex-1 flex items-center justify-center gap-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium py-2 rounded-lg transition disabled:opacity-60"
              >
                <XCircle className="w-3.5 h-3.5" />
                Reject
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "pending") return (
    <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 whitespace-nowrap">
      <Clock className="w-3 h-3" /> Pending
    </span>
  );
  if (status === "approved") return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-500/15 text-green-400">Approved</span>
  );
  return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">Rejected</span>;
}

function StatusBadgeSlip({ status }: { status: string }) {
  if (status === "pending") return (
    <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 whitespace-nowrap">
      <Clock className="w-3 h-3" /> Pending
    </span>
  );
  if (status === "confirmed") return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-500/15 text-green-400">Confirmed</span>
  );
  return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">Rejected</span>;
}
