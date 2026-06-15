import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection, query, where, onSnapshot, orderBy, limit,
  doc, getDoc, Timestamp, updateDoc, type QueryConstraint,
} from "firebase/firestore";
import {
  Wrench, Clock, CheckCircle2, DollarSign, Bell, Car, Users,
  Plus, Send, Package, AlertTriangle, LogOut, ChevronRight,
  MessageSquare, TrendingUp, X, Building2, ChevronDown,
} from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { useBranch } from "../../contexts/BranchContext";
import type { UserRole, Branch } from "../../types/auth";

// ── Local Types ────────────────────────────────────────────────────────────────
interface ServiceJob {
  id: string;
  plateNumber: string;
  customerName: string;
  serviceType: string;
  status: "pending" | "in_progress" | "done" | "delivered";
  updatedAt: Timestamp;
  totalAmount?: number;
  paidAt?: Timestamp;
  branchId?: string;
}

interface ReminderVehicle {
  id: string;
  plateNumber: string;
  customerName: string;
  customerPhone: string;
  currentMileageKm: number;
  nextServiceMileageKm: number;
  lastReminderAt?: Timestamp;
  branchId?: string;
}

interface InventoryItem {
  id: string;
  name: string;
  category: string;
  currentQty: number;
  threshold: number;
  unit: string;
}

interface ServiceCenter {
  name: string;
  plan: "basic" | "pro";
  trialEndsAt: Timestamp;
  reminderThresholdKm: number;
  reminderCooldownDays: number;
  smsQuotaUsed?: number;
  smsQuotaTotal?: number;
  smsQuotaLimit?: number;
}

interface BranchBreakdown {
  branch: Branch;
  activeJobs: number;
  completedToday: number;
  revenueThisMonth: number;
  vehicleCount: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function timeAgo(ts: Timestamp): string {
  const seconds = Math.floor((Date.now() - ts.toMillis()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function daysUntil(ts: Timestamp): number {
  return Math.ceil((ts.toMillis() - Date.now()) / 86400000);
}

function isToday(ts: Timestamp): boolean {
  const d = ts.toDate();
  const now = new Date();
  return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

const STATUS_CONFIG = {
  pending:     { label: "Pending",     bg: "bg-gray-500/20",   text: "text-gray-300",   dot: "bg-gray-400" },
  in_progress: { label: "In Progress", bg: "bg-amber-500/20",  text: "text-amber-300",  dot: "bg-amber-400" },
  done:        { label: "Done",        bg: "bg-green-500/20",  text: "text-green-300",  dot: "bg-green-400" },
  delivered:   { label: "Delivered",   bg: "bg-blue-900/30",   text: "text-blue-300",   dot: "bg-blue-400" },
};

const canManage = (role?: UserRole) => role === "Owner" || role === "Manager";
const isPro = (plan?: string) => plan === "pro";

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, onClick, accent }: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  onClick?: () => void;
  accent?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="bg-[#162032] border border-white/10 rounded-2xl p-5 text-left hover:border-[#F97316]/40 hover:bg-[#1a2840] transition-all group w-full"
    >
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2.5 rounded-xl ${accent ?? "bg-[#F97316]/10"}`}>
          {icon}
        </div>
        <ChevronRight className="h-4 w-4 text-gray-600 group-hover:text-[#F97316] transition mt-0.5" />
      </div>
      <div className="text-2xl font-bold text-white mb-0.5">{value}</div>
      <div className="text-sm text-gray-400">{label}</div>
      {sub && <div className="text-xs text-gray-600 mt-0.5">{sub}</div>}
    </button>
  );
}

function SectionHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-base font-semibold text-white">{title}</h2>
      {children}
    </div>
  );
}

function EmptyState({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="mb-3 text-gray-600">{icon}</div>
      <p className="text-sm text-gray-500">{message}</p>
    </div>
  );
}

function BranchSelector({
  branches, activeBranchId, isOwner, isAllBranches, onChange,
}: {
  branches: Branch[];
  activeBranchId: string | null;
  isOwner: boolean;
  isAllBranches: boolean;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = isAllBranches
    ? "All Branches"
    : (branches.find(b => b.id === activeBranchId)?.name ?? "Select Branch");

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-sm text-gray-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg transition"
      >
        <Building2 className="h-3.5 w-3.5 text-[#F97316] flex-shrink-0" />
        <span className="max-w-[130px] truncate">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 text-gray-500 flex-shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full mt-1 left-0 bg-[#162032] border border-white/10 rounded-xl shadow-xl z-50 min-w-[180px] overflow-hidden">
            {isOwner && (
              <button
                onClick={() => { onChange(null); setOpen(false); }}
                className={`w-full text-left px-4 py-2.5 text-sm hover:bg-white/5 transition flex items-center gap-2 border-b border-white/5 ${
                  isAllBranches ? "text-[#F97316] font-medium" : "text-gray-300"
                }`}
              >
                <Building2 className="h-3.5 w-3.5 flex-shrink-0" />
                All Branches
              </button>
            )}
            {branches.map(b => (
              <button
                key={b.id}
                onClick={() => { onChange(b.id); setOpen(false); }}
                className={`w-full text-left px-4 py-2.5 text-sm hover:bg-white/5 transition flex items-center gap-2 ${
                  activeBranchId === b.id && !isAllBranches ? "text-[#F97316] font-medium" : "text-gray-300"
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
                {b.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function BranchBreakdownTable({
  breakdowns, onBranchClick, showRevenue,
}: {
  breakdowns: BranchBreakdown[];
  onBranchClick: (id: string) => void;
  showRevenue: boolean;
}) {
  return (
    <div className="bg-[#162032] border border-white/10 rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">Branch Breakdown</h2>
        <span className="text-xs text-gray-500">{breakdowns.length} branch{breakdowns.length !== 1 ? "es" : ""}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5">
              <th className="text-left text-xs text-gray-500 font-medium px-6 py-3">Branch</th>
              <th className="text-right text-xs text-gray-500 font-medium px-4 py-3">Active Jobs</th>
              <th className="text-right text-xs text-gray-500 font-medium px-4 py-3">Completed Today</th>
              {showRevenue && (
                <th className="text-right text-xs text-gray-500 font-medium px-4 py-3">Revenue This Month</th>
              )}
              <th className="text-right text-xs text-gray-500 font-medium px-6 py-3">Vehicles</th>
            </tr>
          </thead>
          <tbody>
            {breakdowns.map(({ branch, activeJobs, completedToday, revenueThisMonth, vehicleCount }) => (
              <tr
                key={branch.id}
                onClick={() => onBranchClick(branch.id)}
                className="border-b border-white/5 last:border-0 hover:bg-white/5 cursor-pointer transition group"
              >
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-[#F97316] flex-shrink-0" />
                    <div>
                      <p className="text-white font-medium group-hover:text-[#F97316] transition">{branch.name}</p>
                      {branch.district && <p className="text-xs text-gray-500">{branch.district}</p>}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4 text-right">
                  <span className={`text-sm font-semibold ${activeJobs > 0 ? "text-amber-300" : "text-gray-600"}`}>
                    {activeJobs}
                  </span>
                </td>
                <td className="px-4 py-4 text-right">
                  <span className={`text-sm font-semibold ${completedToday > 0 ? "text-green-300" : "text-gray-600"}`}>
                    {completedToday}
                  </span>
                </td>
                {showRevenue && (
                  <td className="px-4 py-4 text-right">
                    <span className="text-sm font-medium text-white">
                      LKR {revenueThisMonth.toLocaleString()}
                    </span>
                  </td>
                )}
                <td className="px-6 py-4 text-right">
                  <span className="text-sm text-gray-400">{vehicleCount}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { currentUser, logout } = useAuth();
  const {
    branches, allBranches, activeBranchId, setActiveBranchId,
    activeBranch, isAllBranches, hasBranches,
  } = useBranch();
  const navigate = useNavigate();

  const [serviceCenter, setServiceCenter] = useState<ServiceCenter | null>(null);
  const [jobs, setJobs] = useState<ServiceJob[]>([]);
  const [recentJobs, setRecentJobs] = useState<ServiceJob[]>([]);
  const [reminders, setReminders] = useState<ReminderVehicle[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [sendingBulk, setSendingBulk] = useState(false);
  const [dismissedBanner, setDismissedBanner] = useState<string | null>(null);

  // Aggregate view state
  const [allActiveJobs, setAllActiveJobs] = useState<Array<{ id: string; branchId?: string }>>([]);
  const [allVehicles, setAllVehicles] = useState<Array<{ id: string; branchId?: string; isDeleted?: boolean }>>([]);
  const [allMonthInvoices, setAllMonthInvoices] = useState<Array<{ id: string; branchId?: string; grandTotal?: number }>>([]);

  const centerId = currentUser?.centerId;
  const role = currentUser?.role;
  const pro = isPro(serviceCenter?.plan);
  const shouldFilter = hasBranches && !isAllBranches && !!activeBranchId;

  // ── Service center config ──
  useEffect(() => {
    if (!centerId) return;
    getDoc(doc(db, "servicecenters", centerId)).then(snap => {
      if (snap.exists()) setServiceCenter(snap.data() as ServiceCenter);
    });
  }, [centerId]);

  // ── Today's jobs (branch-filtered) ──
  useEffect(() => {
    if (!centerId) return;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const constraints: QueryConstraint[] = [];
    if (shouldFilter) constraints.push(where("branchId", "==", activeBranchId));
    constraints.push(where("createdAt", ">=", Timestamp.fromDate(startOfDay)));
    const q = query(collection(db, "servicecenters", centerId, "services"), ...constraints);
    return onSnapshot(q, snap => {
      setJobs(snap.docs.map(d => ({ id: d.id, ...d.data() } as ServiceJob)));
    });
  }, [centerId, shouldFilter, activeBranchId]);

  // ── Recent 5 jobs (branch-filtered) ──
  useEffect(() => {
    if (!centerId) return;
    const constraints: QueryConstraint[] = [];
    if (shouldFilter) constraints.push(where("branchId", "==", activeBranchId));
    constraints.push(orderBy("updatedAt", "desc"));
    constraints.push(limit(5));
    const q = query(collection(db, "servicecenters", centerId, "services"), ...constraints);
    return onSnapshot(q, snap => {
      setRecentJobs(snap.docs.map(d => ({ id: d.id, ...d.data() } as ServiceJob)));
    });
  }, [centerId, shouldFilter, activeBranchId]);

  // ── Reminder vehicles (branch-filtered) ──
  useEffect(() => {
    if (!centerId || !serviceCenter) return;
    const cooldownMs = (serviceCenter.reminderCooldownDays ?? 7) * 86400000;
    const constraints: QueryConstraint[] = [];
    if (shouldFilter) constraints.push(where("branchId", "==", activeBranchId));
    const q = query(collection(db, "servicecenters", centerId, "vehicles"), ...constraints);
    return onSnapshot(q, snap => {
      const due: ReminderVehicle[] = [];
      snap.docs.forEach(d => {
        const v = d.data() as ReminderVehicle & { nextServiceMileageKm: number; currentMileageKm: number };
        const gap = v.nextServiceMileageKm - v.currentMileageKm;
        const lastReminder = v.lastReminderAt?.toMillis() ?? 0;
        if (gap <= serviceCenter.reminderThresholdKm && Date.now() - lastReminder > cooldownMs) {
          due.push({ ...v, id: d.id });
        }
      });
      setReminders(due);
    });
  }, [centerId, serviceCenter, shouldFilter, activeBranchId]);

  // ── Low inventory (branch-filtered, Pro only) ──
  useEffect(() => {
    if (!centerId || !pro) return;
    const constraints: QueryConstraint[] = [];
    if (shouldFilter) constraints.push(where("branchId", "==", activeBranchId));
    const q = query(collection(db, "servicecenters", centerId, "inventory"), ...constraints);
    return onSnapshot(q, snap => {
      const low: InventoryItem[] = [];
      snap.docs.forEach(d => {
        const item = d.data() as InventoryItem;
        if (item.currentQty <= item.threshold) low.push({ ...item, id: d.id });
      });
      setInventory(low);
    });
  }, [centerId, pro, shouldFilter, activeBranchId]);

  // ── Aggregate: all active jobs (All Branches mode) ──
  useEffect(() => {
    if (!centerId || !isAllBranches) { setAllActiveJobs([]); return; }
    const q = query(
      collection(db, "servicecenters", centerId, "services"),
      where("status", "in", ["pending", "in_progress"]),
    );
    return onSnapshot(q, snap => {
      setAllActiveJobs(snap.docs.map(d => ({ id: d.id, ...(d.data() as object) } as { id: string; branchId?: string })));
    });
  }, [centerId, isAllBranches]);

  // ── Aggregate: all vehicles (All Branches mode) ──
  useEffect(() => {
    if (!centerId || !isAllBranches) { setAllVehicles([]); return; }
    return onSnapshot(query(collection(db, "servicecenters", centerId, "vehicles")), snap => {
      setAllVehicles(snap.docs.map(d => ({ id: d.id, ...(d.data() as object) } as { id: string; branchId?: string; isDeleted?: boolean })));
    });
  }, [centerId, isAllBranches]);

  // ── Aggregate: paid invoices this month (All Branches + Pro) ──
  useEffect(() => {
    if (!centerId || !isAllBranches || !pro) { setAllMonthInvoices([]); return; }
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const q = query(
      collection(db, "servicecenters", centerId, "invoices"),
      where("createdAt", ">=", Timestamp.fromDate(startOfMonth)),
      where("status", "==", "paid"),
    );
    return onSnapshot(q, snap => {
      setAllMonthInvoices(snap.docs.map(d => ({ id: d.id, ...(d.data() as object) } as { id: string; branchId?: string; grandTotal?: number })));
    });
  }, [centerId, isAllBranches, pro]);

  // ── Derived stats ──
  const newJobsToday = jobs.length;
  const inProgress = jobs.filter(j => j.status === "in_progress").length;
  const completedToday = jobs.filter(j => j.status === "done" && j.updatedAt && isToday(j.updatedAt)).length;
  const revenueToday = jobs
    .filter(j => j.paidAt && isToday(j.paidAt))
    .reduce((sum, j) => sum + (j.totalAmount ?? 0), 0);

  // ── Branch breakdown (All Branches mode) ──
  const branchBreakdowns: BranchBreakdown[] = isAllBranches
    ? allBranches.filter(b => b.active).map(branch => ({
        branch,
        activeJobs: allActiveJobs.filter(j => j.branchId === branch.id).length,
        completedToday: jobs.filter(j => j.branchId === branch.id && (j.status === "done" || j.status === "delivered")).length,
        vehicleCount: allVehicles.filter(v => v.branchId === branch.id && !v.isDeleted).length,
        revenueThisMonth: allMonthInvoices
          .filter(inv => inv.branchId === branch.id)
          .reduce((sum, inv) => sum + (inv.grandTotal ?? 0), 0),
      }))
    : [];

  // ── Send single reminder ──
  async function sendReminder(vehicle: ReminderVehicle) {
    if (!centerId) return;
    setSendingReminder(vehicle.id);
    try {
      await updateDoc(doc(db, "servicecenters", centerId, "vehicles", vehicle.id), {
        lastReminderAt: Timestamp.now(),
      });
    } finally {
      setSendingReminder(null);
    }
  }

  // ── Send bulk reminders ──
  async function sendBulkReminders() {
    if (!centerId) return;
    setSendingBulk(true);
    try {
      await Promise.all(reminders.map(v =>
        updateDoc(doc(db, "servicecenters", centerId, "vehicles", v.id), {
          lastReminderAt: Timestamp.now(),
        })
      ));
      setBulkModalOpen(false);
    } finally {
      setSendingBulk(false);
    }
  }

  // ── Banners ──
  const trialDaysLeft = serviceCenter?.trialEndsAt ? daysUntil(serviceCenter.trialEndsAt) : null;
  const showTrialBanner = trialDaysLeft !== null && trialDaysLeft <= 7 && trialDaysLeft >= 0 && dismissedBanner !== "trial";
  const smsUsed = serviceCenter?.smsQuotaUsed ?? 0;
  const smsTotal = serviceCenter?.smsQuotaTotal ?? serviceCenter?.smsQuotaLimit ?? (serviceCenter?.plan === "pro" ? 1000 : 200);
  const smsPct = smsTotal > 0 ? (smsUsed / smsTotal) * 100 : 0;
  const showSmsBanner = smsPct >= 80 && dismissedBanner !== "sms";

  // ── Page title ──
  const pageTitle = isAllBranches
    ? (serviceCenter?.name ?? "Dashboard")
    : (hasBranches && activeBranch ? activeBranch.name : (serviceCenter?.name ?? "Dashboard"));

  const pageSubtitle = isAllBranches
    ? "Aggregate view across all branches"
    : (hasBranches && activeBranch
        ? `${activeBranch.address}${activeBranch.district ? `, ${activeBranch.district}` : ""}`
        : new Date().toLocaleDateString("en-LK", { weekday: "long", year: "numeric", month: "long", day: "numeric" }));

  return (
    <div className="min-h-screen bg-[#0B1120]">
      {/* ── Top Nav ── */}
      <nav className="bg-[#162032] border-b border-white/10 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="PitStop IQ" className="h-8 w-auto" />
              <span className="text-lg font-extrabold tracking-tight text-white hidden sm:block">
                PITSTOP <span className="text-[#F97316]">IQ</span>
              </span>
              {serviceCenter?.plan === "pro" && (
                <span className="text-xs font-bold bg-[#F97316]/20 text-[#F97316] border border-[#F97316]/30 px-2 py-0.5 rounded-full">PRO</span>
              )}
              {/* Branch Selector — Pro + multi-branch only */}
              {pro && hasBranches && (
                <BranchSelector
                  branches={branches}
                  activeBranchId={activeBranchId}
                  isOwner={role === "Owner"}
                  isAllBranches={isAllBranches}
                  onChange={setActiveBranchId}
                />
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <p className="text-xs text-gray-400 leading-none">{currentUser?.email}</p>
                <p className="text-xs text-[#F97316] font-medium mt-0.5">{role}</p>
              </div>
              <button
                onClick={logout}
                className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg transition"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* ── System Banners ── */}
        {showTrialBanner && (
          <div className={`relative rounded-xl px-5 py-4 border flex items-start gap-3 ${
            trialDaysLeft! <= 1
              ? "bg-red-500/10 border-red-500/30"
              : trialDaysLeft! <= 3
              ? "bg-amber-500/10 border-amber-500/30"
              : "bg-[#F97316]/10 border-[#F97316]/30"
          }`}>
            <AlertTriangle className={`h-5 w-5 mt-0.5 flex-shrink-0 ${trialDaysLeft! <= 1 ? "text-red-400" : trialDaysLeft! <= 3 ? "text-amber-400" : "text-[#F97316]"}`} />
            <div className="flex-1">
              <p className={`text-sm font-semibold ${trialDaysLeft! <= 1 ? "text-red-300" : trialDaysLeft! <= 3 ? "text-amber-300" : "text-[#F97316]"}`}>
                {trialDaysLeft === 0 ? "Your free trial expires today!" : `Free trial ends in ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"}`}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">Upgrade to keep full access to all features.</p>
            </div>
            <button onClick={() => setDismissedBanner("trial")} className="text-gray-500 hover:text-gray-300 transition">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {showSmsBanner && (
          <div className="relative rounded-xl px-5 py-4 border bg-blue-500/10 border-blue-500/30 flex items-start gap-3">
            <MessageSquare className="h-5 w-5 mt-0.5 flex-shrink-0 text-blue-400" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-blue-300">
                {smsPct >= 100 ? "SMS quota exhausted" : `SMS quota ${Math.round(smsPct)}% used`}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                {smsUsed} / {smsTotal} messages sent this month.{" "}
                {smsPct >= 100 ? "Reminders are paused until quota resets or you upgrade." : "Consider upgrading for more messages."}
              </p>
            </div>
            <button onClick={() => setDismissedBanner("sms")} className="text-gray-500 hover:text-gray-300 transition">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* ── Page Header ── */}
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-white">{pageTitle}</h1>
            {isAllBranches && (
              <span className="text-xs font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded-full">
                ALL BRANCHES
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1">{pageSubtitle}</p>
        </div>

        {/* ── Stats Strip ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={<Wrench className="h-5 w-5 text-[#F97316]" />}
            label="New Jobs Today"
            value={newJobsToday}
            onClick={() => navigate("/services?filter=today")}
            accent="bg-[#F97316]/10"
          />
          <StatCard
            icon={<Clock className="h-5 w-5 text-amber-400" />}
            label="In Progress"
            value={inProgress}
            onClick={() => navigate("/services?filter=in_progress")}
            accent="bg-amber-500/10"
          />
          <StatCard
            icon={<CheckCircle2 className="h-5 w-5 text-green-400" />}
            label="Completed Today"
            value={completedToday}
            onClick={() => navigate("/services?filter=done")}
            accent="bg-green-500/10"
          />
          {(pro && canManage(role)) ? (
            <StatCard
              icon={<DollarSign className="h-5 w-5 text-emerald-400" />}
              label="Revenue Today"
              value={`LKR ${revenueToday.toLocaleString()}`}
              sub={isAllBranches ? "All branches" : "Paid invoices"}
              onClick={() => navigate("/analytics")}
              accent="bg-emerald-500/10"
            />
          ) : (
            <div className="bg-[#162032] border border-white/5 rounded-2xl p-5 flex flex-col items-center justify-center gap-2 opacity-50">
              <TrendingUp className="h-5 w-5 text-gray-500" />
              <p className="text-xs text-gray-500 text-center">Revenue Today<br /><span className="text-[10px]">Pro plan only</span></p>
            </div>
          )}
        </div>

        {/* ── Branch Breakdown Table (Owner + All Branches) ── */}
        {isAllBranches && branchBreakdowns.length > 0 && (
          <BranchBreakdownTable
            breakdowns={branchBreakdowns}
            onBranchClick={id => setActiveBranchId(id)}
            showRevenue={pro}
          />
        )}

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          <div className="xl:col-span-2 space-y-8">
            {/* ── Service Reminders ── */}
            <div className="bg-[#162032] border border-white/10 rounded-2xl p-6">
              <SectionHeader title="Service Reminders Due">
                {canManage(role) && reminders.length > 0 && (
                  <button
                    onClick={() => setBulkModalOpen(true)}
                    className="flex items-center gap-1.5 text-xs font-medium bg-[#F97316]/10 hover:bg-[#F97316]/20 text-[#F97316] border border-[#F97316]/20 px-3 py-1.5 rounded-lg transition"
                  >
                    <Send className="h-3.5 w-3.5" />
                    Send Bulk Reminder
                  </button>
                )}
              </SectionHeader>

              {reminders.length === 0 ? (
                <div className="flex flex-col items-center py-8 gap-2">
                  <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
                    <CheckCircle2 className="h-5 w-5 text-green-400" />
                  </div>
                  <p className="text-sm text-gray-400 font-medium">All vehicles are up to date</p>
                  <p className="text-xs text-gray-600">No reminders needed.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {reminders.map(v => {
                    const gap = v.nextServiceMileageKm - v.currentMileageKm;
                    const daysSince = v.lastReminderAt
                      ? Math.floor((Date.now() - v.lastReminderAt.toMillis()) / 86400000)
                      : null;
                    return (
                      <div key={v.id} className="flex items-center justify-between gap-4 bg-[#0B1120] rounded-xl px-4 py-3 border border-white/5">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                            <Car className="h-4 w-4 text-amber-400" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-white">{v.plateNumber}</p>
                            <p className="text-xs text-gray-400 truncate">{v.customerName}</p>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 hidden sm:block">
                          <p className="text-xs text-amber-400 font-medium">{gap.toLocaleString()} km remaining</p>
                          <p className="text-xs text-gray-500">
                            {daysSince !== null ? `Last reminded ${daysSince}d ago` : "Never reminded"}
                          </p>
                        </div>
                        {canManage(role) ? (
                          <button
                            onClick={() => sendReminder(v)}
                            disabled={sendingReminder === v.id}
                            className="flex items-center gap-1.5 text-xs font-medium bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-60 text-white px-3 py-1.5 rounded-lg transition flex-shrink-0"
                          >
                            {sendingReminder === v.id ? (
                              <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                            ) : <Send className="h-3.5 w-3.5" />}
                            Send
                          </button>
                        ) : (
                          <span className="text-xs text-gray-600 flex-shrink-0">Read-only</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Recent Services ── */}
            <div className="bg-[#162032] border border-white/10 rounded-2xl p-6">
              <SectionHeader title="Recent Services">
                <button
                  onClick={() => navigate("/services")}
                  className="text-xs text-[#F97316] hover:text-[#fb923c] transition"
                >
                  View all →
                </button>
              </SectionHeader>

              {recentJobs.length === 0 ? (
                <EmptyState
                  icon={<Wrench className="h-8 w-8" />}
                  message="No service jobs yet. Create your first job to get started."
                />
              ) : (
                <div className="space-y-2">
                  {recentJobs.map(job => {
                    const s = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.pending;
                    return (
                      <button
                        key={job.id}
                        onClick={() => navigate(`/services/${job.id}`)}
                        className="w-full flex items-center justify-between gap-3 bg-[#0B1120] hover:bg-white/5 rounded-xl px-4 py-3 border border-white/5 hover:border-white/10 transition text-left"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-[#F97316]/10 flex items-center justify-center flex-shrink-0">
                            <Car className="h-4 w-4 text-[#F97316]" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-white">{job.plateNumber}</p>
                            <p className="text-xs text-gray-400 truncate">{job.customerName} · {job.serviceType}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${s.bg} ${s.text}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                            {s.label}
                          </span>
                          <span className="text-xs text-gray-600 hidden sm:block">
                            {job.updatedAt ? timeAgo(job.updatedAt) : "—"}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Right Column ── */}
          <div className="space-y-8">
            {/* ── Quick Actions ── */}
            <div className="bg-[#162032] border border-white/10 rounded-2xl p-6">
              <SectionHeader title="Quick Actions" />
              <div className="space-y-2">
                {[
                  { icon: <Plus className="h-4 w-4" />, label: "New Service", path: "/services/new", primary: true },
                  { icon: <Users className="h-4 w-4" />, label: "Add Customer", path: "/customers/new" },
                  { icon: <Car className="h-4 w-4" />, label: "Add Vehicle", path: "/vehicles/new" },
                  { icon: <MessageSquare className="h-4 w-4" />, label: "SMS Log", path: "/sms-logs" },
                  { icon: <DollarSign className="h-4 w-4" />, label: "Invoices", path: "/invoices" },
                  ...(pro && canManage(role) ? [{ icon: <Package className="h-4 w-4" />, label: "Inventory", path: "/inventory" }] : []),
                  ...(pro && canManage(role) ? [{ icon: <Users className="h-4 w-4" />, label: "Employees", path: "/employees" }] : []),
                  ...(pro && (role === "Owner" || role === "Manager" || role === "Cashier") ? [{ icon: <TrendingUp className="h-4 w-4" />, label: "Analytics", path: "/analytics" }] : []),
                  ...(canManage(role) ? [{ icon: <MessageSquare className="h-4 w-4" />, label: "SMS Settings", path: "/settings/sms" }] : []),
                  ...(pro && role === "Owner" ? [{ icon: <Building2 className="h-4 w-4" />, label: "Branches", path: "/settings/branches" }] : []),
                ].map(action => (
                  <button
                    key={action.path}
                    onClick={() => navigate(action.path)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition ${
                      action.primary
                        ? "bg-[#F97316] hover:bg-[#ea6c0f] text-white"
                        : "bg-[#0B1120] hover:bg-white/5 border border-white/5 hover:border-white/10 text-gray-300"
                    }`}
                  >
                    {action.icon}
                    {action.label}
                  </button>
                ))}
                {canManage(role) && reminders.length > 0 && (
                  <button
                    onClick={() => setBulkModalOpen(true)}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium bg-[#0B1120] hover:bg-white/5 border border-[#F97316]/20 hover:border-[#F97316]/40 text-[#F97316] transition"
                  >
                    <Bell className="h-4 w-4" />
                    Send Bulk Reminder
                    <span className="ml-auto bg-[#F97316]/20 text-[#F97316] text-xs px-2 py-0.5 rounded-full font-bold">
                      {reminders.length}
                    </span>
                  </button>
                )}
              </div>
            </div>

            {/* ── Low Inventory (Pro + Owner/Manager) ── */}
            {pro && canManage(role) && (
              <div className="bg-[#162032] border border-white/10 rounded-2xl p-6">
                <SectionHeader title="Low Inventory">
                  <span className="text-xs bg-[#F97316]/10 text-[#F97316] border border-[#F97316]/20 px-2 py-0.5 rounded-full font-medium">PRO</span>
                </SectionHeader>

                {inventory.length === 0 ? (
                  <div className="flex flex-col items-center py-6 gap-2">
                    <Package className="h-7 w-7 text-gray-600" />
                    <p className="text-xs text-gray-500">Stock levels are healthy</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {inventory.map(item => (
                      <div key={item.id} className="bg-[#0B1120] rounded-xl px-4 py-3 border border-red-500/10">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <p className="text-sm font-medium text-white truncate">{item.name}</p>
                          <button
                            onClick={() => navigate("/inventory")}
                            className="text-xs text-[#F97316] hover:text-[#fb923c] transition flex-shrink-0 font-medium"
                          >
                            Restock →
                          </button>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-500">{item.category}</span>
                          <span className="text-xs text-red-400 font-medium">
                            {item.currentQty} / {item.threshold} {item.unit}
                          </span>
                        </div>
                        <div className="mt-2 h-1.5 bg-white/5 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-red-500 rounded-full"
                            style={{ width: `${Math.min(100, (item.currentQty / item.threshold) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Bulk Reminder Modal ── */}
      {bulkModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setBulkModalOpen(false)} />
          <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Send Bulk Reminders</h3>
              <button onClick={() => setBulkModalOpen(false)} className="text-gray-500 hover:text-gray-300 transition">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="bg-[#0B1120] rounded-xl p-4 mb-4 border border-white/5">
              <p className="text-sm text-gray-300 mb-1">
                <strong className="text-white">{reminders.length} vehicle{reminders.length === 1 ? "" : "s"}</strong> will receive an SMS reminder.
              </p>
              <p className="text-xs text-gray-500">
                This will use <strong className="text-white">{reminders.length} SMS credit{reminders.length === 1 ? "" : "s"}</strong> from your quota ({smsUsed}/{smsTotal} used).
              </p>
            </div>

            <div className="max-h-48 overflow-y-auto space-y-2 mb-5">
              {reminders.map(v => (
                <div key={v.id} className="flex items-center justify-between text-sm bg-[#0B1120] rounded-lg px-3 py-2 border border-white/5">
                  <span className="font-medium text-white">{v.plateNumber}</span>
                  <span className="text-gray-400">{v.customerName}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setBulkModalOpen(false)}
                className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 px-4 rounded-lg transition text-sm"
              >
                Cancel
              </button>
              <button
                onClick={sendBulkReminders}
                disabled={sendingBulk}
                className="flex-1 bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-60 text-white font-semibold py-2.5 px-4 rounded-lg transition text-sm flex items-center justify-center gap-2"
              >
                {sendingBulk ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Sending…
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Send All
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
