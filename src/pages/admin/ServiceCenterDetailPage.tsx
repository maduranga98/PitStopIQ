import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  doc, getDoc, collection, getDocs,
  serverTimestamp, orderBy, query, Timestamp, where,
} from "firebase/firestore";
import { safeSetDoc, safeUpdateDoc, safeAddDoc } from "../../lib/firestoreWrite";
import { subscriptionRenewalFields } from "../../lib/subscription";
import { db } from "../../config/firebase";
import {
  ArrowLeft, CheckCircle, XCircle, CreditCard, Plus,
  Phone, MapPin, Calendar, Building2, Hash, Upload,
  ExternalLink, Clock, X, Check, Activity, UserPlus, BellRing, Trash2,
  ArrowUpCircle, Package,
} from "lucide-react";
import type { ServiceCenter, ServiceCenterPayment, UpgradeRequest, PaymentSlipRequest, StaffMember } from "../../types/auth";
import { SRI_LANKA_DISTRICTS } from "../../types/auth";
import { useSuperAdmin } from "../../contexts/SuperAdminContext";
import { sendPaymentReminderSms } from "../../lib/adminSms";

// Additional-branch add-on pricing (loyalty-discounted off the standalone
// rates of 7999/4999 since the owner is already a paying customer).
const ADDITIONAL_BRANCH_RATE_PRO = 6999;
const ADDITIONAL_BRANCH_RATE_BASIC = 4499;

function currentMonthValue(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// "2026-07" -> "Jul 2026"
function formatMonthLabel(value: string): string {
  const [y, m] = value.split("-").map(Number);
  if (!y || !m) return value;
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

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
  const [sendingReminder, setSendingReminder] = useState(false);
  const [reminderSent, setReminderSent] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showChangePlan, setShowChangePlan] = useState(false);
  const [changingPlan, setChangingPlan] = useState(false);

  // Usage stats — how actively this center is using the app
  const [activeServicesCount, setActiveServicesCount] = useState<number | null>(null);
  const [newMembersCount, setNewMembersCount] = useState<number | null>(null);

  // Payment form state
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payPeriod, setPayPeriod] = useState<"monthly" | "yearly">("monthly");
  const [payMonth, setPayMonth] = useState(currentMonthValue());
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

  async function handleSendReminder() {
    if (!center) return;
    setSendingReminder(true);
    try {
      await sendPaymentReminderSms(center);
      setReminderSent(true);
      setTimeout(() => setReminderSent(false), 3000);
    } catch (err) {
      console.error("Failed to send payment reminder:", err);
      window.alert((err as Error)?.message ?? "Failed to send reminder.");
    } finally {
      setSendingReminder(false);
    }
  }

  async function toggleBlock() {
    if (!center || !centerId) return;
    const newStatus = center.status === "blocked" ? "active" : "blocked";
    const confirmed = window.confirm(
      newStatus === "blocked"
        ? `Block "${center.name}"? They will be unable to access the system.`
        : `Unblock "${center.name}"? They will regain access. Note: if their subscription period ` +
          `has expired and no payment is marked, the daily check will re-block them.`
    );
    if (!confirmed) return;
    setBlocking(true);
    try {
      await safeUpdateDoc(doc(db, "servicecenters", centerId), { status: newStatus });
      setCenter((c) => c ? { ...c, status: newStatus } : c);
    } catch (err) {
      console.error("Failed to update block status:", err);
      window.alert((err as Error)?.message ?? "Failed to update status. Please try again.");
    } finally {
      setBlocking(false);
    }
  }

  async function restoreCenter() {
    if (!center || !centerId) return;
    if (!window.confirm(`Restore "${center.name}"? The owner will regain access to it.`)) return;
    try {
      await safeUpdateDoc(doc(db, "servicecenters", centerId), { isActive: true });
      setCenter((c) => c ? { ...c, isActive: true } : c);
    } catch (err) {
      console.error("Failed to restore service center:", err);
      window.alert((err as Error)?.message ?? "Failed to restore. Please try again.");
    }
  }

  // Directly sets this center's package (super admin action) — independent of
  // the customer's slip-based upgrade-request flow, so the admin can upgrade or
  // downgrade a center on request. The SMS quota is realigned to the new plan
  // (1000 pro / 200 basic). Any money that changed hands is logged separately
  // via "Mark Payment", so this doesn't touch the billing period.
  async function changePlan(newPlan: "basic" | "pro") {
    if (!center || !centerId) return;
    if (newPlan === center.plan) { setShowChangePlan(false); return; }
    setChangingPlan(true);
    try {
      const newQuota = newPlan === "pro" ? 1000 : 200;
      await safeUpdateDoc(doc(db, "servicecenters", centerId), {
        plan: newPlan,
        smsQuotaLimit: newQuota,
      });
      setCenter((c) => c ? { ...c, plan: newPlan, smsQuotaLimit: newQuota } : c);
      setShowChangePlan(false);
    } catch (err) {
      console.error("Failed to change plan:", err);
      window.alert((err as Error)?.message ?? "Failed to change plan. Please try again.");
    } finally {
      setChangingPlan(false);
    }
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
    try {
      const payment: Omit<ServiceCenterPayment, "id"> = {
        centerId,
        amount: parseFloat(payAmount),
        plan: center?.plan ?? "basic",
        period: payPeriod,
        status: "paid",
        paidAt: Timestamp.now(),
        markedBy: superAdmin.id,
        markedByName: superAdmin.displayName || superAdmin.email,
        forMonth: payMonth,
        createdAt: Timestamp.now(),
        // Only set optional fields when they have a real value — Firestore
        // rejects `undefined` field values outright.
        ...(payNotes ? { notes: payNotes } : {}),
        ...(upgradeReqId ? { upgradeRequestId: upgradeReqId } : {}),
      };
      const ref = await safeAddDoc(collection(db, "servicecenters", centerId, "payments"), {
        ...payment,
        paidAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
      setPayments((prev) => [{ id: ref.id, ...payment }, ...prev]);
      // Renew the subscription — without this the daily check re-blocks the
      // center as soon as the (stale) currentPeriodEnd lapses.
      const renewal = subscriptionRenewalFields(center ?? undefined, payPeriod);
      await safeUpdateDoc(doc(db, "servicecenters", centerId), renewal);
      setCenter((c) => c ? {
        ...c,
        status: renewal.status,
        currentPeriodStart: renewal.currentPeriodStart,
        currentPeriodEnd: renewal.currentPeriodEnd,
        graceDeadline: undefined,
      } : c);
      await sendPaymentReceivedSms(payment.amount, payment.period, payment.plan);
      setPayAmount("");
      setPayNotes("");
      setPayMonth(currentMonthValue());
      setShowPaymentForm(false);
    } catch (err) {
      console.error("Failed to mark payment:", err);
      window.alert((err as Error)?.message ?? "Failed to save payment. Please try again.");
    } finally {
      setSavingPayment(false);
    }
  }

  async function approveUpgrade(req: UpgradeRequest) {
    if (!centerId || !superAdmin) return;
    setReviewingId(req.id);
    try {
      const targetPlan = req.requestedPlan ?? "pro";
      const isDowngrade = targetPlan === "basic";
      const newQuota = targetPlan === "pro" ? 1000 : 200;

      // Update the request status
      await safeUpdateDoc(doc(db, "upgradeRequests", req.id), {
        status: "approved",
        reviewedAt: serverTimestamp(),
        reviewedBy: superAdmin.id,
        reviewedByName: superAdmin.displayName || superAdmin.email,
      });

      if (isDowngrade) {
        // A downgrade is a plan change only — no payment, and the billing
        // period is left untouched so the center keeps its paid-through date.
        await safeUpdateDoc(doc(db, "servicecenters", centerId), {
          plan: targetPlan,
          smsQuotaLimit: newQuota,
        });
        setUpgradeRequests((prev) =>
          prev.map((r) => r.id === req.id ? { ...r, status: "approved" } : r)
        );
        setCenter((c) => c ? { ...c, plan: targetPlan, smsQuotaLimit: newQuota } : c);
      } else {
        // Upgrade: renew the subscription period (the approval doubles as a
        // confirmed payment) and record the payment.
        const renewal = subscriptionRenewalFields(center ?? undefined, req.period);
        await safeUpdateDoc(doc(db, "servicecenters", centerId), {
          plan: targetPlan,
          smsQuotaLimit: newQuota,
          ...renewal,
        });
        await safeAddDoc(collection(db, "servicecenters", centerId, "payments"), {
          centerId,
          amount: req.amount,
          plan: targetPlan,
          period: req.period,
          status: "paid",
          paidAt: serverTimestamp(),
          markedBy: superAdmin.id,
          markedByName: superAdmin.displayName || superAdmin.email,
          notes: `Auto-recorded from upgrade request approval`,
          upgradeRequestId: req.id,
          createdAt: serverTimestamp(),
        });
        setUpgradeRequests((prev) =>
          prev.map((r) => r.id === req.id ? { ...r, status: "approved" } : r)
        );
        setCenter((c) => c ? {
          ...c,
          plan: targetPlan,
          smsQuotaLimit: newQuota,
          status: renewal.status,
          currentPeriodStart: renewal.currentPeriodStart,
          currentPeriodEnd: renewal.currentPeriodEnd,
          graceDeadline: undefined,
        } : c);
        await sendPaymentReceivedSms(req.amount, req.period, "pro");
      }
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

  async function confirmSlipPayment(req: PaymentSlipRequest) {
    if (!centerId || !superAdmin) return;
    setConfirmingSlipId(req.id);
    try {
      await safeUpdateDoc(doc(db, "paymentSlipRequests", req.id), {
        status: "confirmed",
        reviewedAt: serverTimestamp(),
        reviewedBy: superAdmin.id,
        reviewedByName: superAdmin.displayName || superAdmin.email,
      });
      await safeAddDoc(collection(db, "servicecenters", centerId, "payments"), {
        centerId,
        amount: req.amount,
        plan: req.plan,
        period: req.period,
        status: "paid",
        paidAt: serverTimestamp(),
        markedBy: superAdmin.id,
        markedByName: superAdmin.displayName || superAdmin.email,
        notes: `Confirmed from payment slip submission`,
        createdAt: serverTimestamp(),
      });
      // Renew the subscription so the center is unblocked and the daily
      // check doesn't immediately push it back into grace/blocked.
      const renewal = subscriptionRenewalFields(center ?? undefined, req.period);
      await safeUpdateDoc(doc(db, "servicecenters", centerId), renewal);
      setCenter((c) => c ? {
        ...c,
        status: renewal.status,
        currentPeriodStart: renewal.currentPeriodStart,
        currentPeriodEnd: renewal.currentPeriodEnd,
        graceDeadline: undefined,
      } : c);
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
        reviewedByName: superAdmin.displayName || superAdmin.email,
        ...(reason ? { notes: reason } : {}),
      });
      setSlipRequests((prev) => prev.map((r) => r.id === req.id ? { ...r, status: "rejected" } : r));
    } finally {
      setConfirmingSlipId(null);
    }
  }

  // Provisions a new branch for the same owner as this (primary) center. No
  // new Firebase Auth user is created — the owner's existing staff record is
  // copied into the new branch so their one login covers it too.
  async function handleAddBranch(form: { name: string; address: string; phone: string; district: string; plan: "basic" | "pro" }) {
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
        plan: form.plan,
        ownerId: center.ownerId,
        ownerUid,
        ownerName: center.ownerName,
        ownerPhone: center.ownerPhone,
        isBranch: true,
        primaryCenterId: centerId,
        monthlyRate: form.plan === "pro" ? ADDITIONAL_BRANCH_RATE_PRO : ADDITIONAL_BRANCH_RATE_BASIC,
        isActive: true,
        status: "active",
        registeredByAdminId: superAdmin.id,
        smsQuotaUsed: 0,
        smsQuotaLimit: form.plan === "pro" ? 1000 : 200,
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
    <div className="p-8 max-w-5xl mx-auto">
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
            {center.isActive === false && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 flex items-center gap-1">
                <Trash2 className="w-3 h-3" /> Deleted
              </span>
            )}
            {pendingRequests.length > 0 && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {pendingRequests.length} plan request{pendingRequests.length > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-400 mt-1">{center.id}</p>
        </div>
        <div className="flex items-center gap-2">
          {center.status !== "active" && (
            <button
              onClick={handleSendReminder}
              disabled={sendingReminder || !center.ownerPhone}
              className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 transition-colors disabled:opacity-60"
            >
              <BellRing className="w-4 h-4" />
              {sendingReminder ? "Sending…" : reminderSent ? "Reminder Sent" : "Send Payment Reminder"}
            </button>
          )}
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
          {center.isActive === false ? (
            <button
              onClick={restoreCenter}
              className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors"
            >
              Restore
            </button>
          ) : (
            <button
              onClick={() => setShowDeleteModal(true)}
              className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors"
            >
              <Trash2 className="w-4 h-4" /> Delete
            </button>
          )}
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
          {" · LKR "}{(center.monthlyRate ?? (center.plan === "pro" ? ADDITIONAL_BRANCH_RATE_PRO : ADDITIONAL_BRANCH_RATE_BASIC)).toLocaleString()}/mo
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
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`text-sm font-medium px-3 py-1 rounded-full ${
              center.plan === "pro" ? "bg-orange-500/15 text-orange-400" : "bg-gray-800 text-gray-300"
            }`}>
              {center.plan.toUpperCase()} · {center.smsQuotaUsed}/{center.smsQuotaLimit} SMS used
            </span>
            <button
              onClick={() => setShowChangePlan(true)}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full bg-orange-500/15 text-orange-400 hover:bg-orange-500/25 transition-colors"
            >
              <ArrowUpCircle className="w-3.5 h-3.5" /> Change Plan
            </button>
          </div>
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
            Plan Change Requests
          </h2>
          <div className="space-y-3">
            {upgradeRequests.map((req) => (
              <div key={req.id} className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">
                      {req.requestedPlan === "basic"
                        ? "Downgrade to Basic"
                        : `Pro Plan — ${req.period === "yearly" ? "Yearly" : "Monthly"}`}
                      <span className="text-gray-400 ml-2">
                        {req.requestedPlan === "basic" ? "No charge" : `LKR ${req.amount.toLocaleString()}`}
                      </span>
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {req.createdAt ? new Date((req.createdAt as Timestamp).seconds * 1000).toLocaleDateString() : "—"}
                      {req.notes && ` · ${req.notes}`}
                    </p>
                  </div>
                  <StatusBadge status={req.status} />
                </div>

                {/* Slip preview (upgrades only — downgrades have no slip) */}
                {req.slipUrl && (
                  <button
                    onClick={() => setViewSlip(req.slipUrl!)}
                    className="flex items-center gap-2 text-xs text-orange-400 hover:text-orange-300 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    View Payment Slip
                  </button>
                )}

                {/* Actions for pending */}
                {req.status === "pending" && (
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => approveUpgrade(req)}
                      disabled={reviewingId === req.id}
                      className="flex-1 bg-green-500/15 hover:bg-green-500/25 text-green-400 text-xs font-medium py-2 rounded-lg transition disabled:opacity-60"
                    >
                      {reviewingId === req.id
                        ? "Processing…"
                        : req.requestedPlan === "basic" ? "Approve Downgrade to Basic" : "Approve & Upgrade to Pro"}
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
              <label className="text-xs text-gray-400">Payment for month</label>
              <input
                type="month"
                value={payMonth}
                onChange={(e) => setPayMonth(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-orange-500"
              />
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
                    {p.forMonth && (
                      <span className="text-xs text-orange-400/80 ml-2">for {formatMonthLabel(p.forMonth)}</span>
                    )}
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

      {showChangePlan && (
        <ChangePlanModal
          currentPlan={center.plan}
          saving={changingPlan}
          onCancel={() => setShowChangePlan(false)}
          onSave={changePlan}
        />
      )}

      {showDeleteModal && centerId && (
        <DeleteCenterModal
          centerName={center.name}
          centerId={centerId}
          onClose={() => setShowDeleteModal(false)}
          onDeleted={() => {
            setCenter((c) => c ? { ...c, isActive: false } : c);
            setShowDeleteModal(false);
          }}
        />
      )}
    </div>
  );
}

function DeleteCenterModal({ centerName, centerId, onClose, onDeleted }: {
  centerName: string;
  centerId: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const isMatch = confirmText.trim() === centerName.trim();

  async function handleDelete() {
    if (!isMatch) { setError("Name doesn't match."); return; }
    setDeleting(true);
    setError("");
    try {
      await safeUpdateDoc(doc(db, "servicecenters", centerId), { isActive: false });
      onDeleted();
    } catch (err) {
      console.error("Failed to delete service center:", err);
      setError((err as Error)?.message ?? "Failed to delete. Please try again.");
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-gray-900 border border-red-500/30 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-red-300 flex items-center gap-2">
            <Trash2 className="w-4 h-4" /> Delete Service Center
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-red-300 leading-relaxed">
          This removes "{centerName}" from the owner's login and hides it from the active centers list.
          Its data is retained and can be restored from this page at any time.
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-1.5">
            Type <span className="text-gray-200 font-medium">{centerName}</span> to confirm
          </label>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => { setConfirmText(e.target.value); setError(""); }}
            placeholder={centerName}
            className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-500"
          />
          {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            className="flex-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white font-medium py-2.5 rounded-lg transition text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={!isMatch || deleting}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white font-semibold py-2.5 rounded-lg transition text-sm flex items-center justify-center gap-2"
          >
            <Trash2 className="w-4 h-4" /> {deleting ? "Deleting…" : "Delete Center"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChangePlanModal({
  currentPlan, saving, onCancel, onSave,
}: {
  currentPlan: "basic" | "pro";
  saving: boolean;
  onCancel: () => void;
  onSave: (plan: "basic" | "pro") => void;
}) {
  // Default the picker to the "other" plan — the common action is switching.
  const [plan, setPlan] = useState<"basic" | "pro">(currentPlan === "pro" ? "basic" : "pro");
  const newQuota = plan === "pro" ? 1000 : 200;
  const noChange = plan === currentPlan;
  const isDowngrade = currentPlan === "pro" && plan === "basic";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onCancel} />
      <div className="relative bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <Package className="w-4 h-4 text-orange-400" /> Change Plan
          </h3>
          <button onClick={onCancel} className="text-gray-500 hover:text-gray-300 transition">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-xs text-gray-500">
          Current plan: <span className="font-medium text-gray-300">{currentPlan.toUpperCase()}</span>.
          Switching realigns the monthly SMS quota. This does not record a payment or extend
          the billing period — use “Mark Payment” for that.
        </p>

        <div>
          <label className="text-xs text-gray-400 block mb-1">Package</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setPlan("pro")}
              className={`rounded-lg border px-3 py-2 text-sm text-left transition-colors ${
                plan === "pro"
                  ? "border-orange-500 bg-orange-500/10 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600"
              }`}
            >
              <span className="block font-medium">Pro</span>
              <span className="block text-xs opacity-80">1,000 SMS/mo</span>
            </button>
            <button
              type="button"
              onClick={() => setPlan("basic")}
              className={`rounded-lg border px-3 py-2 text-sm text-left transition-colors ${
                plan === "basic"
                  ? "border-orange-500 bg-orange-500/10 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600"
              }`}
            >
              <span className="block font-medium">Basic</span>
              <span className="block text-xs opacity-80">200 SMS/mo</span>
            </button>
          </div>
        </div>

        {isDowngrade && !noChange && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 text-xs text-amber-300">
            Downgrading to Basic lowers the SMS quota to {newQuota.toLocaleString()} and disables
            Pro-only features (e.g. inspections) for this center.
          </div>
        )}

        <div className="flex gap-3 pt-1">
          <button
            onClick={onCancel}
            className="flex-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white font-medium py-2.5 rounded-lg transition text-sm"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(plan)}
            disabled={noChange || saving}
            className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition text-sm flex items-center justify-center gap-2"
          >
            {saving ? "Saving…" : (<><Check className="w-4 h-4" /> {noChange ? "No Change" : `Set to ${plan.toUpperCase()}`}</>)}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddBranchModal({
  saving, onCancel, onSave,
}: {
  saving: boolean;
  onCancel: () => void;
  onSave: (form: { name: string; address: string; phone: string; district: string; plan: "basic" | "pro" }) => void;
}) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [district, setDistrict] = useState("");
  const [plan, setPlan] = useState<"basic" | "pro">("pro");

  const valid = name.trim() && address.trim() && phone.trim() && district;
  const rate = plan === "pro" ? ADDITIONAL_BRANCH_RATE_PRO : ADDITIONAL_BRANCH_RATE_BASIC;

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
          Billed at LKR {rate.toLocaleString()}/mo. No new login is created — the owner's
          existing account gets access to this branch too.
        </p>

        <div>
          <label className="text-xs text-gray-400 block mb-1">Branch Plan</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setPlan("pro")}
              className={`rounded-lg border px-3 py-2 text-sm text-left transition-colors ${
                plan === "pro"
                  ? "border-orange-500 bg-orange-500/10 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600"
              }`}
            >
              <span className="block font-medium">Pro</span>
              <span className="block text-xs opacity-80">LKR {ADDITIONAL_BRANCH_RATE_PRO.toLocaleString()}/mo</span>
            </button>
            <button
              type="button"
              onClick={() => setPlan("basic")}
              className={`rounded-lg border px-3 py-2 text-sm text-left transition-colors ${
                plan === "basic"
                  ? "border-orange-500 bg-orange-500/10 text-white"
                  : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600"
              }`}
            >
              <span className="block font-medium">Basic</span>
              <span className="block text-xs opacity-80">LKR {ADDITIONAL_BRANCH_RATE_BASIC.toLocaleString()}/mo</span>
            </button>
          </div>
        </div>

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
            onClick={() => onSave({ name: name.trim(), address: address.trim(), phone: phone.trim(), district, plan })}
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
