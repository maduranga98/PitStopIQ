import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection, query, onSnapshot, doc,
} from "firebase/firestore";
import {
  Search, Plus, Download, Users, ChevronLeft, ChevronRight,
  Edit2, Eye, Car,
} from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import { phoneMatches } from "../../lib/utils";
import type { Customer } from "../../types/auth";
import type { Timestamp } from "firebase/firestore";
import { LoadingBlock } from "../../components/LoadingProgress";

const AVATAR_COLORS = [
  "bg-orange-500", "bg-blue-500", "bg-green-500", "bg-purple-500",
  "bg-pink-500", "bg-teal-500", "bg-yellow-500", "bg-red-500",
];

function avatarColor(name: string) {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatPhone(phone: string) {
  // +94XXXXXXXXX → 0XX XXX XXXX
  if (phone.startsWith("+94") && phone.length === 12) {
    const local = "0" + phone.slice(3);
    return local.slice(0, 3) + " " + local.slice(3, 6) + " " + local.slice(6);
  }
  return phone;
}

function timeAgoOrDate(ts: Timestamp | null): string {
  if (!ts) return "No service";
  const seconds = Math.floor((Date.now() - ts.toMillis()) / 1000);
  if (seconds < 86400) return "Today";
  const days = Math.floor(seconds / 86400);
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}


const PAGE_SIZE = 20;

type FilterTab = "all" | "active" | "inactive";
type SortKey = "name_asc" | "name_desc" | "last_service" | "vehicle_count";

// How long since a customer's last service before they count as inactive.
// A workshop asks this in months, not days, so the choices are months.
const INACTIVE_WINDOWS = [
  { months: 3,  label: "3 months" },
  { months: 6,  label: "6 months" },
  { months: 12, label: "1 year" },
  { months: 24, label: "2 years" },
] as const;

const DEFAULT_INACTIVE_MONTHS = 6;

/**
 * The same date, `months` earlier — calendar months, so "6 months" means the
 * same day-of-month half a year back rather than a fixed 180 days.
 */
function monthsAgo(months: number): number {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.getTime();
}

/** The window closest to the center's saved setting, which is stored in days. */
function nearestWindowMonths(days: number): number {
  const target = days / 30.4;
  return INACTIVE_WINDOWS.reduce((best, w) =>
    Math.abs(w.months - target) < Math.abs(best - target) ? w.months : best,
    DEFAULT_INACTIVE_MONTHS,
  );
}

export default function CustomerListPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const canCreate = usePermission("customers.create");
  const canEdit = usePermission("customers.edit");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vehicleCounts, setVehicleCounts] = useState<Record<string, number>>({});
  // Newest service date per customer, taken from their vehicles. The customer
  // document's own lastServiceDate is only ever initialised to null — the real
  // record of a service lives on the vehicle — so deriving it here is what
  // makes the active/inactive tabs mean anything.
  const [lastServiceByCustomer, setLastServiceByCustomer] = useState<Record<string, Timestamp>>({});
  const [inactiveMonths, setInactiveMonths] = useState<number>(DEFAULT_INACTIVE_MONTHS);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<FilterTab>("all");
  const [sort, setSort] = useState<SortKey>("name_asc");
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!currentUser?.centerId) return;
    const q = query(
      collection(db, "servicecenters", currentUser.centerId, "customers"),
    );
    const unsub = onSnapshot(q, (snap) => {
      setCustomers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));
      setLoading(false);
    });
    const vehQ = query(
      collection(db, "servicecenters", currentUser.centerId, "vehicles"),
    );
    const unsubV = onSnapshot(vehQ, (snap) => {
      const counts: Record<string, number> = {};
      const latest: Record<string, Timestamp> = {};
      snap.docs.forEach((d) => {
        const v = d.data() as { customerId?: string; isDeleted?: boolean; lastServiceDate?: Timestamp | null };
        if (v.isDeleted || !v.customerId) return;
        counts[v.customerId] = (counts[v.customerId] ?? 0) + 1;
        const ls = v.lastServiceDate;
        if (ls?.toMillis) {
          const seen = latest[v.customerId];
          if (!seen || seen.toMillis() < ls.toMillis()) latest[v.customerId] = ls;
        }
      });
      setVehicleCounts(counts);
      setLastServiceByCustomer(latest);
    });
    // The center's saved inactivity window (Settings > Reminders, stored in
    // days) seeds the selector below; it stays switchable per view so "who
    // hasn't been in for a year" is one click away.
    const unsubCenter = onSnapshot(doc(db, "servicecenters", currentUser.centerId), (snap) => {
      const d = snap.data() as { customerInactiveDays?: number } | undefined;
      if (d?.customerInactiveDays && d.customerInactiveDays > 0) {
        setInactiveMonths(nearestWindowMonths(d.customerInactiveDays));
      }
    });
    return () => { unsub(); unsubV(); unsubCenter(); };
  }, [currentUser?.centerId]);

  const cutoff = useMemo(() => monthsAgo(inactiveMonths), [inactiveMonths]);

  const filtered = useMemo(() => {
    let list = customers
      .filter(c => !c.isDeleted)
      .map(c => ({
        ...c,
        vehicleCount: vehicleCounts[c.id] ?? c.vehicleCount ?? 0,
        lastServiceDate: lastServiceByCustomer[c.id] ?? c.lastServiceDate ?? null,
      }));

    // search
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          phoneMatches(c.phone, q),
      );
    }

    // tab — "inactive" is anyone whose last service predates the selected
    // window, plus anyone who has never had one.
    if (tab === "active") {
      list = list.filter((c) => !!c.lastServiceDate && c.lastServiceDate.toMillis() >= cutoff);
    } else if (tab === "inactive") {
      list = list.filter((c) => !c.lastServiceDate || c.lastServiceDate.toMillis() < cutoff);
    }

    // sort
    list = [...list].sort((a, b) => {
      if (sort === "name_asc") return a.name.localeCompare(b.name);
      if (sort === "name_desc") return b.name.localeCompare(a.name);
      if (sort === "last_service") {
        const at = a.lastServiceDate?.toMillis() ?? 0;
        const bt = b.lastServiceDate?.toMillis() ?? 0;
        return bt - at;
      }
      if (sort === "vehicle_count") return (b.vehicleCount ?? 0) - (a.vehicleCount ?? 0);
      return 0;
    });

    return list;
  }, [customers, vehicleCounts, lastServiceByCustomer, search, tab, sort, cutoff]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function handleExportCSV() {
    const rows = [
      ["Name", "Phone", "Vehicles", "Last Service", "Notes"],
      ...filtered.map((c) => [
        c.name,
        formatPhone(c.phone),
        String(c.vehicleCount ?? 0),
        c.lastServiceDate ? new Date(c.lastServiceDate.toMillis()).toLocaleDateString() : "",
        c.notes ?? "",
      ]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "customers.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <PageHeader
        icon={<Users className="w-5 h-5" />}
        title={t("customers.title")}
        actions={
          <>
            <button
              onClick={handleExportCSV}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-300 hover:text-white border border-white/10 rounded-lg hover:border-white/20 transition-colors"
            >
              <Download className="w-4 h-4" />
              {t("common.export")} CSV
            </button>
            {canCreate && (
              <button
                onClick={() => navigate("/customers/add")}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-[#F97316] hover:bg-orange-600 text-white rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                {t("customers.addCustomer")}
              </button>
            )}
          </>
        }
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {/* Search + Sort */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name or phone…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="w-full bg-[#162032] border border-white/10 rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#F97316]/50"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => setSortAndReset(e.target.value as SortKey)}
            className="bg-[#162032] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-gray-300 focus:outline-none focus:border-[#F97316]/50"
          >
            <option value="name_asc">Name A–Z</option>
            <option value="name_desc">Name Z–A</option>
            <option value="last_service">Last Service</option>
            <option value="vehicle_count">Most Vehicles</option>
          </select>
        </div>

        {/* Filter tabs + the window they're measured against */}
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10">
          <div className="flex gap-1">
            {(["all", "active", "inactive"] as FilterTab[]).map((tabId) => (
              <button
                key={tabId}
                onClick={() => { setTab(tabId); setPage(1); }}
                className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                  tab === tabId
                    ? "border-[#F97316] text-white"
                    : "border-transparent text-gray-400 hover:text-gray-200"
                }`}
              >
                {tabId}
                {tabId !== "all" && (
                  <span className="ml-1.5 text-xs text-gray-500">
                    ({countInWindow(tabId)})
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 pb-1.5">
            <span className="text-xs text-gray-500">No service in</span>
            <select
              value={inactiveMonths}
              onChange={(e) => { setInactiveMonths(Number(e.target.value)); setPage(1); }}
              className="bg-[#162032] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-[#F97316]/50"
            >
              {INACTIVE_WINDOWS.map((w) => (
                <option key={w.months} value={w.months}>{w.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <LoadingBlock className="py-24" />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-500">
            <Users className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-lg font-medium text-gray-400">
              {search ? t("customers.noCustomers") : t("customers.noCustomers")}
            </p>
            {!search && canCreate && (
              <button
                onClick={() => navigate("/customers/add")}
                className="mt-4 px-4 py-2 text-sm bg-[#F97316] hover:bg-orange-600 text-white rounded-lg transition-colors"
              >
                {t("customers.addCustomer")}
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="bg-[#162032] border border-white/10 rounded-2xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10 text-left text-xs text-gray-400 uppercase tracking-wider">
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3 hidden sm:table-cell">Phone</th>
                    <th className="px-4 py-3 hidden md:table-cell">Vehicles</th>
                    <th className="px-4 py-3 hidden lg:table-cell">Last Service</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {paginated.map((c) => (
                    <tr key={c.id} className="hover:bg-white/5 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0 ${avatarColor(c.name)}`}>
                            {initials(c.name)}
                          </div>
                          <div>
                            <p className="font-medium text-white text-sm">{c.name}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-sm text-gray-300">
                        {formatPhone(c.phone)}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-500/20 text-blue-300 text-xs rounded-full">
                          <Car className="w-3 h-3" />
                          {c.vehicleCount ?? 0}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-sm text-gray-400">
                        {timeAgoOrDate(c.lastServiceDate)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => navigate(`/customers/${c.id}`)}
                            className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                            title="View"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {canEdit && (
                            <button
                              onClick={() => navigate(`/customers/${c.id}?edit=1`)}
                              className="p-1.5 text-gray-400 hover:text-[#F97316] hover:bg-orange-500/10 rounded-lg transition-colors"
                              title="Edit"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <p className="text-sm text-gray-400">
                  Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-1.5 text-gray-400 hover:text-white disabled:opacity-30 hover:bg-white/10 rounded-lg transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-sm text-gray-300">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="p-1.5 text-gray-400 hover:text-white disabled:opacity-30 hover:bg-white/10 rounded-lg transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  function setSortAndReset(s: SortKey) {
    setSort(s);
    setPage(1);
  }

  /** How many customers each tab holds, so the counts don't require switching. */
  function countInWindow(which: "active" | "inactive"): number {
    let count = 0;
    for (const c of customers) {
      if (c.isDeleted) continue;
      const last = lastServiceByCustomer[c.id] ?? c.lastServiceDate ?? null;
      const isActive = !!last && last.toMillis() >= cutoff;
      if ((which === "active") === isActive) count += 1;
    }
    return count;
  }
}
