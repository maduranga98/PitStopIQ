import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, Car, Wrench, FileText, MessageSquare,
  Package, BarChart2, UserCog, Settings, LogOut, ChevronRight,
} from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";

const NAV_ITEMS = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard", exact: true },
  { to: "/customers", icon: Users, label: "Customers" },
  { to: "/vehicles", icon: Car, label: "Vehicles" },
  { to: "/services", icon: Wrench, label: "Services" },
  { to: "/invoices", icon: FileText, label: "Invoices" },
  { to: "/inventory", icon: Package, label: "Inventory" },
  { to: "/sms-logs", icon: MessageSquare, label: "SMS Logs" },
  { to: "/analytics", icon: BarChart2, label: "Analytics & Reports" },
  { to: "/employees", icon: UserCog, label: "Member Management" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export default function Sidebar() {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const visibleItems = NAV_ITEMS;

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <aside className="fixed top-0 left-0 h-screen w-56 bg-[#162032] border-r border-white/10 flex flex-col z-40">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-5 border-b border-white/10 flex-shrink-0">
        <img
          src="/logo.png"
          alt="PitStop IQ"
          className="h-8 w-auto"
          onError={(e) => (e.currentTarget.style.display = "none")}
        />
        <span className="text-base font-extrabold tracking-tight text-white">
          PITSTOP <span className="text-[#F97316]">IQ</span>
        </span>
      </div>

      {/* Nav links */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {visibleItems.map(({ to, icon: Icon, label, exact }) => (
          <NavLink
            key={to}
            to={to}
            end={exact}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group ${
                isActive
                  ? "bg-[#F97316]/15 text-[#F97316] border border-[#F97316]/20"
                  : "text-gray-400 hover:text-white hover:bg-white/5 border border-transparent"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={`h-4 w-4 flex-shrink-0 transition-colors ${
                    isActive ? "text-[#F97316]" : "text-gray-500 group-hover:text-gray-300"
                  }`}
                />
                <span className="flex-1">{label}</span>
                {isActive && <ChevronRight className="h-3.5 w-3.5 text-[#F97316]/60" />}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User info + logout */}
      <div className="border-t border-white/10 px-4 py-4 space-y-3 flex-shrink-0">
        <div>
          <p className="text-xs text-white font-medium truncate">{currentUser?.email}</p>
          <p className="text-xs text-[#F97316] mt-0.5">{currentUser?.role}</p>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
