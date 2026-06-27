import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LayoutDashboard, Building2, LogOut, Shield, CreditCard, Bell } from "lucide-react";
import { useSuperAdmin } from "../../contexts/SuperAdminContext";
import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../config/firebase";

function usePendingCount() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    Promise.all([
      getDocs(query(collection(db, "upgradeRequests"), where("status", "==", "pending"))),
      getDocs(query(collection(db, "paymentSlipRequests"), where("status", "==", "pending"))),
    ]).then(([u, s]) => setCount(u.size + s.size)).catch(() => {});
  }, []);
  return count;
}

const navItems = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/service-centers", label: "Service Centers", icon: Building2 },
  { to: "/admin/requests", label: "Requests", icon: Bell },
  { to: "/admin/payments", label: "Revenue", icon: CreditCard },
];

export default function AdminLayout() {
  const { superAdmin, logout } = useSuperAdmin();
  const navigate = useNavigate();
  const pendingCount = usePendingCount();

  async function handleLogout() {
    await logout();
    navigate("/admin/login");
  }

  return (
    <div className="min-h-screen flex bg-gray-950 text-gray-100">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="p-5 border-b border-gray-800 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center">
            <Shield className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">PitStop IQ</p>
            <p className="text-xs text-orange-400">Super Admin</p>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? "bg-orange-500/15 text-orange-400 font-medium"
                    : "text-gray-400 hover:text-white hover:bg-gray-800"
                }`
              }
            >
              <Icon className="w-4 h-4" />
              <span className="flex-1">{label}</span>
              {label === "Requests" && pendingCount > 0 && (
                <span className="bg-amber-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                  {pendingCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-gray-800">
          <div className="px-3 py-2 text-xs text-gray-500 truncate mb-1">
            {superAdmin?.displayName || superAdmin?.email}
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2 w-full rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
