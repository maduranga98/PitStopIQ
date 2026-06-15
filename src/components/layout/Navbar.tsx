import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, Car, Wrench, FileText, MessageSquare,
  Package, BarChart2, UserCog, Settings, LogOut, Menu, X, ChevronLeft,
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
  { to: "/inventory", icon: Package, label: "Inventory" },
  { to: "/sms-logs", icon: MessageSquare, label: "SMS Logs" },
  { to: "/analytics", icon: BarChart2, label: "Analytics & Reports" },
  { to: "/employees", icon: UserCog, label: "Member Management" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

function canSee(to: string, role?: UserRole): boolean {
  if (to === "/analytics") return role === "Owner" || role === "Manager" || role === "Cashier";
  if (to === "/employees") return role === "Owner" || role === "Manager";
  if (to === "/settings") return role === "Owner" || role === "Manager";
  return true;
}

interface NavbarProps {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
}

export default function Navbar({ collapsed, setCollapsed, mobileOpen, setMobileOpen }: NavbarProps) {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();

  const visibleItems = NAV_ITEMS.filter(item => canSee(item.to, currentUser?.role));

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

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-0.5">
        {visibleItems.map(({ to, icon: Icon, label, exact }) => (
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
            title={collapsed ? label : undefined}
          >
            {({ isActive }) => (
              <>
                <Icon className={`h-4 w-4 flex-shrink-0 ${isActive ? "text-[#F97316]" : ""}`} />
                {!collapsed && <span className="truncate">{label}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User info + logout */}
      <div className={`border-t border-white/10 p-3 flex-shrink-0 ${collapsed ? "flex flex-col items-center gap-2" : ""}`}>
        {!collapsed && (
          <div className="mb-2 px-1">
            <p className="text-xs text-gray-400 truncate">{currentUser?.email}</p>
            <p className="text-xs text-[#F97316] font-medium mt-0.5">{currentUser?.role}</p>
          </div>
        )}
        <button
          onClick={handleLogout}
          className={`flex items-center gap-2 text-sm text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition ${
            collapsed ? "p-2" : "w-full px-3 py-2"
          }`}
          title={collapsed ? "Sign out" : undefined}
        >
          <LogOut className="h-4 w-4 flex-shrink-0" />
          {!collapsed && <span>Sign out</span>}
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
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
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
