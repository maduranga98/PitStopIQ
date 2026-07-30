import { useEffect, useState } from "react";
import {
  collection, getDocs, getDoc,
  doc, orderBy, query, serverTimestamp, increment,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { safeUpdateDoc, safeAddDoc } from "../../lib/firestoreWrite";
import { subscriptionRenewalFields, STORE_ADDON_LABEL, SMS_PACKAGE_LABEL } from "../../lib/subscription";
import { db, functions } from "../../config/firebase";
import {
  Upload, CheckCircle, XCircle, ExternalLink, Clock,
  RefreshCw, Trash2, Store, MessageSquare, Building2,
} from "lucide-react";
import type {
  ServiceCenter, UpgradeRequest, PaymentSlipRequest, AccountDeletionRequest,
  StoreAddonRequest, SmsPackageRequest, BranchRequest,
} from "../../types/auth";
import { useSuperAdmin } from "../../contexts/SuperAdminContext";

type Tab = "upgrade" | "payment" | "storeAddon" | "smsPackage" | "branch" | "deletion";

export default function AdminRequestsPage() {
  const { superAdmin } = useSuperAdmin();
  const [tab, setTab] = useState<Tab>("upgrade");
  const [upgradeRequests, setUpgradeRequests] = useState<UpgradeRequest[]>([]);
  const [slipRequests, setSlipRequests] = useState<PaymentSlipRequest[]>([]);
  const [storeAddonRequests, setStoreAddonRequests] = useState<StoreAddonRequest[]>([]);
  const [smsPackageRequests, setSmsPackageRequests] = useState<SmsPackageRequest[]>([]);
  const [branchRequests, setBranchRequests] = useState<BranchRequest[]>([]);
  const [deletionRequests, setDeletionRequests] = useState<AccountDeletionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [confirmingSlipId, setConfirmingSlipId] = useState<string | null>(null);
  const [confirmingAddonId, setConfirmingAddonId] = useState<string | null>(null);
  const [confirmingSmsPackageId, setConfirmingSmsPackageId] = useState<string | null>(null);
  const [reviewingBranchId, setReviewingBranchId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewSlip, setViewSlip] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<"pending" | "all">("pending");

  async function loadData() {
    setLoading(true);
    const [upgradeSnap, slipSnap, addonSnap, smsPackageSnap, branchSnap, deletionSnap] = await Promise.all([
      getDocs(query(collection(db, "upgradeRequests"), orderBy("createdAt", "desc"))),
      getDocs(query(collection(db, "paymentSlipRequests"), orderBy("createdAt", "desc"))),
      getDocs(query(collection(db, "storeAddonRequests"), orderBy("createdAt", "desc"))),
      getDocs(query(collection(db, "smsPackageRequests"), orderBy("createdAt", "desc"))),
      getDocs(query(collection(db, "branchRequests"), orderBy("createdAt", "desc"))),
      getDocs(query(collection(db, "accountDeletionRequests"), orderBy("createdAt", "desc"))),
    ]);
    setUpgradeRequests(upgradeSnap.docs.map((d) => ({ id: d.id, ...d.data() } as UpgradeRequest)));
    setSlipRequests(slipSnap.docs.map((d) => ({ id: d.id, ...d.data() } as PaymentSlipRequest)));
    setStoreAddonRequests(addonSnap.docs.map((d) => ({ id: d.id, ...d.data() } as StoreAddonRequest)));
    setSmsPackageRequests(smsPackageSnap.docs.map((d) => ({ id: d.id, ...d.data() } as SmsPackageRequest)));
    setBranchRequests(branchSnap.docs.map((d) => ({ id: d.id, ...d.data() } as BranchRequest)));
    setDeletionRequests(deletionSnap.docs.map((d) => ({ id: d.id, ...d.data() } as AccountDeletionRequest)));
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  // Current period end for a center, so a confirmed payment rolls the
  // subscription forward from the right base date.
  async function fetchCenter(centerId: string): Promise<ServiceCenter | undefined> {
    try {
      const snap = await getDoc(doc(db, "servicecenters", centerId));
      return snap.exists() ? ({ id: snap.id, ...snap.data() } as ServiceCenter) : undefined;
    } catch {
      return undefined;
    }
  }

  async function approveUpgrade(req: UpgradeRequest) {
    if (!superAdmin) return;
    setReviewingId(req.id);
    try {
      const targetPlan = req.requestedPlan ?? "pro";
      const isDowngrade = targetPlan === "basic";
      const newQuota = targetPlan === "pro" ? 1000 : 200;

      await safeUpdateDoc(doc(db, "upgradeRequests", req.id), {
        status: "approved",
        reviewedAt: serverTimestamp(),
        reviewedBy: superAdmin.id,
        reviewedByName: superAdmin.displayName || superAdmin.email,
      });

      if (isDowngrade) {
        // Downgrade is a plan change only — no payment, keep the billing period.
        await safeUpdateDoc(doc(db, "servicecenters", req.centerId), {
          plan: targetPlan,
          smsQuotaLimit: newQuota,
        });
      } else {
        // Approval doubles as a confirmed payment — also renew the
        // subscription period so the daily check doesn't re-block the center.
        const center = await fetchCenter(req.centerId);
        await safeUpdateDoc(doc(db, "servicecenters", req.centerId), {
          plan: targetPlan,
          smsQuotaLimit: newQuota,
          ...subscriptionRenewalFields(center, req.period),
        });
        await safeAddDoc(collection(db, "servicecenters", req.centerId, "payments"), {
          centerId: req.centerId,
          amount: req.amount,
          plan: targetPlan,
          period: req.period,
          status: "paid",
          paidAt: serverTimestamp(),
          markedBy: superAdmin.id,
          markedByName: superAdmin.displayName || superAdmin.email,
          notes: "Auto-recorded from upgrade request approval",
          upgradeRequestId: req.id,
          createdAt: serverTimestamp(),
        });
      }
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
      // Renew the subscription — confirming the slip is what unblocks the
      // center and stops the daily check from re-blocking it.
      const center = await fetchCenter(req.centerId);
      await safeUpdateDoc(
        doc(db, "servicecenters", req.centerId),
        subscriptionRenewalFields(center, req.period),
      );
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

  // Confirming a Store add-on purchase both unlocks the section
  // (storeAddons.{addon} = true) and records the fee as a paid payment, the
  // same way a monthly payment slip confirmation does.
  async function confirmStoreAddon(req: StoreAddonRequest) {
    if (!superAdmin) return;
    setConfirmingAddonId(req.id);
    try {
      await safeUpdateDoc(doc(db, "storeAddonRequests", req.id), {
        status: "confirmed",
        reviewedAt: serverTimestamp(),
        reviewedBy: superAdmin.id,
        reviewedByName: superAdmin.displayName || superAdmin.email,
      });
      await safeUpdateDoc(doc(db, "servicecenters", req.centerId), {
        [`storeAddons.${req.addon}`]: true,
      });
      await safeAddDoc(collection(db, "servicecenters", req.centerId, "payments"), {
        centerId: req.centerId,
        amount: req.amount,
        plan: "addon",
        period: "monthly",
        status: "paid",
        paidAt: serverTimestamp(),
        markedBy: superAdmin.id,
        markedByName: superAdmin.displayName || superAdmin.email,
        notes: `${STORE_ADDON_LABEL[req.addon]} add-on purchase`,
        createdAt: serverTimestamp(),
      });
      setStoreAddonRequests((prev) =>
        prev.map((r) => r.id === req.id ? { ...r, status: "confirmed" } : r)
      );
    } finally {
      setConfirmingAddonId(null);
    }
  }

  async function rejectStoreAddon(req: StoreAddonRequest) {
    if (!superAdmin) return;
    const reason = window.prompt("Rejection reason (optional):");
    setConfirmingAddonId(req.id);
    try {
      await safeUpdateDoc(doc(db, "storeAddonRequests", req.id), {
        status: "rejected",
        reviewedAt: serverTimestamp(),
        reviewedBy: superAdmin.id,
        reviewedByName: superAdmin.displayName || superAdmin.email,
        ...(reason ? { notes: reason } : {}),
      });
      setStoreAddonRequests((prev) =>
        prev.map((r) => r.id === req.id ? { ...r, status: "rejected" } : r)
      );
    } finally {
      setConfirmingAddonId(null);
    }
  }

  // Confirming an SMS package purchase always bumps smsQuotaLimit by the
  // package's quota once. If it was bought as a recurring monthly add-on, it
  // also stacks onto smsPackageSubscriptions so its fee folds into every
  // future subscription payment slip (same as a Store add-on); a one-time
  // purchase only ever touches the quota.
  async function confirmSmsPackage(req: SmsPackageRequest) {
    if (!superAdmin) return;
    setConfirmingSmsPackageId(req.id);
    try {
      await safeUpdateDoc(doc(db, "smsPackageRequests", req.id), {
        status: "confirmed",
        reviewedAt: serverTimestamp(),
        reviewedBy: superAdmin.id,
        reviewedByName: superAdmin.displayName || superAdmin.email,
      });
      await safeUpdateDoc(doc(db, "servicecenters", req.centerId), {
        smsQuotaLimit: increment(req.quota),
        ...(req.billingType === "recurring"
          ? { [`smsPackageSubscriptions.${req.package}`]: increment(1) }
          : {}),
      });
      await safeAddDoc(collection(db, "servicecenters", req.centerId, "payments"), {
        centerId: req.centerId,
        amount: req.amount,
        plan: "sms_package",
        period: req.billingType === "recurring" ? "monthly" : "one_time",
        status: "paid",
        paidAt: serverTimestamp(),
        markedBy: superAdmin.id,
        markedByName: superAdmin.displayName || superAdmin.email,
        notes: `${SMS_PACKAGE_LABEL[req.package]} SMS package (${req.billingType === "recurring" ? "monthly" : "one-time"})`,
        createdAt: serverTimestamp(),
      });
      setSmsPackageRequests((prev) =>
        prev.map((r) => r.id === req.id ? { ...r, status: "confirmed" } : r)
      );
    } finally {
      setConfirmingSmsPackageId(null);
    }
  }

  async function rejectSmsPackage(req: SmsPackageRequest) {
    if (!superAdmin) return;
    const reason = window.prompt("Rejection reason (optional):");
    setConfirmingSmsPackageId(req.id);
    try {
      await safeUpdateDoc(doc(db, "smsPackageRequests", req.id), {
        status: "rejected",
        reviewedAt: serverTimestamp(),
        reviewedBy: superAdmin.id,
        reviewedByName: superAdmin.displayName || superAdmin.email,
        ...(reason ? { notes: reason } : {}),
      });
      setSmsPackageRequests((prev) =>
        prev.map((r) => r.id === req.id ? { ...r, status: "rejected" } : r)
      );
    } finally {
      setConfirmingSmsPackageId(null);
    }
  }

  // Approving just marks the request reviewed — actually provisioning the
  // branch (new servicecenters doc, staff login, billing) is still a manual
  // step done outside this page, same as before this request flow existed.
  async function approveBranch(req: BranchRequest) {
    if (!superAdmin) return;
    setReviewingBranchId(req.id);
    try {
      await safeUpdateDoc(doc(db, "branchRequests", req.id), {
        status: "approved",
        reviewedAt: serverTimestamp(),
        reviewedBy: superAdmin.id,
        reviewedByName: superAdmin.displayName || superAdmin.email,
      });
      setBranchRequests((prev) =>
        prev.map((r) => r.id === req.id ? { ...r, status: "approved" } : r)
      );
    } finally {
      setReviewingBranchId(null);
    }
  }

  async function rejectBranch(req: BranchRequest) {
    if (!superAdmin) return;
    const reason = window.prompt("Rejection reason (optional):");
    setReviewingBranchId(req.id);
    try {
      await safeUpdateDoc(doc(db, "branchRequests", req.id), {
        status: "rejected",
        reviewedAt: serverTimestamp(),
        reviewedBy: superAdmin.id,
        reviewedByName: superAdmin.displayName || superAdmin.email,
        ...(reason ? { notes: reason } : {}),
      });
      setBranchRequests((prev) =>
        prev.map((r) => r.id === req.id ? { ...r, status: "rejected" } : r)
      );
    } finally {
      setReviewingBranchId(null);
    }
  }

  // Permanently delete the whole account. Irreversible — runs the
  // deleteServiceCenter callable which erases every center, login and file.
  async function approveDeletion(req: AccountDeletionRequest) {
    if (!superAdmin) return;
    const ok = window.confirm(
      `Permanently delete "${req.centerName}" and its ENTIRE account?\n\n` +
      "This erases every service center, branch, customer, vehicle, invoice, " +
      "staff login and file for this owner. This CANNOT be undone.",
    );
    if (!ok) return;
    setDeletingId(req.id);
    try {
      const fn = httpsCallable(functions, "deleteServiceCenter");
      await fn({ centerId: req.centerId, requestId: req.id });
      setDeletionRequests((prev) =>
        prev.map((r) => r.id === req.id ? { ...r, status: "completed" } : r)
      );
    } catch (e) {
      window.alert(`Deletion failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setDeletingId(null);
    }
  }

  async function rejectDeletion(req: AccountDeletionRequest) {
    if (!superAdmin) return;
    const reason = window.prompt("Rejection reason (optional):");
    setDeletingId(req.id);
    try {
      await safeUpdateDoc(doc(db, "accountDeletionRequests", req.id), {
        status: "rejected",
        reviewedAt: serverTimestamp(),
        reviewedBy: superAdmin.id,
        reviewedByName: superAdmin.displayName || superAdmin.email,
        ...(reason ? { reason } : {}),
      });
      // Clear the pending flag so the owner's Danger Zone unlocks again.
      await safeUpdateDoc(doc(db, "servicecenters", req.centerId), {
        deletionRequestedAt: null,
      }).catch(() => {});
      setDeletionRequests((prev) =>
        prev.map((r) => r.id === req.id ? { ...r, status: "rejected" } : r)
      );
    } finally {
      setDeletingId(null);
    }
  }

  const filteredUpgrade = filterStatus === "pending"
    ? upgradeRequests.filter((r) => r.status === "pending")
    : upgradeRequests;
  const filteredSlip = filterStatus === "pending"
    ? slipRequests.filter((r) => r.status === "pending")
    : slipRequests;
  const filteredDeletion = filterStatus === "pending"
    ? deletionRequests.filter((r) => r.status === "pending")
    : deletionRequests;
  const filteredStoreAddon = filterStatus === "pending"
    ? storeAddonRequests.filter((r) => r.status === "pending")
    : storeAddonRequests;
  const filteredSmsPackage = filterStatus === "pending"
    ? smsPackageRequests.filter((r) => r.status === "pending")
    : smsPackageRequests;
  const filteredBranch = filterStatus === "pending"
    ? branchRequests.filter((r) => r.status === "pending")
    : branchRequests;

  const pendingUpgradeCount = upgradeRequests.filter((r) => r.status === "pending").length;
  const pendingSlipCount = slipRequests.filter((r) => r.status === "pending").length;
  const pendingDeletionCount = deletionRequests.filter((r) => r.status === "pending").length;
  const pendingStoreAddonCount = storeAddonRequests.filter((r) => r.status === "pending").length;
  const pendingSmsPackageCount = smsPackageRequests.filter((r) => r.status === "pending").length;
  const pendingBranchCount = branchRequests.filter((r) => r.status === "pending").length;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Requests</h1>
          <p className="text-sm text-gray-400 mt-1">Review plan changes and payment slip submissions</p>
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
          label="Plan Requests"
          badge={pendingUpgradeCount}
        />
        <TabButton
          active={tab === "payment"}
          onClick={() => setTab("payment")}
          label="Payment Slips"
          badge={pendingSlipCount}
        />
        <TabButton
          active={tab === "storeAddon"}
          onClick={() => setTab("storeAddon")}
          label="Store Add-ons"
          badge={pendingStoreAddonCount}
        />
        <TabButton
          active={tab === "smsPackage"}
          onClick={() => setTab("smsPackage")}
          label="SMS Packages"
          badge={pendingSmsPackageCount}
        />
        <TabButton
          active={tab === "branch"}
          onClick={() => setTab("branch")}
          label="Branches"
          badge={pendingBranchCount}
        />
        <TabButton
          active={tab === "deletion"}
          onClick={() => setTab("deletion")}
          label="Deletions"
          badge={pendingDeletionCount}
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
      ) : tab === "payment" ? (
        <SlipList
          requests={filteredSlip}
          confirmingId={confirmingSlipId}
          onConfirm={confirmSlip}
          onReject={rejectSlip}
          onViewSlip={setViewSlip}
        />
      ) : tab === "storeAddon" ? (
        <StoreAddonList
          requests={filteredStoreAddon}
          confirmingId={confirmingAddonId}
          onConfirm={confirmStoreAddon}
          onReject={rejectStoreAddon}
          onViewSlip={setViewSlip}
        />
      ) : tab === "smsPackage" ? (
        <SmsPackageList
          requests={filteredSmsPackage}
          confirmingId={confirmingSmsPackageId}
          onConfirm={confirmSmsPackage}
          onReject={rejectSmsPackage}
          onViewSlip={setViewSlip}
        />
      ) : tab === "branch" ? (
        <BranchList
          requests={filteredBranch}
          reviewingId={reviewingBranchId}
          onApprove={approveBranch}
          onReject={rejectBranch}
        />
      ) : (
        <DeletionList
          requests={filteredDeletion}
          deletingId={deletingId}
          onApprove={approveDeletion}
          onReject={rejectDeletion}
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
        <p className="text-sm text-gray-500">No plan change requests</p>
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
                {req.requestedPlan === "basic"
                  ? "Downgrade to Basic"
                  : `Pro Plan — ${req.period === "yearly" ? "Yearly" : "Monthly"}`}
                <span className="text-gray-400 ml-2">
                  {req.requestedPlan === "basic" ? "No charge" : `LKR ${req.amount.toLocaleString()}`}
                </span>
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

          {req.slipUrl && (
            <button
              onClick={() => onViewSlip(req.slipUrl!)}
              className="flex items-center gap-2 text-xs text-orange-400 hover:text-orange-300 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              View Payment Slip
            </button>
          )}

          {req.status === "pending" && (
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => onApprove(req)}
                disabled={reviewingId === req.id}
                className="flex-1 flex items-center justify-center gap-1.5 bg-green-500/15 hover:bg-green-500/25 text-green-400 text-xs font-medium py-2 rounded-lg transition disabled:opacity-60"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                {reviewingId === req.id
                  ? "Processing…"
                  : req.requestedPlan === "basic" ? "Approve Downgrade to Basic" : "Approve & Upgrade to Pro"}
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

function StoreAddonList({
  requests, confirmingId, onConfirm, onReject, onViewSlip,
}: {
  requests: StoreAddonRequest[];
  confirmingId: string | null;
  onConfirm: (r: StoreAddonRequest) => void;
  onReject: (r: StoreAddonRequest) => void;
  onViewSlip: (url: string) => void;
}) {
  if (requests.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center">
        <Store className="w-8 h-8 text-gray-700 mx-auto mb-3" />
        <p className="text-sm text-gray-500">No store add-on purchase requests</p>
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
                {STORE_ADDON_LABEL[req.addon]} add-on
                <span className="text-gray-400 ml-2">LKR {req.amount.toLocaleString()}/mo</span>
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
                {confirmingId === req.id ? "Processing…" : "Confirm & Unlock"}
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

function SmsPackageList({
  requests, confirmingId, onConfirm, onReject, onViewSlip,
}: {
  requests: SmsPackageRequest[];
  confirmingId: string | null;
  onConfirm: (r: SmsPackageRequest) => void;
  onReject: (r: SmsPackageRequest) => void;
  onViewSlip: (url: string) => void;
}) {
  if (requests.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center">
        <MessageSquare className="w-8 h-8 text-gray-700 mx-auto mb-3" />
        <p className="text-sm text-gray-500">No SMS package purchase requests</p>
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
                {SMS_PACKAGE_LABEL[req.package]} · {req.quota.toLocaleString()} SMS
                <span className="text-gray-400 ml-2">
                  LKR {req.amount.toLocaleString()}{req.billingType === "recurring" ? "/mo" : " one-time"}
                </span>
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Payment code: <span className="font-mono text-orange-400">{req.paymentCode}</span>
                {req.createdAt && (
                  <span className="ml-2">
                    · {new Date((req.createdAt as unknown as { seconds: number }).seconds * 1000).toLocaleDateString()}
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
                {confirmingId === req.id ? "Processing…" : "Confirm & Add Credits"}
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

function BranchList({
  requests, reviewingId, onApprove, onReject,
}: {
  requests: BranchRequest[];
  reviewingId: string | null;
  onApprove: (r: BranchRequest) => void;
  onReject: (r: BranchRequest) => void;
}) {
  if (requests.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center">
        <Building2 className="w-8 h-8 text-gray-700 mx-auto mb-3" />
        <p className="text-sm text-gray-500">No new branch requests</p>
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
                New branch: {req.requestedBranchName}
                <span className="text-gray-400 ml-2">LKR 4,000/mo</span>
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {req.address}, {req.district} · {req.phone}
                {req.createdAt && (
                  <span className="ml-2">
                    · {new Date((req.createdAt as unknown as { seconds: number }).seconds * 1000).toLocaleDateString()}
                  </span>
                )}
              </p>
              {req.notes && <p className="text-xs text-gray-500 mt-0.5">{req.notes}</p>}
            </div>
            <StatusBadge status={req.status} />
          </div>

          {req.status === "pending" && (
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => onApprove(req)}
                disabled={reviewingId === req.id}
                className="flex-1 flex items-center justify-center gap-1.5 bg-green-500/15 hover:bg-green-500/25 text-green-400 text-xs font-medium py-2 rounded-lg transition disabled:opacity-60"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                {reviewingId === req.id ? "Processing…" : "Approve"}
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

function DeletionList({
  requests, deletingId, onApprove, onReject,
}: {
  requests: AccountDeletionRequest[];
  deletingId: string | null;
  onApprove: (r: AccountDeletionRequest) => void;
  onReject: (r: AccountDeletionRequest) => void;
}) {
  if (requests.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center">
        <Trash2 className="w-8 h-8 text-gray-700 mx-auto mb-3" />
        <p className="text-sm text-gray-500">No account deletion requests</p>
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
              <p className="text-sm text-red-300 mt-0.5">Permanent account deletion — whole account</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Requested by {req.requestedByName || "Owner"}
                {req.createdAt && (
                  <span className="ml-2">
                    · {new Date(req.createdAt.seconds * 1000).toLocaleDateString()}
                  </span>
                )}
              </p>
              {req.reason && <p className="text-xs text-gray-500 mt-0.5">{req.reason}</p>}
            </div>
            <StatusBadgeDeletion status={req.status} />
          </div>

          {req.status === "pending" && (
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => onApprove(req)}
                disabled={deletingId === req.id}
                className="flex-1 flex items-center justify-center gap-1.5 bg-red-500/15 hover:bg-red-500/25 text-red-400 text-xs font-medium py-2 rounded-lg transition disabled:opacity-60"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {deletingId === req.id ? "Deleting…" : "Approve & Delete Permanently"}
              </button>
              <button
                onClick={() => onReject(req)}
                disabled={deletingId === req.id}
                className="flex-1 flex items-center justify-center gap-1.5 bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-medium py-2 rounded-lg transition disabled:opacity-60"
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

function StatusBadgeDeletion({ status }: { status: string }) {
  if (status === "pending") return (
    <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 whitespace-nowrap">
      <Clock className="w-3 h-3" /> Pending
    </span>
  );
  if (status === "completed") return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">Deleted</span>
  );
  return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-600/30 text-gray-300">Rejected</span>;
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
