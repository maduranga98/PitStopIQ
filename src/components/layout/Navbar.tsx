import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, Car, Wrench, FileText, MessageSquare,
  Package, BarChart2, UserCog, Settings, LogOut, Menu, X,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import type { UserRole } from "../../types/auth";

const NAV_ITEMS = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard", exact: true },
  { to: "/customers", icon: Users, label: "Customers" },
  { to: "/vehicles", icon: Car, label: "Vehicles" },
  { to: "/services", icon: Wrench, label: "Services" },
  { to: "/invoices", icon: FileText, label: "Invoices" },
  { to: "/sms-logs", icon: MessageSquare, label: "SMS Logs" },
  { to: "/inventory", icon: Package, label: "Inventory" },
  { to: "/analytics", icon: BarChart2, label: "Analytics" },
  { to: "/employees", icon: UserCog, label: "Employees" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

// Role-based visibility
function canSee(to: string, role?: UserRole): boolean {
  if (to === "/analytics") return role === "Owner" || role === "Manager" || role === "Cashier";
  if (to === "/employees") return role === "Owner" || role === "Manager";
  if (to === "/settings") return role === "Owner" || role === "Manager";
  return true;
}

export default function Navbar() {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const visibleItems = NAV_ITEMS.filter(item => canSee(item.to, currentUser?.role));

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <>
      {/* Top bar */}
      <nav className="bg-[#162032] border-b border-white/10 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex items-center gap-3 flex-shrink-0">
              <img src="/logo.png" alt="PitStop IQ" className="h-8 w-auto" onError={(e) => (e.currentTarget.style.display='none')} />
              <span className="text-lg font-extrabold tracking-tight text-white">
                PITSTOP <span className="text-[#F97316]">IQ</span>
              </span>
            </div>

            {/* Desktop nav links */}
            <div className="hidden lg:flex items-center gap-1 overflow-x-auto">
              {visibleItems.map(({ to, icon: Icon, label, exact }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={exact}
                  className={({ isActive }) =>
                    `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition whitespace-nowrap ${
                      isActive
                        ? "bg-[#F97316]/20 text-[#F97316]"
                        : "text-gray-400 hover:text-white hover:bg-white/5"
                    }`
                  }
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  {label}
                </NavLink>
              ))}
            </div>

            {/* Right side: user info + logout + mobile menu */}
            <div className="flex items-center gap-2">
              <div className="hidden sm:block text-right">
                <p className="text-xs text-gray-400 leading-none">{currentUser?.email}</p>
                <p className="text-xs text-[#F97316] font-medium mt-0.5">{currentUser?.role}</p>
              </div>
              <button
                onClick={handleLogout}
                className="hidden sm:flex items-center gap-1.5 text-sm text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg transition"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden md:inline">Sign out</span>
              </button>
              {/* Mobile hamburger */}
              <button
                onClick={() => setMobileOpen(o => !o)}
                className="lg:hidden p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition"
              >
                {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="lg:hidden border-t border-white/10 bg-[#162032] px-4 py-3 space-y-1">
            {visibleItems.map(({ to, icon: Icon, label, exact }) => (
              <NavLink
                key={to}
                to={to}
                end={exact}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
                    isActive
                      ? "bg-[#F97316]/20 text-[#F97316]"
                      : "text-gray-400 hover:text-white hover:bg-white/5"
                  }`
                }
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                {label}
              </NavLink>
            ))}
            <div className="border-t border-white/10 pt-3 mt-3 flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400">{currentUser?.email}</p>
                <p className="text-xs text-[#F97316] font-medium">{currentUser?.role}</p>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white bg-white/5 px-3 py-1.5 rounded-lg transition"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          </div>
        )}
      </nav>
    </>
  );
}
