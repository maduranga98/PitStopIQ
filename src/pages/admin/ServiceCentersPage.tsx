import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../../config/firebase";
import { Plus, Search, ChevronRight, ChevronDown, CheckCircle, XCircle, Building2, User } from "lucide-react";
import type { ServiceCenter } from "../../types/auth";

interface OwnerGroup {
  ownerUid: string;
  ownerName: string;
  ownerPhone: string;
  branches: ServiceCenter[];
}

export default function ServiceCentersPage() {
  const [centers, setCenters] = useState<ServiceCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    getDocs(query(collection(db, "servicecenters"), orderBy("createdAt", "desc"))).then((snap) => {
      setCenters(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ServiceCenter)));
      setLoading(false);
    });
  }, []);

  const filtered = centers.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.branchName || "").toLowerCase().includes(search.toLowerCase()) ||
      (c.ownerName || "").toLowerCase().includes(search.toLowerCase()) ||
      (c.phone || "").includes(search) ||
      (c.district || "").toLowerCase().includes(search.toLowerCase()) ||
      (c.paymentCode || "").toLowerCase().includes(search.toLowerCase())
  );

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

      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, owner, phone, district or payment code…"
          className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
        />
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
                          <CenterRow key={center.id} center={center} indent />
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <CenterRow center={g.branches[0]} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CenterRow({ center, indent }: { center: ServiceCenter; indent?: boolean }) {
  return (
    <Link
      to={`/admin/service-centers/${center.id}`}
      className={`flex items-center justify-between px-5 py-4 hover:bg-gray-800/40 transition-colors group ${indent ? "pl-10" : ""}`}
    >
      <div className="flex items-center gap-4">
        {center.status === "blocked" ? (
          <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
        ) : (
          <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
        )}
        <div>
          <p className="text-sm font-medium text-white flex items-center gap-2">
            {center.branchName ?? center.name}
            {!center.isBranch && center.ownerUid && (
              <span className="text-xs font-bold bg-white/10 text-gray-300 px-1.5 py-0.5 rounded">MAIN</span>
            )}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {center.district} · {center.phone}
            {center.paymentCode && <span className="ml-2 font-mono text-orange-400/70">{center.paymentCode}</span>}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4">
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
        <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors" />
      </div>
    </Link>
  );
}
