import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, orderBy, query } from "firebase/firestore";
import { boundedGetDocs } from "../../lib/firestoreRead";
import { db } from "../../config/firebase";
import {
  Plus, Search, ChevronRight, ChevronDown, CheckCircle, XCircle,
  Building2, User, Activity, Wallet,
} from "lucide-react";
import type { ServiceCenter } from "../../types/auth";
import {
  ACTIVE_WINDOW_DAYS, fetchCenterUsage, isActiveUser, isPayingCustomer,
  sinceLabel, type CenterUsage,
} from "../../lib/centerUsage";

interface OwnerGroup {
  ownerUid: string;
  ownerName: string;
  ownerPhone: string;
  branches: ServiceCenter[];
}

type CustomerFilter = "all" | "paid" | "unpaid";
type UsageFilter = "all" | "active" | "idle";

const CUSTOMER_FILTERS: { value: CustomerFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "paid", label: "Customers" },
  { value: "unpaid", label: "No payments" },
];

const USAGE_FILTERS: { value: UsageFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Using" },
  { value: "idle", label: "Not using" },
];

export default function ServiceCentersPage() {
  const [centers, setCenters] = useState<ServiceCenter[]>([]);
  const [usage, setUsage] = useState<Map<string, CenterUsage>>(new Map());
  const [usageLoading, setUsageLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState<CustomerFilter>("all");
  const [usageFilter, setUsageFilter] = useState<UsageFilter>("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    boundedGetDocs(query(collection(db, "servicecenters"), orderBy("createdAt", "desc"))).then(async (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ServiceCenter));
      if (cancelled) return;
      // The list renders as soon as the centers are in; the per-center payment
      // and activity signals stream in behind it rather than holding the page.
      setCenters(all);
      setLoading(false);
      const stats = await fetchCenterUsage(all.map((c) => c.id));
      if (cancelled) return;
      setUsage(stats);
      setUsageLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return centers.filter((c) => {
      const matchesSearch =
        !term ||
        c.name.toLowerCase().includes(term) ||
        (c.branchName || "").toLowerCase().includes(term) ||
        (c.ownerName || "").toLowerCase().includes(term) ||
        (c.phone || "").includes(term) ||
        (c.district || "").toLowerCase().includes(term) ||
        (c.paymentCode || "").toLowerCase().includes(term);
      if (!matchesSearch) return false;

      const u = usage.get(c.id);
      // While the signals are still loading nothing is filtered out — a row
      // would otherwise appear to vanish and come back as the counts arrive.
      if (!usageLoading) {
        if (customerFilter === "paid" && !isPayingCustomer(u)) return false;
        if (customerFilter === "unpaid" && isPayingCustomer(u)) return false;
        if (usageFilter === "active" && !isActiveUser(u)) return false;
        if (usageFilter === "idle" && isActiveUser(u)) return false;
      }
      return true;
    });
  }, [centers, search, usage, usageLoading, customerFilter, usageFilter]);

  // Group by ownerUid (falls back to the center's own id for legacy centers
  // that predate the multi-branch fields — each is its own single-branch group).
  const groups = useMemo<OwnerGroup[]>(() => {
    const map = new Map<string, OwnerGroup>();
    for (const c of filtered) {
      const ownerUid = c.ownerUid ?? c.ownerId ?? c.id;
      const existing = map.get(ownerUid);
      if (existing) {
        existing.branches.push(c);
      } else {
        map.set(ownerUid, {
          ownerUid,
          ownerName: c.ownerName ?? c.name,
          ownerPhone: c.ownerPhone ?? c.phone,
          branches: [c],
        });
      }
    }
    // Primary branch first within each group, then by creation order.
    for (const g of map.values()) {
      g.branches.sort((a, b) => Number(!!a.isBranch) - Number(!!b.isBranch));
    }
    return Array.from(map.values());
  }, [filtered]);

  const stats = useMemo(() => {
    let paying = 0;
    let active = 0;
    for (const c of centers) {
      const u = usage.get(c.id);
      if (isPayingCustomer(u)) paying += 1;
      if (isActiveUser(u)) active += 1;
    }
    return { paying, active };
  }, [centers, usage]);

  function toggle(ownerUid: string) {
    setCollapsed((c) => ({ ...c, [ownerUid]: !c[ownerUid] }));
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Service Centers</h1>
          <p className="text-sm text-gray-400 mt-1">{centers.length} centers · {groups.length} owners</p>
        </div>
        <Link
          to="/admin/service-centers/register"
          className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Register Center
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <StatCard
          icon={<Wallet className="w-5 h-5" />}
          tone="text-green-400 bg-green-400/10"
          value={usageLoading ? "—" : stats.paying}
          label="Paying customers"
        />
        <StatCard
          icon={<Activity className="w-5 h-5" />}
          tone="text-orange-400 bg-orange-400/10"
          value={usageLoading ? "—" : stats.active}
          label={`Using (last ${ACTIVE_WINDOW_DAYS}d)`}
        />
        <StatCard
          icon={<Building2 className="w-5 h-5" />}
          tone="text-gray-300 bg-white/5"
          value={usageLoading ? "—" : centers.length - stats.active}
          label="Not using"
        />
        <StatCard
          icon={<XCircle className="w-5 h-5" />}
          tone="text-red-400 bg-red-400/10"
          value={usageLoading ? "—" : centers.length - stats.paying}
          label="Never paid"
        />
      </div>

      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, owner, phone, district or payment code…"
          className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-5">
        <FilterGroup
          label="Billing"
          options={CUSTOMER_FILTERS}
          value={customerFilter}
          onChange={setCustomerFilter}
        />
        <FilterGroup
          label="Usage"
          options={USAGE_FILTERS}
          value={usageFilter}
          onChange={setUsageFilter}
        />
        {(customerFilter !== "all" || usageFilter !== "all") && (
          <button
            onClick={() => { setCustomerFilter("all"); setUsageFilter("all"); }}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-900 rounded-xl border border-gray-800 animate-pulse" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <Building2 className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>No service centers found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            const isMulti = g.branches.length > 1;
            const isCollapsed = collapsed[g.ownerUid] ?? false;
            const totalSms = g.branches.reduce((s, b) => s + (b.smsQuotaUsed ?? 0), 0);
            return (
              <div key={g.ownerUid} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                {isMulti ? (
                  <>
                    <button
                      onClick={() => toggle(g.ownerUid)}
                      className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-800/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        {isCollapsed ? (
                          <ChevronRight className="w-4 h-4 text-gray-500" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-gray-500" />
                        )}
                        <User className="w-4 h-4 text-orange-400" />
                        <span className="text-sm font-semibold text-white">{g.ownerName}</span>
                        <span className="text-xs text-gray-500">{g.ownerPhone}</span>
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-400">
                          {g.branches.length} branches
                        </span>
                      </div>
                      <span className="text-xs text-gray-500">{totalSms.toLocaleString()} SMS total</span>
                    </button>
                    {!isCollapsed && (
                      <div className="border-t border-gray-800 divide-y divide-gray-800/70">
                        {g.branches.map((center) => (
                          <CenterRow
                            key={center.id}
                            center={center}
                            usage={usage.get(center.id)}
                            usageLoading={usageLoading}
                            indent
                          />
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <CenterRow
                    center={g.branches[0]}
                    usage={usage.get(g.branches[0].id)}
                    usageLoading={usageLoading}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, tone, value, label }: {
  icon: React.ReactNode; tone: string; value: number | string; label: string;
}) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
      <div className={`inline-flex p-2 rounded-lg mb-2 ${tone}`}>{icon}</div>
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="text-xs text-gray-400 mt-0.5">{label}</div>
    </div>
  );
}

function FilterGroup<T extends string>({ label, options, value, onChange }: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-gray-500">{label}</span>
      <div className="flex items-center gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`text-xs font-medium px-2.5 py-1 rounded-md transition-colors ${
              value === o.value
                ? "bg-orange-500 text-white"
                : "text-gray-400 hover:text-white hover:bg-gray-800"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function CenterRow({ center, usage, usageLoading, indent }: {
  center: ServiceCenter;
  usage?: CenterUsage;
  usageLoading: boolean;
  indent?: boolean;
}) {
  const paying = isPayingCustomer(usage);
  const active = isActiveUser(usage);
  return (
    <Link
      to={`/admin/service-centers/${center.id}`}
      className={`flex items-center justify-between px-5 py-4 hover:bg-gray-800/40 transition-colors group ${indent ? "pl-10" : ""}`}
    >
      <div className="flex items-center gap-4 min-w-0">
        {center.status === "blocked" ? (
          <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
        ) : (
          <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-white flex items-center gap-2">
            {center.branchName ?? center.name}
            {!center.isBranch && center.ownerUid && (
              <span className="text-xs font-bold bg-white/10 text-gray-300 px-1.5 py-0.5 rounded">MAIN</span>
            )}
          </p>
          <p className="text-xs text-gray-400 mt-0.5 truncate">
            {center.district} · {center.phone}
            {center.paymentCode && <span className="ml-2 font-mono text-orange-400/70">{center.paymentCode}</span>}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {usageLoading ? (
          <span className="w-32 h-5 rounded-full bg-gray-800 animate-pulse" />
        ) : (
          <>
            <span
              title={
                paying
                  ? `${usage?.paymentCount} payment(s) · last ${sinceLabel(usage?.lastPaymentAt ?? null)}`
                  : "No payment recorded yet"
              }
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                paying ? "bg-green-500/15 text-green-400" : "bg-gray-800 text-gray-500"
              }`}
            >
              {paying ? "Customer" : "No payments"}
            </span>
            <span
              title={
                usage?.recentJobs == null
                  ? "Usage could not be read"
                  : `${usage.recentJobs} service(s) in ${ACTIVE_WINDOW_DAYS} days · last ${sinceLabel(usage.lastJobAt)}`
              }
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                active ? "bg-orange-500/15 text-orange-400" : "bg-gray-800 text-gray-500"
              }`}
            >
              {active ? `Using · ${usage?.recentJobs}` : `Idle · ${sinceLabel(usage?.lastJobAt ?? null)}`}
            </span>
          </>
        )}
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            center.plan === "pro"
              ? "bg-orange-500/15 text-orange-400"
              : "bg-gray-800 text-gray-400"
          }`}
        >
          {center.plan.toUpperCase()}
        </span>
        {center.status === "blocked" && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">
            Blocked
          </span>
        )}
        {center.isActive === false && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">
            Deleted
          </span>
        )}
        <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors" />
      </div>
    </Link>
  );
}
