import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, Car, Wrench, FileText, MessageSquare,
  Package, BarChart2, UserCog, Settings, LogOut, Menu, X, ChevronLeft, Calculator,
  Building2, ChevronDown, ArrowLeftCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../contexts/AuthContext";
import LanguageSwitcher from "../LanguageSwitcher";
import NetworkStatusBadge from "../NetworkStatusBadge";
import type { UserRole } from "../../types/auth";

type NavItem = {
  to: string;
  icon: React.ElementType;
  labelKey: string;
  exact?: boolean;
  roles?: UserRole[];
  proOnly?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { to: "/", icon: LayoutDashboard, labelKey: "nav.dashboard", exact: true },
  { to: "/customers", icon: Users, labelKey: "nav.customers" },
  { to: "/vehicles", icon: Car, labelKey: "nav.vehicles" },
  { to: "/services", icon: Wrench, labelKey: "nav.services" },
  { to: "/invoices", icon: FileText, labelKey: "nav.invoices", roles: ["Owner", "Manager", "Cashier", "Receptionist"] },
  { to: "/accounting", icon: Calculator, labelKey: "nav.accounting", roles: ["Owner", "Manager"] },
  { to: "/inventory", icon: Package, labelKey: "nav.inventory", roles: ["Owner", "Manager", "Cashier"], proOnly: true },
  { to: "/sms-logs", icon: MessageSquare, labelKey: "nav.smsLogs", roles: ["Owner", "Manager", "Technician"] },
  { to: "/analytics", icon: BarChart2, labelKey: "nav.analytics", roles: ["Owner", "Manager", "Cashier"], proOnly: true },
  { to: "/employees", icon: UserCog, labelKey: "nav.employees", roles: ["Owner", "Manager"], proOnly: true },
  { to: "/settings", icon: Settings, labelKey: "nav.settings", roles: ["Owner", "Manager"] },
];

interface NavbarProps {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
}

function BranchSwitcher({ collapsed }: { collapsed: boolean }) {
  const { currentUser, branches, switchBranch } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  if (branches.length < 2) return null;

  const active = branches.find((b) => b.id === currentUser?.centerId);

  async function handleSwitch(centerId: string) {
    setOpen(false);
    await switchBranch(centerId);
  }

  return (
    <div className={`relative border-b border-white/10 ${collapsed ? "px-2 py-2" : "px-3 py-2"}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 w-full rounded-lg hover:bg-white/5 transition text-left ${collapsed ? "justify-center p-1.5" : "px-2 py-1.5"}`}
        title={collapsed ? (active?.branchName ?? active?.name) : undefined}
      >
        <Building2 className="w-4 h-4 text-[#F97316] flex-shrink-0" />
        {!collapsed && (
          <>
            <span className="text-xs font-medium text-white truncate flex-1">
              {active?.branchName ?? active?.name ?? "Select branch"}
            </span>
            <ChevronDown className={`w-3.5 h-3.5 text-gray-500 transition-transform flex-shrink-0 ${open ? "rotate-180" : ""}`} />
          </>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className={`absolute z-40 top-full mt-1 ${collapsed ? "left-0" : "left-2 right-2"} min-w-[200px] bg-[#0B1120] border border-white/10 rounded-lg shadow-2xl py-1`}>
            {branches.map((b) => (
              <button
                key={b.id}
                onClick={() => handleSwitch(b.id)}
                className={`flex items-center gap-2 w-full px-3 py-2 text-xs text-left hover:bg-white/5 transition ${
                  b.id === currentUser?.centerId ? "text-[#F97316] font-medium" : "text-gray-300"
                }`}
              >
                <span className="truncate flex-1">{b.branchName ?? b.name}</span>
                {b.status !== "active" && <span className="text-[10px] text-red-400 flex-shrink-0">●</span>}
              </button>
            ))}
            <div className="border-t border-white/10 mt-1 pt-1">
              <button
                onClick={() => { setOpen(false); navigate("/select-branch"); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-400 hover:text-white hover:bg-white/5 transition"
              >
                <ArrowLeftCircle className="w-3.5 h-3.5" />
                Back to Overview
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function Navbar({ collapsed, setCollapsed, mobileOpen, setMobileOpen }: NavbarProps) {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const role = currentUser?.role;
  const isPro = currentUser?.centerPlan === "pro";
  const visibleItems = NAV_ITEMS.filter(item => {
    if (item.roles && (!role || !item.roles.includes(role))) return false;
    if (item.proOnly && !isPro) return false;
    return true;
  });

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  const SidebarContent = ({ onClose }: { onClose?: () => void }) => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className={`flex items-center gap-3 px-4 h-16 border-b border-white/10 flex-shrink-0 ${collapsed ? "justify-center" : "justify-between"}`}>
        {!collapsed && (
          <div className="flex items-center gap-2 min-w-0">
            <img src="/logo.png" alt="PitStop IQ" className="h-7 w-auto flex-shrink-0" onError={(e) => (e.currentTarget.style.display = "none")} />
            <span className="text-base font-extrabold tracking-tight text-white truncate">
              PITSTOP <span className="text-[#F97316]">IQ</span>
            </span>
          </div>
        )}
        {collapsed && (
          <span className="text-base font-extrabold text-[#F97316]">P</span>
        )}
        {onClose ? (
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition flex-shrink-0">
            <X className="h-5 w-5" />
          </button>
        ) : (
          <button onClick={() => setCollapsed(!collapsed)} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition flex-shrink-0">
            <ChevronLeft className={`h-4 w-4 transition-transform ${collapsed ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>

      <BranchSwitcher collapsed={collapsed} />

      {/* Network status */}
      <div className={`border-b border-white/10 ${collapsed ? "flex justify-center py-1" : "px-3 py-1"}`}>
        <NetworkStatusBadge />
      </div>

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto scrollbar-hide py-4 px-2 space-y-0.5">
        {visibleItems.map(({ to, icon: Icon, labelKey, exact }) => (
          <NavLink
            key={to}
            to={to}
            end={exact}
            onClick={onClose}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition group ${
                isActive
                  ? "bg-[#F97316]/20 text-[#F97316]"
                  : "text-gray-400 hover:text-white hover:bg-white/5"
              } ${collapsed ? "justify-center" : ""}`
            }
            title={collapsed ? t(labelKey) : undefined}
          >
            {({ isActive }) => (
              <>
                <Icon className={`h-4 w-4 flex-shrink-0 ${isActive ? "text-[#F97316]" : ""}`} />
                {!collapsed && <span className="truncate">{t(labelKey)}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User info + logout */}
      <div className={`border-t border-white/10 p-3 flex-shrink-0 ${collapsed ? "flex flex-col items-center gap-2" : "space-y-2"}`}>
        {!collapsed && (
          <div className="px-1">
            <p className="text-xs text-gray-400 truncate">{currentUser?.email}</p>
            <p className="text-xs text-[#F97316] font-medium mt-0.5">{currentUser?.role}</p>
          </div>
        )}
        <LanguageSwitcher compact={collapsed} dropUp />
        <button
          onClick={handleLogout}
          className={`flex items-center gap-2 text-sm text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition ${
            collapsed ? "p-2" : "w-full px-3 py-2"
          }`}
          title={collapsed ? t("nav.signOut") : undefined}
        >
          <LogOut className="h-4 w-4 flex-shrink-0" />
          {!collapsed && <span>{t("nav.signOut")}</span>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={`hidden lg:flex flex-col bg-[#162032] border-r border-white/10 h-screen sticky top-0 flex-shrink-0 transition-all duration-200 ${
          collapsed ? "w-16" : "w-60"
        }`}
      >
        <SidebarContent />
      </aside>

      {/* Mobile top bar */}
      <div className="lg:hidden flex items-center justify-between bg-[#162032] border-b border-white/10 px-4 h-14 sticky top-0 z-40">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="PitStop IQ" className="h-7 w-auto" onError={(e) => (e.currentTarget.style.display = "none")} />
          <span className="text-base font-extrabold tracking-tight text-white">
            PITSTOP <span className="text-[#F97316]">IQ</span>
          </span>
        </div>
        <div className="flex items-center gap-1">
          <NetworkStatusBadge />
          <LanguageSwitcher compact />
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 bg-black/50 z-40"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="lg:hidden fixed left-0 top-0 bottom-0 w-64 bg-[#162032] z-50 flex flex-col">
            <SidebarContent onClose={() => setMobileOpen(false)} />
          </aside>
        </>
      )}
    </>
  );
}
