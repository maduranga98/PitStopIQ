import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../../config/firebase";
import { Plus, Search, ChevronRight, CheckCircle, XCircle, Building2 } from "lucide-react";
import type { ServiceCenter } from "../../types/auth";

export default function ServiceCentersPage() {
  const [centers, setCenters] = useState<ServiceCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    getDocs(query(collection(db, "servicecenters"), orderBy("createdAt", "desc"))).then((snap) => {
      setCenters(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ServiceCenter)));
      setLoading(false);
    });
  }, []);

  const filtered = centers.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.phone || "").includes(search) ||
      (c.district || "").toLowerCase().includes(search.toLowerCase()) ||
      (c.paymentCode || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Service Centers</h1>
          <p className="text-sm text-gray-400 mt-1">{centers.length} centers registered</p>
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
          placeholder="Search by name, phone, district or payment code…"
          className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-orange-500"
        />
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-900 rounded-xl border border-gray-800 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <Building2 className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>No service centers found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((center) => (
            <Link
              key={center.id}
              to={`/admin/service-centers/${center.id}`}
              className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl px-5 py-4 hover:border-gray-700 transition-colors group"
            >
              <div className="flex items-center gap-4">
                {center.status === "blocked" ? (
                  <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                ) : (
                  <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
                )}
                <div>
                  <p className="text-sm font-medium text-white">{center.name}</p>
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
          ))}
        </div>
      )}
    </div>
  );
}
