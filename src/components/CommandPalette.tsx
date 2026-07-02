import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, Car, Wrench, FileText, Calculator, Package,
  MessageSquare, BarChart2, UserCog, Settings, Plus, Search, CornerDownLeft,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { usePermissions } from "../contexts/PermissionsContext";
import type { UserRole } from "../types/auth";

interface Command {
  id: string;
  label: string;
  keywords?: string;
  icon: React.ComponentType<{ className?: string }>;
  to: string;
  section: "Navigate" | "Create";
  roles?: UserRole[];
  permKey?: string;
  anyPermKeys?: string[];
  proOnly?: boolean;
}

const COMMANDS: Command[] = [
  // Navigation — mirrors the sidebar's visibility rules
  { id: "nav-dashboard", label: "Dashboard", icon: LayoutDashboard, to: "/", section: "Navigate" },
  { id: "nav-customers", label: "Customers", icon: Users, to: "/customers", section: "Navigate", permKey: "customers.view" },
  { id: "nav-vehicles", label: "Vehicles", icon: Car, to: "/vehicles", section: "Navigate", permKey: "vehicles.view" },
  { id: "nav-services", label: "Services", keywords: "jobs job cards", icon: Wrench, to: "/services", section: "Navigate", anyPermKeys: ["jobs.viewAll", "jobs.viewOwn"] },
  { id: "nav-invoices", label: "Invoices", keywords: "billing payments", icon: FileText, to: "/invoices", section: "Navigate", permKey: "invoices.view" },
  { id: "nav-accounting", label: "Accounting", keywords: "expenses profit revenue", icon: Calculator, to: "/accounting", section: "Navigate", roles: ["Owner", "Manager"] },
  { id: "nav-inventory", label: "Inventory", keywords: "stock parts", icon: Package, to: "/inventory", section: "Navigate", permKey: "inventory.view", proOnly: true },
  { id: "nav-sms", label: "SMS Logs", keywords: "messages", icon: MessageSquare, to: "/sms-logs", section: "Navigate", permKey: "sms.viewLog" },
  { id: "nav-analytics", label: "Analytics & Reports", icon: BarChart2, to: "/analytics", section: "Navigate", anyPermKeys: ["analytics.viewRevenue", "analytics.viewServiceFrequency", "analytics.viewTechPerformance", "analytics.viewSmsAnalytics"], proOnly: true },
  { id: "nav-employees", label: "Employees", keywords: "staff team", icon: UserCog, to: "/employees", section: "Navigate", permKey: "staff.view", proOnly: true },
  { id: "nav-settings", label: "Settings", icon: Settings, to: "/settings", section: "Navigate", roles: ["Owner", "Manager"] },
  // Quick create actions
  { id: "new-job", label: "New Service Job", keywords: "create job card", icon: Plus, to: "/services/new", section: "Create", permKey: "jobs.create" },
  { id: "new-invoice", label: "New Invoice", keywords: "create bill", icon: Plus, to: "/invoices/new", section: "Create", permKey: "invoices.create" },
  { id: "new-customer", label: "Add Customer", keywords: "create new", icon: Plus, to: "/customers/add", section: "Create", permKey: "customers.create" },
  { id: "new-vehicle", label: "Add Vehicle", keywords: "create new", icon: Plus, to: "/vehicles/add", section: "Create", permKey: "vehicles.create" },
  { id: "new-inventory", label: "Add Inventory Item", keywords: "create stock part", icon: Plus, to: "/inventory/add", section: "Create", permKey: "inventory.create", proOnly: true },
];

export default function CommandPalette() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { hasPermission } = usePermissions();
  const [open, setOpen] = useState(false);
  const [queryText, setQueryText] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const role = currentUser?.role;
  const isPro = currentUser?.centerPlan === "pro";

  const visible = useMemo(
    () =>
      COMMANDS.filter((c) => {
        if (c.roles && (!role || !c.roles.includes(role))) return false;
        if (c.proOnly && !isPro) return false;
        if (c.permKey && !hasPermission(c.permKey)) return false;
        if (c.anyPermKeys && !c.anyPermKeys.some((k) => hasPermission(k))) return false;
        return true;
      }),
    [role, isPro, hasPermission],
  );

  const filtered = useMemo(() => {
    const q = queryText.trim().toLowerCase();
    if (!q) return visible;
    return visible.filter(
      (c) => c.label.toLowerCase().includes(q) || (c.keywords ?? "").includes(q),
    );
  }, [visible, queryText]);

  const close = useCallback(() => {
    setOpen(false);
    setQueryText("");
    setActiveIdx(0);
  }, []);

  // Global Ctrl/Cmd+K shortcut
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        setQueryText("");
        setActiveIdx(0);
      } else if (e.key === "Escape") {
        close();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function run(cmd: Command) {
    close();
    navigate(cmd.to);
  }

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && filtered[activeIdx]) {
      e.preventDefault();
      run(filtered[activeIdx]);
    }
  }

  // Keep the active row in view while arrowing through results
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${activeIdx}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  if (!open) return null;

  const sections: Array<Command["section"]> = ["Create", "Navigate"];

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[15vh] px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />
      <div className="relative w-full max-w-lg bg-[#162032] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 border-b border-white/10">
          <Search className="w-4 h-4 text-gray-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={queryText}
            onChange={(e) => { setQueryText(e.target.value); setActiveIdx(0); }}
            onKeyDown={onInputKeyDown}
            placeholder="Type a command or search…"
            className="flex-1 bg-transparent py-3.5 text-sm text-white placeholder-gray-500 focus:outline-none"
          />
          <kbd className="text-[10px] text-gray-500 border border-white/10 rounded px-1.5 py-0.5">ESC</kbd>
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500 text-center">No matching commands</p>
          ) : (
            sections.map((section) => {
              const items = filtered.filter((c) => c.section === section);
              if (items.length === 0) return null;
              return (
                <div key={section}>
                  <p className="px-4 pt-2 pb-1 text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                    {section}
                  </p>
                  {items.map((cmd) => {
                    const idx = filtered.indexOf(cmd);
                    const active = idx === activeIdx;
                    const Icon = cmd.icon;
                    return (
                      <button
                        key={cmd.id}
                        data-idx={idx}
                        onClick={() => run(cmd)}
                        onMouseMove={() => setActiveIdx(idx)}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                          active ? "bg-[#F97316]/15 text-white" : "text-gray-300"
                        }`}
                      >
                        <Icon className={`w-4 h-4 shrink-0 ${active ? "text-[#F97316]" : "text-gray-500"}`} />
                        <span className="flex-1 text-left">{cmd.label}</span>
                        {active && <CornerDownLeft className="w-3.5 h-3.5 text-gray-500" />}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-3 px-4 py-2 border-t border-white/10 text-[10px] text-gray-500">
          <span><kbd className="border border-white/10 rounded px-1">↑↓</kbd> navigate</span>
          <span><kbd className="border border-white/10 rounded px-1">↵</kbd> select</span>
          <span className="ml-auto">Ctrl/⌘ + K</span>
        </div>
      </div>
    </div>
  );
}
