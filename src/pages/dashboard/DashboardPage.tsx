import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection, query, where, onSnapshot, orderBy, limit,
  doc, getDoc, Timestamp, updateDoc,
} from "firebase/firestore";
import {
  Wrench, Clock, CheckCircle2, DollarSign, Car,
  Send, Package, ChevronRight,
  MessageSquare, TrendingUp, X,
} from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type { UserRole } from "../../types/auth";
import { useTranslation } from "react-i18next";

// ── Local Types ────────────────────────────────────────────────────────────────
interface ServiceJob {
  id: string;
  plateNumber: string;
  customerName: string;
  services?: string[];
  customServices?: string[];
  status: "pending" | "in_progress" | "done" | "delivered";
  updatedAt: Timestamp;
}

interface InvoiceLite {
  id: string;
  status: "pending" | "partial" | "paid";
  paidAmount?: number;
  grandTotal?: number;
  paidAt?: Timestamp;
  updatedAt?: Timestamp;
}

interface ReminderVehicle {
  id: string;
  plateNumber: string;
  customerName: string;
  customerPhone: string;
  currentMileageKm: number;
  nextServiceMileageKm: number;
  lastReminderAt?: Timestamp;
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
  status?: "active" | "grace_period" | "pending_payment" | "blocked";
  currentPeriodEnd?: Timestamp;
  graceDeadline?: Timestamp;
  reminderThresholdKm: number;
  reminderCooldownDays: number;
  smsQuotaUsed?: number;
  smsQuotaTotal?: number;
  smsQuotaLimit?: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function timeAgo(ts: Timestamp): string {
  const seconds = Math.floor((Date.now() - ts.toMillis()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
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

function AttentionChip({ icon, label, tone, onClick }: {
  icon: React.ReactNode;
  label: string;
  tone: "red" | "amber" | "blue";
  onClick: () => void;
}) {
  const tones = {
    red: "bg-red-500/10 border-red-500/30 text-red-300 hover:bg-red-500/20",
    amber: "bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20",
    blue: "bg-blue-500/10 border-blue-500/30 text-blue-300 hover:bg-blue-500/20",
  };
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border text-sm font-medium transition ${tones[tone]}`}
    >
      {icon}
      <span>{label}</span>
      <ChevronRight className="h-3.5 w-3.5 opacity-60" />
    </button>
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

// ── Main Dashboard ─────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { currentUser } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [serviceCenter, setServiceCenter] = useState<ServiceCenter | null>(null);
  const [jobs, setJobs] = useState<ServiceJob[]>([]);
  const [recentJobs, setRecentJobs] = useState<ServiceJob[]>([]);
  const [paidInvoices, setPaidInvoices] = useState<InvoiceLite[]>([]);
  const [pendingInvoices, setPendingInvoices] = useState<InvoiceLite[]>([]);
  const [reminders, setReminders] = useState<ReminderVehicle[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [sendingBulk, setSendingBulk] = useState(false);
  const [dismissedBanner, setDismissedBanner] = useState<string | null>(null);

  const centerId = currentUser?.centerId;
  const role = currentUser?.role;
  const pro = isPro(serviceCenter?.plan);

  // ── Service center config ──
  useEffect(() => {
    if (!centerId) return;
    getDoc(doc(db, "servicecenters", centerId)).then(snap => {
      if (snap.exists()) setServiceCenter(snap.data() as ServiceCenter);
    });
  }, [centerId]);

  // ── Today's jobs ──
  useEffect(() => {
    if (!centerId) return;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const q = query(
      collection(db, "servicecenters", centerId, "jobs"),
      where("createdAt", ">=", Timestamp.fromDate(startOfDay)),
    );
    return onSnapshot(q, snap => {
      setJobs(snap.docs.map(d => ({ id: d.id, ...d.data() } as ServiceJob)));
    });
  }, [centerId]);

  // ── Recent 5 jobs ──
  useEffect(() => {
    if (!centerId) return;
    const q = query(
      collection(db, "servicecenters", centerId, "jobs"),
      orderBy("updatedAt", "desc"),
      limit(5),
    );
    return onSnapshot(q, snap => {
      setRecentJobs(snap.docs.map(d => ({ id: d.id, ...d.data() } as ServiceJob)));
    });
  }, [centerId]);

  // ── Invoices with payments (for today's revenue) ──
  useEffect(() => {
    if (!centerId) return;
    const q = query(
      collection(db, "servicecenters", centerId, "invoices"),
      where("status", "in", ["paid", "partial"]),
    );
    return onSnapshot(q, snap => {
      setPaidInvoices(snap.docs.map(d => ({ id: d.id, ...d.data() } as InvoiceLite)));
    });
  }, [centerId]);

  // ── Unpaid invoices (for the attention strip) ──
  useEffect(() => {
    if (!centerId) return;
    const q = query(
      collection(db, "servicecenters", centerId, "invoices"),
      where("status", "==", "pending"),
    );
    return onSnapshot(q, snap => {
      setPendingInvoices(snap.docs.map(d => ({ id: d.id, ...d.data() } as InvoiceLite)));
    });
  }, [centerId]);

  // ── Reminder vehicles ──
  useEffect(() => {
    if (!centerId || !serviceCenter) return;
    const cooldownMs = (serviceCenter.reminderCooldownDays ?? 7) * 86400000;
    const q = query(collection(db, "servicecenters", centerId, "vehicles"));
    return onSnapshot(q, snap => {
      const due: ReminderVehicle[] = [];
      snap.docs.forEach(d => {
        const v = d.data() as ReminderVehicle & { nextServiceMileageKm: number; currentMileageKm: number };
        const gap = v.nextServiceMileageKm - v.currentMileageKm;
        const lastReminder = v.lastReminderAt?.toMillis() ?? 0;
        // A vehicle is due once it reaches its next-service mileage (gap <= 0).
        // The km threshold limiter has been removed.
        if (gap <= 0 && Date.now() - lastReminder > cooldownMs) {
          due.push({ ...v, id: d.id });
        }
      });
      setReminders(due);
    });
  }, [centerId, serviceCenter]);

  // ── Low inventory (Pro only) ──
  useEffect(() => {
    if (!centerId || !pro) return;
    const q = query(collection(db, "servicecenters", centerId, "inventory"));
    return onSnapshot(q, snap => {
      const low: InventoryItem[] = [];
      snap.docs.forEach(d => {
        const item = d.data() as InventoryItem;
        if (item.currentQty <= item.threshold) low.push({ ...item, id: d.id });
      });
      setInventory(low);
    });
  }, [centerId, pro]);

  // ── Derived stats ──
  const newJobsToday = jobs.length;
  const inProgress = jobs.filter(j => j.status === "in_progress").length;
  const completedToday = jobs.filter(j => (j.status === "done" || j.status === "delivered") && j.updatedAt && isToday(j.updatedAt)).length;
  const revenueToday = paidInvoices
    .filter(inv => {
      const ts = inv.paidAt ?? inv.updatedAt;
      return ts && isToday(ts);
    })
    .reduce((sum, inv) => sum + (inv.paidAmount ?? inv.grandTotal ?? 0), 0);

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
  const smsUsed = serviceCenter?.smsQuotaUsed ?? 0;
  const smsTotal = serviceCenter?.smsQuotaTotal ?? serviceCenter?.smsQuotaLimit ?? (serviceCenter?.plan === "pro" ? 1000 : 200);
  const smsPct = smsTotal > 0 ? (smsUsed / smsTotal) * 100 : 0;
  const showSmsBanner = smsPct >= 80 && dismissedBanner !== "sms";

  // ── Needs-attention strip ──
  const outstandingTotal = pendingInvoices.reduce((s, i) => s + (i.grandTotal ?? 0), 0);
  const hasAttentionItems =
    (pro && inventory.length > 0) || reminders.length > 0 || pendingInvoices.length > 0;

  return (
    <div className="min-h-screen bg-[#0B1120]">
      <PageHeader
        icon={<Wrench className="w-5 h-5" />}
        title={serviceCenter?.name ?? "Dashboard"}
        actions={
          <>
            {serviceCenter?.plan === "pro" && (
              <span className="text-xs font-bold bg-[#F97316]/20 text-[#F97316] border border-[#F97316]/30 px-2 py-0.5 rounded-full">PRO</span>
            )}
          </>
        }
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* ── System Banners ── */}
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

        {/* ── Needs Attention ── */}
        {hasAttentionItems && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold mr-1">
              Needs attention
            </span>
            {pro && inventory.length > 0 && (
              <AttentionChip
                icon={<Package className="h-4 w-4" />}
                label={`${inventory.length} item${inventory.length === 1 ? "" : "s"} low in stock`}
                tone="red"
                onClick={() => navigate("/inventory")}
              />
            )}
            {reminders.length > 0 && (
              <AttentionChip
                icon={<Send className="h-4 w-4" />}
                label={`${reminders.length} vehicle${reminders.length === 1 ? "" : "s"} due for service reminder`}
                tone="amber"
                onClick={() => document.getElementById("reminders-section")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              />
            )}
            {pendingInvoices.length > 0 && (
              <AttentionChip
                icon={<DollarSign className="h-4 w-4" />}
                label={`${pendingInvoices.length} unpaid invoice${pendingInvoices.length === 1 ? "" : "s"} · LKR ${outstandingTotal.toLocaleString()}`}
                tone="blue"
                onClick={() => navigate("/invoices")}
              />
            )}
          </div>
        )}

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
          <StatCard
            icon={<DollarSign className="h-5 w-5 text-emerald-400" />}
            label="Revenue Today"
            value={`LKR ${revenueToday.toLocaleString()}`}
            sub="Paid invoices"
            onClick={() => navigate("/analytics")}
            accent="bg-emerald-500/10"
          />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          <div className="xl:col-span-2 space-y-8">
            {/* ── Service Reminders ── */}
            <div id="reminders-section" className="bg-[#162032] border border-white/10 rounded-2xl p-6 scroll-mt-4">
              <SectionHeader title={t("dashboard.serviceReminders")}>
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
              <SectionHeader title={t("dashboard.recentServices")}>
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
                            <p className="text-xs text-gray-400 truncate">
                              {job.customerName}
                              {(() => {
                                const all = [...(job.services ?? []), ...(job.customServices ?? [])];
                                if (all.length === 0) return null;
                                return ` · ${all[0]}${all.length > 1 ? ` +${all.length - 1} more` : ""}`;
                              })()}
                            </p>
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
          <div className="space-y-6">
            {/* Quick Actions */}
            <div className="bg-[#162032] border border-white/10 rounded-2xl p-6">
              <SectionHeader title="Quick Actions" />
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => navigate("/services/new")} className="flex flex-col items-center gap-2 bg-[#F97316]/10 hover:bg-[#F97316]/20 border border-[#F97316]/20 rounded-xl py-3 transition">
                  <Wrench className="h-5 w-5 text-[#F97316]" />
                  <span className="text-xs font-medium text-white">New Job</span>
                </button>
                <button onClick={() => navigate("/customers/add")} className="flex flex-col items-center gap-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 rounded-xl py-3 transition">
                  <Car className="h-5 w-5 text-blue-400" />
                  <span className="text-xs font-medium text-white">Add Customer</span>
                </button>
                <button onClick={() => navigate("/invoices")} className="flex flex-col items-center gap-2 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-xl py-3 transition">
                  <DollarSign className="h-5 w-5 text-emerald-400" />
                  <span className="text-xs font-medium text-white">Invoices</span>
                </button>
                <button onClick={() => navigate("/accounting")} className="flex flex-col items-center gap-2 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 rounded-xl py-3 transition">
                  <TrendingUp className="h-5 w-5 text-purple-400" />
                  <span className="text-xs font-medium text-white">Accounting</span>
                </button>
              </div>
            </div>

            {/* ── Low Inventory (Pro + Owner/Manager) — kept above the fold so
                 stock warnings aren't missed ── */}
            {pro && canManage(role) && (
              <div className="bg-[#162032] border border-white/10 rounded-2xl p-6">
                <SectionHeader title={t("dashboard.lowInventory")}>
                  <span className="flex items-center gap-1.5">
                    {inventory.length > 0 && (
                      <span className="text-xs bg-red-500/15 text-red-300 border border-red-500/30 px-2 py-0.5 rounded-full font-semibold">
                        {inventory.length}
                      </span>
                    )}
                    <span className="text-xs bg-[#F97316]/10 text-[#F97316] border border-[#F97316]/20 px-2 py-0.5 rounded-full font-medium">PRO</span>
                  </span>
                </SectionHeader>

                {inventory.length === 0 ? (
                  <div className="flex flex-col items-center py-6 gap-2">
                    <Package className="h-7 w-7 text-gray-600" />
                    <p className="text-xs text-gray-500">Stock levels are healthy</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {inventory.slice(0, 5).map(item => (
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
                    {inventory.length > 5 && (
                      <button
                        onClick={() => navigate("/inventory")}
                        className="w-full text-center text-xs text-[#F97316] hover:text-[#fb923c] py-2 transition"
                      >
                        View all {inventory.length} low-stock items →
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Today's Summary */}
            <div className="bg-[#162032] border border-white/10 rounded-2xl p-6">
              <SectionHeader title={t("dashboard.todayAtAGlance")} />
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">Total Jobs</span>
                  <span className="text-white font-semibold">{newJobsToday}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">In Progress</span>
                  <span className="text-amber-400 font-semibold">{inProgress}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">Completed</span>
                  <span className="text-green-400 font-semibold">{completedToday}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">Reminders Due</span>
                  <span className="text-orange-400 font-semibold">{reminders.length}</span>
                </div>
                <div className="border-t border-white/5 pt-3 flex items-center justify-between text-sm">
                  <span className="text-gray-400">SMS Used</span>
                  <span className="text-white font-semibold">{smsUsed} / {smsTotal}</span>
                </div>
                <div className="w-full bg-white/5 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full ${smsPct >= 100 ? "bg-red-500" : smsPct >= 80 ? "bg-amber-500" : "bg-green-500"}`}
                    style={{ width: `${Math.min(smsPct, 100)}%` }}
                  />
                </div>
              </div>
            </div>

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
