import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  doc, getDoc, collection, getDocs,
  serverTimestamp, orderBy, query, Timestamp, where,
} from "firebase/firestore";
import { safeSetDoc, safeUpdateDoc, safeAddDoc } from "../../lib/firestoreWrite";
import { db } from "../../config/firebase";
import {
  ArrowLeft, CheckCircle, XCircle, CreditCard, Plus,
  Phone, MapPin, Calendar, Building2, Hash, Upload,
  ExternalLink, Clock, X, Check, Activity, UserPlus,
} from "lucide-react";
import type { ServiceCenter, ServiceCenterPayment, UpgradeRequest, PaymentSlipRequest, StaffMember } from "../../types/auth";
import { SRI_LANKA_DISTRICTS } from "../../types/auth";
import { useSuperAdmin } from "../../contexts/SuperAdminContext";

const ADDITIONAL_BRANCH_RATE = 4000;

export default function ServiceCenterDetailPage() {
  const { centerId } = useParams<{ centerId: string }>();
  const navigate = useNavigate();
  const { superAdmin } = useSuperAdmin();

  const [center, setCenter] = useState<ServiceCenter | null>(null);
  const [payments, setPayments] = useState<ServiceCenterPayment[]>([]);
  const [upgradeRequests, setUpgradeRequests] = useState<UpgradeRequest[]>([]);
  const [slipRequests, setSlipRequests] = useState<PaymentSlipRequest[]>([]);
  const [confirmingSlipId, setConfirmingSlipId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState(false);
  const [viewSlip, setViewSlip] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [showAddBranch, setShowAddBranch] = useState(false);
  const [addingBranch, setAddingBranch] = useState(false);

  // Usage stats — how actively this center is using the app
  const [activeServicesCount, setActiveServicesCount] = useState<number | null>(null);
  const [newMembersCount, setNewMembersCount] = useState<number | null>(null);

  // Payment form state
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payPeriod, setPayPeriod] = useState<"monthly" | "yearly">("monthly");
  const [payNotes, setPayNotes] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);

  useEffect(() => {
    if (!centerId) return;
    const sevenDaysAgo = Timestamp.fromDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
    const thirtyDaysAgo = Timestamp.fromDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
    Promise.allSettled([
      getDoc(doc(db, "servicecenters", centerId)),
      getDocs(query(collection(db, "servicecenters", centerId, "payments"), orderBy("createdAt", "desc"))),
      getDocs(query(collection(db, "upgradeRequests"), where("centerId", "==", centerId), orderBy("createdAt", "desc"))),
      getDocs(query(collection(db, "paymentSlipRequests"), where("centerId", "==", centerId), orderBy("createdAt", "desc"))),
      getDocs(query(collection(db, "servicecenters", centerId, "jobs"), where("createdAt", ">=", sevenDaysAgo))),
      getDocs(query(collection(db, "servicecenters", centerId, "staff"), where("createdAt", ">=", thirtyDaysAgo))),
    ]).then(([centerResult, paymentsResult, upgradeResult, slipResult, jobsResult, staffResult]) => {
      if (centerResult.status === "fulfilled") {
        const snap = centerResult.value;
        if (snap.exists()) setCenter({ id: snap.id, ...snap.data() } as ServiceCenter);
      } else {
        console.error("ServiceCenterDetail fetch failed:", centerResult.reason);
        setError(centerResult.reason?.message ?? "Failed to load service center.");
      }
      if (paymentsResult.status === "fulfilled") {
        setPayments(paymentsResult.value.docs.map((d) => ({ id: d.id, ...d.data() } as ServiceCenterPayment)));
      } else {
        console.error("Payments fetch failed:", paymentsResult.reason);
      }
      if (upgradeResult.status === "fulfilled") {
        setUpgradeRequests(upgradeResult.value.docs.map((d) => ({ id: d.id, ...d.data() } as UpgradeRequest)));
      } else {
        console.error("Upgrade requests fetch failed:", upgradeResult.reason);
      }
      if (slipResult.status === "fulfilled") {
        setSlipRequests(slipResult.value.docs.map((d) => ({ id: d.id, ...d.data() } as PaymentSlipRequest)));
      } else {
        console.error("Slip requests fetch failed:", slipResult.reason);
      }
      if (jobsResult.status === "fulfilled") {
        setActiveServicesCount(jobsResult.value.size);
      } else {
        console.error("Jobs fetch failed:", jobsResult.reason);
      }
      if (staffResult.status === "fulfilled") {
        setNewMembersCount(staffResult.value.size);
      } else {
        console.error("Staff fetch failed:", staffResult.reason);
      }
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
    await safeUpdateDoc(doc(db, "servicecenters", centerId), { status: newStatus });
    setCenter((c) => c ? { ...c, status: newStatus } : c);
    setBlocking(false);
  }

  // Sends a "payment received" SMS to the center owner, signed as Lumora Tech
  // (a second sender mask approved with Dialog eSMS alongside the default PitStopIQ one).
  async function sendPaymentReceivedSms(amount: number, period: "monthly" | "yearly", plan: "basic" | "pro") {
    if (!centerId || !center?.ownerPhone) return;
    const message =
      `Dear ${center.ownerName || "there"}, we have received your ${period} payment of ` +
      `LKR ${amount.toLocaleString()} for your ${plan.toUpperCase()} plan on PitStopIQ. Thank you!\n- Lumora Tech`;
    try {
      await safeAddDoc(collection(db, "servicecenters", centerId, "smsLogs"), {
        phone: center.ownerPhone,
        message,
        messageType: "Reminder",
        status: "sent",
        mask: "Lumora Tech",
        sentAt: Timestamp.now(),
      });
    } catch (err) {
      console.error("Failed to queue payment-received SMS:", err);
    }
  }

  async function markPayment(upgradeReqId?: string) {
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
      upgradeRequestId: upgradeReqId,
      createdAt: Timestamp.now(),
    };
    const ref = await safeAddDoc(collection(db, "servicecenters", centerId, "payments"), {
      ...payment,
      paidAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    });
    setPayments((prev) => [{ id: ref.id, ...payment }, ...prev]);
    await sendPaymentReceivedSms(payment.amount, payment.period, payment.plan);
    setPayAmount("");
    setPayNotes("");
    setShowPaymentForm(false);
    setSavingPayment(false);
  }

  async function approveUpgrade(req: UpgradeRequest) {
    if (!centerId || !superAdmin) return;
    setReviewingId(req.id);
    try {
      // Update upgrade request status
      await safeUpdateDoc(doc(db, "upgradeRequests", req.id), {
        status: "approved",
        reviewedAt: serverTimestamp(),
        reviewedBy: superAdmin.id,
        reviewedByName: superAdmin.displayName,
      });
      // Upgrade the service center plan
      const newQuota = 1000;
      await safeUpdateDoc(doc(db, "servicecenters", centerId), {
        plan: "pro",
        smsQuotaLimit: newQuota,
      });
      // Record payment
      await safeAddDoc(collection(db, "servicecenters", centerId, "payments"), {
        centerId,
        amount: req.amount,
        plan: "pro",
        period: req.period,
        status: "paid",
        paidAt: serverTimestamp(),
        markedBy: superAdmin.id,
        markedByName: superAdmin.displayName,
        notes: `Auto-recorded from upgrade request approval`,
        upgradeRequestId: req.id,
        createdAt: serverTimestamp(),
      });
      setUpgradeRequests((prev) =>
        prev.map((r) => r.id === req.id ? { ...r, status: "approved" } : r)
      );
      setCenter((c) => c ? { ...c, plan: "pro", smsQuotaLimit: newQuota } : c);
      await sendPaymentReceivedSms(req.amount, req.period, "pro");
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
        reviewedByName: superAdmin.displayName,
        notes: reason || req.notes,
      });
      setUpgradeRequests((prev) =>
        prev.map((r) => r.id === req.id ? { ...r, status: "rejected" } : r)
      );
    } finally {
      setReviewingId(null);
    }
  }

  async function confirmSlipPayment(req: PaymentSlipRequest) {
    if (!centerId || !superAdmin) return;
    setConfirmingSlipId(req.id);
    try {
      await safeUpdateDoc(doc(db, "paymentSlipRequests", req.id), {
        status: "confirmed",
        reviewedAt: serverTimestamp(),
        reviewedBy: superAdmin.id,
        reviewedByName: superAdmin.displayName,
      });
      await safeAddDoc(collection(db, "servicecenters", centerId, "payments"), {
        centerId,
        amount: req.amount,
        plan: req.plan,
        period: req.period,
        status: "paid",
        paidAt: serverTimestamp(),
        markedBy: superAdmin.id,
        markedByName: superAdmin.displayName,
        notes: `Confirmed from payment slip submission`,
        createdAt: serverTimestamp(),
      });
      setSlipRequests((prev) => prev.map((r) => r.id === req.id ? { ...r, status: "confirmed" } : r));
    } finally {
      setConfirmingSlipId(null);
    }
  }

  async function rejectSlipPayment(req: PaymentSlipRequest) {
    if (!superAdmin) return;
    const reason = window.prompt("Rejection reason (optional):");
    setConfirmingSlipId(req.id);
    try {
      await safeUpdateDoc(doc(db, "paymentSlipRequests", req.id), {
        status: "rejected",
        reviewedAt: serverTimestamp(),
        reviewedBy: superAdmin.id,
        reviewedByName: superAdmin.displayName,
        notes: reason || undefined,
      });
      setSlipRequests((prev) => prev.map((r) => r.id === req.id ? { ...r, status: "rejected" } : r));
    } finally {
      setConfirmingSlipId(null);
    }
  }

  // Provisions a new branch for the same owner as this (primary) center. No
  // new Firebase Auth user is created — the owner's existing staff record is
  // copied into the new branch so their one login covers it too.
  async function handleAddBranch(form: { name: string; address: string; phone: string; district: string }) {
    if (!center || !superAdmin || !centerId) return;
    setAddingBranch(true);
    try {
      const ownerUid = center.ownerUid ?? center.ownerId;

      const ownerStaffSnap = await getDoc(doc(db, "servicecenters", centerId, "staff", ownerUid));
      const ownerStaff = ownerStaffSnap.exists() ? (ownerStaffSnap.data() as StaffMember) : null;

      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      let code = "PSQ-";
      for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];

      const now = Timestamp.now();
      const periodEnd = Timestamp.fromMillis(now.toMillis() + 30 * 24 * 60 * 60 * 1000);

      const branchRef = await safeAddDoc(collection(db, "servicecenters"), {
        name: form.name,
        branchName: form.name,
        phone: form.phone,
        address: form.address,
        district: form.district,
        smsSenderName: center.smsSenderName ?? "PitStopIQ",
        reminderCooldownDays: center.reminderCooldownDays ?? 30,
        plan: "pro",
        ownerId: center.ownerId,
        ownerUid,
        ownerName: center.ownerName,
        ownerPhone: center.ownerPhone,
        isBranch: true,
        primaryCenterId: centerId,
        monthlyRate: ADDITIONAL_BRANCH_RATE,
        isActive: true,
        status: "active",
        registeredByAdminId: superAdmin.id,
        smsQuotaUsed: 0,
        smsQuotaLimit: 500,
        paymentCode: code,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        createdAt: serverTimestamp(),
      });

      await safeSetDoc(doc(db, "servicecenters", branchRef.id, "staff", ownerUid), {
        id: ownerUid,
        authUid: ownerUid,
        email: ownerStaff?.email ?? `${center.ownerPhone ?? ""}@pitstopiq.app`,
        fullName: ownerStaff?.fullName ?? center.ownerName ?? "Owner",
        phone: ownerStaff?.phone ?? center.ownerPhone ?? "",
        role: "Owner",
        centerId: branchRef.id,
        active: true,
        hasLogin: true,
        loginPhone: ownerStaff?.loginPhone ?? center.ownerPhone,
        createdAt: serverTimestamp(),
      });

      setShowAddBranch(false);
      navigate(`/admin/service-centers/${branchRef.id}`);
    } finally {
      setAddingBranch(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="h-8 w-48 bg-gray-900 rounded-lg animate-pulse mb-4" />
        <div className="h-40 bg-gray-900 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-5 py-4 text-sm text-red-400">
          <span className="font-semibold">Permission error:</span> {error}
          <p className="mt-1 text-red-500/70 text-xs">Firestore security rules may not be deployed. Run <code className="font-mono bg-red-500/10 px-1 rounded">firebase deploy --only firestore:rules</code>.</p>
        </div>
      </div>
    );
  }

  if (!center) {
    return (
      <div className="p-8 text-gray-400">Service center not found.</div>
    );
  }

  const isBlocked = center.status === "blocked";
  const pendingRequests = upgradeRequests.filter((r) => r.status === "pending");

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
            {pendingRequests.length > 0 && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {pendingRequests.length} upgrade request{pendingRequests.length > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-400 mt-1">{center.id}</p>
        </div>
        <div className="flex items-center gap-2">
          {!center.isBranch && (
            <button
              onClick={() => setShowAddBranch(true)}
              className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-orange-500/15 text-orange-400 hover:bg-orange-500/25 transition-colors"
            >
              <Plus className="w-4 h-4" /> Add Branch
            </button>
          )}
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
      </div>

      {center.isBranch && (
        <div className="mb-5 flex items-center gap-2 text-xs text-gray-500">
          <Building2 className="w-3.5 h-3.5" />
          Branch of{" "}
          <button
            onClick={() => center.primaryCenterId && navigate(`/admin/service-centers/${center.primaryCenterId}`)}
            className="text-orange-400 hover:text-orange-300 underline underline-offset-2"
          >
            primary center
          </button>
          {" · LKR "}{(center.monthlyRate ?? ADDITIONAL_BRANCH_RATE).toLocaleString()}/mo
        </div>
      )}

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
        <InfoRow icon={Hash} label="Payment Code" value={center.paymentCode ?? "—"} mono />
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

      {/* Usage — is this center actually using the app? */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-5 grid grid-cols-2 gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-orange-500/15 flex items-center justify-center shrink-0">
            <Activity className="w-4 h-4 text-orange-400" />
          </div>
          <div>
            <p className="text-xs text-gray-500">Active Services (7d)</p>
            <p className="text-lg font-semibold text-white">
              {activeServicesCount === null ? "—" : activeServicesCount}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-orange-500/15 flex items-center justify-center shrink-0">
            <UserPlus className="w-4 h-4 text-orange-400" />
          </div>
          <div>
            <p className="text-xs text-gray-500">New Members (30d)</p>
            <p className="text-lg font-semibold text-white">
              {newMembersCount === null ? "—" : newMembersCount}
            </p>
          </div>
        </div>
        {activeServicesCount === 0 && (
          <p className="col-span-2 text-xs text-amber-400/80">
            No services logged in the last 7 days — this center may not be actively using the app. Consider reaching out.
          </p>
        )}
      </div>

      {/* Upgrade Requests */}
      {upgradeRequests.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-5">
          <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2 mb-4">
            <Upload className="w-4 h-4 text-amber-400" />
            Upgrade Requests
          </h2>
          <div className="space-y-3">
            {upgradeRequests.map((req) => (
              <div key={req.id} className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">
                      Pro Plan — {req.period === "yearly" ? "Yearly" : "Monthly"}
                      <span className="text-gray-400 ml-2">LKR {req.amount.toLocaleString()}</span>
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {req.createdAt ? new Date((req.createdAt as Timestamp).seconds * 1000).toLocaleDateString() : "—"}
                      {req.notes && ` · ${req.notes}`}
                    </p>
                  </div>
                  <StatusBadge status={req.status} />
                </div>

                {/* Slip preview */}
                <button
                  onClick={() => setViewSlip(req.slipUrl)}
                  className="flex items-center gap-2 text-xs text-orange-400 hover:text-orange-300 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  View Payment Slip
                </button>

                {/* Actions for pending */}
                {req.status === "pending" && (
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => approveUpgrade(req)}
                      disabled={reviewingId === req.id}
                      className="flex-1 bg-green-500/15 hover:bg-green-500/25 text-green-400 text-xs font-medium py-2 rounded-lg transition disabled:opacity-60"
                    >
                      {reviewingId === req.id ? "Processing…" : "Approve & Upgrade to Pro"}
                    </button>
                    <button
                      onClick={() => rejectUpgrade(req)}
                      disabled={reviewingId === req.id}
                      className="flex-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium py-2 rounded-lg transition disabled:opacity-60"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Monthly Payment Slip Requests */}
      {slipRequests.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-5">
          <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2 mb-4">
            <Upload className="w-4 h-4 text-green-400" />
            Monthly Payment Slips
          </h2>
          <div className="space-y-3">
            {slipRequests.map((req) => (
              <div key={req.id} className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">
                      {req.plan.toUpperCase()} Plan — {req.period === "yearly" ? "Yearly" : "Monthly"}
                      <span className="text-gray-400 ml-2">LKR {req.amount.toLocaleString()}</span>
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {req.createdAt ? new Date((req.createdAt as unknown as Timestamp).seconds * 1000).toLocaleDateString() : "—"}
                      {req.notes && ` · ${req.notes}`}
                    </p>
                  </div>
                  <StatusBadgeSlip status={req.status} />
                </div>

                <button
                  onClick={() => setViewSlip(req.slipUrl)}
                  className="flex items-center gap-2 text-xs text-orange-400 hover:text-orange-300 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  View Payment Slip
                </button>

                {req.status === "pending" && (
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => confirmSlipPayment(req)}
                      disabled={confirmingSlipId === req.id}
                      className="flex-1 bg-green-500/15 hover:bg-green-500/25 text-green-400 text-xs font-medium py-2 rounded-lg transition disabled:opacity-60"
                    >
                      {confirmingSlipId === req.id ? "Processing…" : "Confirm Payment"}
                    </button>
                    <button
                      onClick={() => rejectSlipPayment(req)}
                      disabled={confirmingSlipId === req.id}
                      className="flex-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium py-2 rounded-lg transition disabled:opacity-60"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

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
                onClick={() => markPayment()}
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

      {showAddBranch && (
        <AddBranchModal
          saving={addingBranch}
          onCancel={() => setShowAddBranch(false)}
          onSave={handleAddBranch}
        />
      )}
    </div>
  );
}

function AddBranchModal({
  saving, onCancel, onSave,
}: {
  saving: boolean;
  onCancel: () => void;
  onSave: (form: { name: string; address: string; phone: string; district: string }) => void;
}) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [district, setDistrict] = useState("");

  const valid = name.trim() && address.trim() && phone.trim() && district;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onCancel} />
      <div className="relative bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Add Branch</h3>
          <button onClick={onCancel} className="text-gray-500 hover:text-gray-300 transition">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-xs text-gray-500">
          Billed at LKR {ADDITIONAL_BRANCH_RATE.toLocaleString()}/mo. No new login is created — the owner's
          existing account gets access to this branch too.
        </p>

        <div>
          <label className="text-xs text-gray-400 block mb-1">Branch Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Peradeniya Workshop"
            className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Address</label>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Phone</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">District</label>
          <select
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
          >
            <option value="">Select district</option>
            {SRI_LANKA_DISTRICTS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            onClick={onCancel}
            className="flex-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white font-medium py-2.5 rounded-lg transition text-sm"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave({ name: name.trim(), address: address.trim(), phone: phone.trim(), district })}
            disabled={!valid || saving}
            className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition text-sm flex items-center justify-center gap-2"
          >
            {saving ? "Creating…" : (<><Check className="w-4 h-4" /> Create Branch</>)}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "pending") return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400">Pending</span>;
  if (status === "approved") return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-500/15 text-green-400">Approved</span>;
  return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">Rejected</span>;
}

function StatusBadgeSlip({ status }: { status: string }) {
  if (status === "pending") return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400">Pending</span>;
  if (status === "confirmed") return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-500/15 text-green-400">Confirmed</span>;
  return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">Rejected</span>;
}

function InfoRow({ icon: Icon, label, value, mono }: { icon: React.ElementType; label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-1 flex items-center gap-1.5">
        <Icon className="w-3 h-3" />
        {label}
      </p>
      <p className={`text-sm text-gray-200 ${mono ? "font-mono text-orange-400" : ""}`}>{value || "—"}</p>
    </div>
  );
}
