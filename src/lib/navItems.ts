import {
  LayoutDashboard, Users, Car, Wrench, FileText, Calculator, Package,
  ClipboardList, MessageSquare, BarChart2, UserCog, Settings,
  Truck, PackageCheck,
} from "lucide-react";
import type { UserRole } from "../types/auth";

export type NavItem = {
  to: string;
  icon: React.ElementType;
  labelKey: string;
  exact?: boolean;
  roles?: UserRole[];      // hard role guard (owner-level pages)
  proOnly?: boolean;
  permKey?: string;        // hidden when the current user lacks this permission
  anyPermKeys?: string[];  // shown when the user has ANY of these
};

// Single source of truth for what each role can reach. The sidebar and the
// command palette both read this so they can never drift apart.
export const NAV_ITEMS: NavItem[] = [
  { to: "/", icon: LayoutDashboard, labelKey: "nav.dashboard", exact: true },
  { to: "/customers", icon: Users, labelKey: "nav.customers", permKey: "customers.view" },
  { to: "/vehicles", icon: Car, labelKey: "nav.vehicles", permKey: "vehicles.view" },
  { to: "/services", icon: Wrench, labelKey: "nav.services", anyPermKeys: ["jobs.viewAll", "jobs.viewOwn"] },
  { to: "/invoices", icon: FileText, labelKey: "nav.invoices", permKey: "invoices.view" },
  { to: "/accounting", icon: Calculator, labelKey: "nav.accounting", roles: ["Owner", "Manager"] },
  { to: "/inventory", icon: Package, labelKey: "nav.inventory", permKey: "inventory.view", proOnly: true },
  { to: "/inventory/requests", icon: ClipboardList, labelKey: "nav.inventoryRequests", anyPermKeys: ["inventory.request", "inventory.approveRequests"], proOnly: true },
  { to: "/distributors", icon: Truck, labelKey: "nav.distributors", permKey: "distributors.view", proOnly: true },
  { to: "/distributors/orders", icon: PackageCheck, labelKey: "nav.distributorOrders", permKey: "distributors.viewOrders", proOnly: true },
  { to: "/sms-logs", icon: MessageSquare, labelKey: "nav.smsLogs", permKey: "sms.viewLog" },
  { to: "/analytics", icon: BarChart2, labelKey: "nav.analytics", anyPermKeys: ["analytics.viewRevenue", "analytics.viewServiceFrequency", "analytics.viewTechPerformance", "analytics.viewSmsAnalytics"], proOnly: true },
  { to: "/employees", icon: UserCog, labelKey: "nav.employees", permKey: "staff.view", proOnly: true },
  { to: "/settings", icon: Settings, labelKey: "nav.settings", roles: ["Owner", "Manager"] },
];

// Role/permission gate shared by every navigation surface. `pro` only affects
// whether a Pro-only item is *reachable*; the sidebar still renders locked
// Pro items so Basic-plan owners can see what upgrading unlocks.
export function isNavItemAllowed(
  item: { roles?: UserRole[]; permKey?: string; anyPermKeys?: string[] },
  role: UserRole | undefined,
  hasPermission: (key: string) => boolean,
): boolean {
  if (item.roles && (!role || !item.roles.includes(role))) return false;
  if (item.permKey && !hasPermission(item.permKey)) return false;
  if (item.anyPermKeys && !item.anyPermKeys.some(k => hasPermission(k))) return false;
  return true;
}
