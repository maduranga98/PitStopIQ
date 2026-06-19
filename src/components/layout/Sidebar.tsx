import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, Car, Wrench, FileText, MessageSquare,
  Package, BarChart2, UserCog, Settings, LogOut, ChevronRight,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../contexts/AuthContext";
import type { UserRole } from "../../types/auth";

type NavItem = {
  to: string;
  icon: React.ElementType;
  labelKey: string;
  exact?: boolean;
  roles?: UserRole[];
};

const NAV_ITEMS: NavItem[] = [
  { to: "/", icon: LayoutDashboard, labelKey: "nav.dashboard", exact: true },
  { to: "/customers", icon: Users, labelKey: "nav.customers" },
  { to: "/vehicles", icon: Car, labelKey: "nav.vehicles" },
  { to: "/services", icon: Wrench, labelKey: "nav.services" },
  { to: "/invoices", icon: FileText, labelKey: "nav.invoices", roles: ["Owner", "Manager", "Cashier", "Receptionist"] },
  { to: "/inventory", icon: Package, labelKey: "nav.inventory", roles: ["Owner", "Manager", "Cashier"] },
  { to: "/sms-logs", icon: MessageSquare, labelKey: "nav.smsLogs", roles: ["Owner", "Manager", "Technician"] },
  { to: "/analytics", icon: BarChart2, labelKey: "nav.analytics", roles: ["Owner", "Manager", "Cashier"] },
  { to: "/employees", icon: UserCog, labelKey: "nav.employees", roles: ["Owner", "Manager"] },
  { to: "/settings", icon: Settings, labelKey: "nav.settings", roles: ["Owner", "Manager"] },
];

export default function Sidebar() {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const role = currentUser?.role;
  const visibleItems = NAV_ITEMS.filter(item => !item.roles || (role && item.roles.includes(role)));

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
        {visibleItems.map(({ to, icon: Icon, labelKey, exact }) => (
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
                <span className="flex-1">{t(labelKey)}</span>
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
          {t("nav.signOut")}
        </button>
      </div>
    </aside>
  );
}
