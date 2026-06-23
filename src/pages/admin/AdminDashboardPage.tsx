import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../config/firebase";
import { Building2, CheckCircle, XCircle, CreditCard } from "lucide-react";
import type { ServiceCenter } from "../../types/auth";

export default function AdminDashboardPage() {
  const [centers, setCenters] = useState<ServiceCenter[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDocs(collection(db, "servicecenters")).then((snap) => {
      setCenters(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ServiceCenter)));
      setLoading(false);
    });
  }, []);

  const active = centers.filter((c) => c.status !== "blocked").length;
  const blocked = centers.filter((c) => c.status === "blocked").length;
  const basicCount = centers.filter((c) => c.plan === "basic").length;
  const proCount = centers.filter((c) => c.plan === "pro").length;

  const stats = [
    { label: "Total Centers", value: centers.length, icon: Building2, color: "text-blue-400 bg-blue-400/10" },
    { label: "Active", value: active, icon: CheckCircle, color: "text-green-400 bg-green-400/10" },
    { label: "Blocked", value: blocked, icon: XCircle, color: "text-red-400 bg-red-400/10" },
    { label: "Pro Plan", value: proCount, icon: CreditCard, color: "text-orange-400 bg-orange-400/10" },
  ];

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-white mb-1">Dashboard</h1>
      <p className="text-gray-400 text-sm mb-8">Overview of all service centers</p>

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 bg-gray-900 rounded-xl border border-gray-800 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-gray-900 rounded-xl border border-gray-800 p-5">
              <div className={`inline-flex p-2 rounded-lg ${color} mb-3`}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="text-3xl font-bold text-white">{value}</div>
              <div className="text-sm text-gray-400 mt-1">{label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 bg-gray-900 rounded-xl border border-gray-800 p-5">
        <h2 className="text-sm font-semibold text-gray-300 mb-4">Plan breakdown</h2>
        <div className="flex gap-6">
          <div>
            <span className="text-2xl font-bold text-white">{basicCount}</span>
            <span className="text-sm text-gray-400 ml-2">Basic</span>
          </div>
          <div>
            <span className="text-2xl font-bold text-orange-400">{proCount}</span>
            <span className="text-sm text-gray-400 ml-2">Pro</span>
          </div>
        </div>
      </div>
    </div>
  );
}
