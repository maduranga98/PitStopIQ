import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { collection, query, onSnapshot } from "firebase/firestore";
import {
  Search, Plus, Car, ChevronLeft, ChevronRight, Eye, Edit2,
} from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { useBranch } from "../../contexts/BranchContext";
import { usePermission } from "../../contexts/PermissionsContext";
import type { Vehicle } from "../../types/auth";
import { useTranslation } from "react-i18next";

type StatusFilter = "all" | "ok" | "due_soon" | "overdue";
type SortKey = "plate" | "status" | "last_service";

function getStatus(v: Vehicle, threshold: number): "ok" | "due_soon" | "overdue" {
  const remaining = v.nextServiceMileageKm - v.currentMileageKm;
  if (remaining < 0) return "overdue";
  if (remaining <= threshold) return "due_soon";
  return "ok";
}

const STATUS_CHIP = {
  ok:       { label: "OK",        bg: "bg-green-500/20",  text: "text-green-300" },
  due_soon: { label: "Due Soon",  bg: "bg-amber-500/20",  text: "text-amber-300" },
  overdue:  { label: "Overdue",   bg: "bg-red-500/20",    text: "text-red-400"   },
};

const STATUS_ORDER = { overdue: 0, due_soon: 1, ok: 2 };

const PAGE_SIZE = 20;

export default function VehicleListPage() {
  const { currentUser } = useAuth();
  const { activeBranchId, hasBranches, isAllBranches } = useBranch();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const canCreate = usePermission("vehicles.create");

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [makeFilter, setMakeFilter] = useState("all");
  const [sort, setSort] = useState<SortKey>("plate");
  const [page, setPage] = useState(1);

  // Use center threshold or default 1000 km
  const threshold = 1000;

  useEffect(() => {
    if (!currentUser?.centerId) return;
    const q = query(
      collection(db, "servicecenters", currentUser.centerId, "vehicles"),
    );
    return onSnapshot(q, (snap) => {
      setVehicles(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Vehicle)));
      setLoading(false);
    });
  }, [currentUser?.centerId]);

  const allMakes = useMemo(() => {
    const makes = new Set(vehicles.map((v) => v.make).filter(Boolean));
    return Array.from(makes).sort();
  }, [vehicles]);

  const filtered = useMemo(() => {
    let list = vehicles.filter(v => !v.isDeleted);

    if (hasBranches && !isAllBranches && activeBranchId) {
      list = list.filter(v => v.branchId === activeBranchId);
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (v) =>
          v.plateNumber.toLowerCase().includes(q) ||
          v.make?.toLowerCase().includes(q) ||
          v.model?.toLowerCase().includes(q),
      );
    }

    if (makeFilter !== "all") {
      list = list.filter((v) => v.make === makeFilter);
    }

    if (statusFilter !== "all") {
      list = list.filter((v) => getStatus(v, threshold) === statusFilter);
    }

    list = [...list].sort((a, b) => {
      if (sort === "plate") return a.plateNumber.localeCompare(b.plateNumber);
      if (sort === "status") {
        return STATUS_ORDER[getStatus(a, threshold)] - STATUS_ORDER[getStatus(b, threshold)];
      }
      if (sort === "last_service") {
        const at = a.lastServiceDate?.toMillis() ?? 0;
        const bt = b.lastServiceDate?.toMillis() ?? 0;
        return bt - at;
      }
      return 0;
    });

    return list;
  }, [vehicles, search, makeFilter, statusFilter, sort, threshold, activeBranchId, hasBranches, isAllBranches]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function resetPage() { setPage(1); }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <PageHeader
        icon={<Car className="w-5 h-5" />}
        title={t("vehicles.title")}
        actions={
          canCreate ? (
            <button
              onClick={() => navigate("/vehicles/add")}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-[#F97316] hover:bg-orange-600 text-white rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Vehicle
            </button>
          ) : null
        }
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {/* Search + filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by plate, make, or model…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); resetPage(); }}
              className="w-full bg-[#162032] border border-white/10 rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#F97316]/50"
            />
          </div>
          <select
            value={makeFilter}
            onChange={(e) => { setMakeFilter(e.target.value); resetPage(); }}
            className="bg-[#162032] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-gray-300 focus:outline-none focus:border-[#F97316]/50"
          >
            <option value="all">All Makes</option>
            {allMakes.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => { setSort(e.target.value as SortKey); resetPage(); }}
            className="bg-[#162032] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-gray-300 focus:outline-none focus:border-[#F97316]/50"
          >
            <option value="plate">Sort: Plate A–Z</option>
            <option value="status">Sort: Status (Overdue first)</option>
            <option value="last_service">Sort: Last Service</option>
          </select>
        </div>

        {/* Status filter tabs */}
        <div className="flex gap-1 border-b border-white/10">
          {(["all", "ok", "due_soon", "overdue"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); resetPage(); }}
              className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                statusFilter === s
                  ? "border-[#F97316] text-white"
                  : "border-transparent text-gray-400 hover:text-gray-200"
              }`}
            >
              {s === "all" ? "All" : s === "ok" ? "OK" : s === "due_soon" ? "Due Soon" : "Overdue"}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-8 h-8 border-2 border-[#F97316] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-500">
            <Car className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-lg font-medium text-gray-400">
              {search || statusFilter !== "all" || makeFilter !== "all"
                ? "No vehicles match your filters"
                : "No vehicles yet"}
            </p>
            {!search && statusFilter === "all" && makeFilter === "all" && canCreate && (
              <button
                onClick={() => navigate("/vehicles/add")}
                className="mt-4 px-4 py-2 text-sm bg-[#F97316] hover:bg-orange-600 text-white rounded-lg transition-colors"
              >
                Add your first vehicle
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="bg-[#162032] border border-white/10 rounded-2xl overflow-x-auto">
              <table className="w-full min-w-[340px]">
                <thead>
                  <tr className="border-b border-white/10 text-left text-xs text-gray-400 uppercase tracking-wider">
                    <th className="px-4 py-3">Plate</th>
                    <th className="px-4 py-3 hidden sm:table-cell">Make / Model</th>
                    <th className="px-4 py-3 hidden md:table-cell">Customer</th>
                    <th className="px-4 py-3 hidden lg:table-cell">Current km</th>
                    <th className="px-4 py-3 hidden lg:table-cell">Next Service</th>
                    <th className="px-4 py-3 hidden xl:table-cell">Remaining</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {paginated.map((v) => {
                    const st = getStatus(v, threshold);
                    const chip = STATUS_CHIP[st];
                    const remaining = v.nextServiceMileageKm - v.currentMileageKm;
                    return (
                      <tr key={v.id} className="hover:bg-white/5 transition-colors">
                        <td className="px-4 py-3">
                          <span className="font-mono font-semibold text-white text-sm">
                            {v.plateNumber}
                          </span>
                          <div className="text-xs text-gray-500 sm:hidden">
                            {v.make} {v.model}
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <p className="text-sm text-white">{v.make} {v.model}</p>
                          {v.year && <p className="text-xs text-gray-500">{v.year}</p>}
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell text-sm text-gray-300">
                          {v.customerName}
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell text-sm text-gray-300">
                          {v.currentMileageKm.toLocaleString()} km
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell text-sm text-gray-300">
                          {v.nextServiceMileageKm.toLocaleString()} km
                        </td>
                        <td className="px-4 py-3 hidden xl:table-cell text-sm">
                          <span className={remaining < 0 ? "text-red-400" : "text-gray-300"}>
                            {remaining < 0 ? `${Math.abs(remaining).toLocaleString()} km overdue` : `${remaining.toLocaleString()} km`}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${chip.bg} ${chip.text}`}>
                            {chip.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => navigate(`/vehicles/${v.id}`)}
                              className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                              title="View"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => navigate(`/vehicles/${v.id}/edit`)}
                              className="p-1.5 text-gray-400 hover:text-[#F97316] hover:bg-orange-500/10 rounded-lg transition-colors"
                              title="Edit"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

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
                  <span className="text-sm text-gray-300">Page {page} of {totalPages}</span>
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
}
