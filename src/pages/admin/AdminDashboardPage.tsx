import { useEffect, useState } from "react";
import { collection, getDocs, collectionGroup } from "firebase/firestore";
import { db } from "../../config/firebase";
import { Building2, CheckCircle, XCircle, CreditCard, TrendingUp, DollarSign, Clock } from "lucide-react";
import type { ServiceCenter, ServiceCenterPayment, UpgradeRequest } from "../../types/auth";

export default function AdminDashboardPage() {
  const [centers, setCenters] = useState<ServiceCenter[]>([]);
  const [payments, setPayments] = useState<ServiceCenterPayment[]>([]);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getDocs(collection(db, "servicecenters")),
      getDocs(collectionGroup(db, "payments")),
      getDocs(collection(db, "upgradeRequests")),
    ]).then(([centersSnap, paymentsSnap, upgradeSnap]) => {
      setCenters(centersSnap.docs.map((d) => ({ id: d.id, ...d.data() } as ServiceCenter)));
      setPayments(paymentsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as ServiceCenterPayment)));
      setPendingRequests(upgradeSnap.docs.filter((d) => d.data().status === "pending").length);
      setLoading(false);
    });
  }, []);

  const active = centers.filter((c) => c.status !== "blocked").length;
  const blocked = centers.filter((c) => c.status === "blocked").length;
  const proCount = centers.filter((c) => c.plan === "pro").length;
  const basicCount = centers.filter((c) => c.plan === "basic").length;

  const totalRevenue = payments.filter((p) => p.status === "paid").reduce((sum, p) => sum + (p.amount ?? 0), 0);

  // Current month revenue
  const now = new Date();
  const thisMonth = payments.filter((p) => {
    if (p.status !== "paid" || !p.paidAt) return false;
    const d = new Date((p.paidAt as any).seconds * 1000);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).reduce((sum, p) => sum + (p.amount ?? 0), 0);

  const stats = [
    { label: "Total Centers", value: centers.length, icon: Building2, color: "text-blue-400 bg-blue-400/10" },
    { label: "Active", value: active, icon: CheckCircle, color: "text-green-400 bg-green-400/10" },
    { label: "Blocked", value: blocked, icon: XCircle, color: "text-red-400 bg-red-400/10" },
    { label: "Pro Plan", value: proCount, icon: CreditCard, color: "text-orange-400 bg-orange-400/10" },
  ];

  const revenueStats = [
    { label: "Total Revenue", value: `LKR ${totalRevenue.toLocaleString()}`, icon: DollarSign, color: "text-emerald-400 bg-emerald-400/10" },
    { label: "This Month", value: `LKR ${thisMonth.toLocaleString()}`, icon: TrendingUp, color: "text-sky-400 bg-sky-400/10" },
    { label: "Pending Upgrades", value: pendingRequests, icon: Clock, color: "text-amber-400 bg-amber-400/10" },
  ];

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-white mb-1">Dashboard</h1>
      <p className="text-gray-400 text-sm mb-8">Overview of all service centers</p>

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-28 bg-gray-900 rounded-xl border border-gray-800 animate-pulse" />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-28 bg-gray-900 rounded-xl border border-gray-800 animate-pulse" />
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
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

          {/* Revenue KPIs */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            {revenueStats.map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="bg-gray-900 rounded-xl border border-gray-800 p-5">
                <div className={`inline-flex p-2 rounded-lg ${color} mb-3`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="text-2xl font-bold text-white">{value}</div>
                <div className="text-sm text-gray-400 mt-1">{label}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="mt-2 bg-gray-900 rounded-xl border border-gray-800 p-5">
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
