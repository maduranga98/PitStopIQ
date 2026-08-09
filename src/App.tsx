import { Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { lazyWithRetry as lazy } from "./lib/lazyWithRetry";
import { AuthProvider } from "./contexts/AuthContext";
import { PermissionsProvider } from "./contexts/PermissionsContext";
import { SuperAdminProvider } from "./contexts/SuperAdminContext";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { RequirePermission } from "./components/auth/RequirePermission";
import { RequireStoreAddon } from "./components/auth/RequireStoreAddon";
import { SuperAdminRoute } from "./components/auth/SuperAdminRoute";
import Layout from "./components/layout/Layout";
import AdminLayout from "./components/layout/AdminLayout";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PublicRoute } from "./components/auth/PublicRoute";
import { LoadingScreen } from "./components/LoadingProgress";

// Route-level code splitting: each page loads on demand, keeping the initial
// download small — important on slow connections.
const AdminLoginPage = lazy(() => import("./pages/admin/AdminLoginPage"));
const AdminDashboardPage = lazy(() => import("./pages/admin/AdminDashboardPage"));
const AdminPaymentsPage = lazy(() => import("./pages/admin/AdminPaymentsPage"));
const AdminRequestsPage = lazy(() => import("./pages/admin/AdminRequestsPage"));
const AdminUnpaidCentersPage = lazy(() => import("./pages/admin/AdminUnpaidCentersPage"));
const ServiceCentersPage = lazy(() => import("./pages/admin/ServiceCentersPage"));
const RegisterServiceCenterPage = lazy(() => import("./pages/admin/RegisterServiceCenterPage"));
const ServiceCenterDetailPage = lazy(() => import("./pages/admin/ServiceCenterDetailPage"));
const LoginPage = lazy(() => import("./pages/auth/LoginPage"));
const RegisterPage = lazy(() => import("./pages/auth/RegisterPage"));
const ForgotPasswordPage = lazy(() => import("./pages/auth/ForgotPasswordPage"));
const InviteAcceptPage = lazy(() => import("./pages/auth/InviteAcceptPage"));
const BranchSelectorPage = lazy(() => import("./pages/auth/BranchSelectorPage"));
const HomeRoute = lazy(() => import("./components/auth/HomeRoute"));
const CustomerListPage = lazy(() => import("./pages/customers/CustomerListPage"));
const AddCustomerPage = lazy(() => import("./pages/customers/AddCustomerPage"));
const CustomerDetailPage = lazy(() => import("./pages/customers/CustomerDetailPage"));
const CustomerFeedbackPage = lazy(() => import("./pages/customers/CustomerFeedbackPage"));
const VehicleListPage = lazy(() => import("./pages/vehicles/VehicleListPage"));
const AddVehiclePage = lazy(() => import("./pages/vehicles/AddVehiclePage"));
const EditVehiclePage = lazy(() => import("./pages/vehicles/EditVehiclePage"));
const VehicleDetailPage = lazy(() => import("./pages/vehicles/VehicleDetailPage"));
const ServicesPage = lazy(() => import("./pages/services/ServicesPage"));
const NewServicePage = lazy(() => import("./pages/services/NewServicePage"));
const ServiceDetailPage = lazy(() => import("./pages/services/ServiceDetailPage"));
const SmsSettingsPage = lazy(() => import("./pages/settings/SmsSettingsPage"));
const SmsLogPage = lazy(() => import("./pages/sms/SmsLogPage"));
const InventoryListPage = lazy(() => import("./pages/inventory/InventoryListPage"));
const InventoryRequestsPage = lazy(() => import("./pages/inventory/InventoryRequestsPage"));
const InventoryAuditPage = lazy(() => import("./pages/inventory/InventoryAuditPage"));
const AuditLogPage = lazy(() => import("./pages/audit/AuditLogPage"));
const StockCountPage = lazy(() => import("./pages/inventory/StockCountPage"));
const OutletListPage = lazy(() => import("./pages/outlets/OutletListPage"));
const PosSalesPage = lazy(() => import("./pages/pos/PosSalesPage"));
const PosTerminalPage = lazy(() => import("./pages/pos/PosTerminalPage"));
const DistributorListPage = lazy(() => import("./pages/distributors/DistributorListPage"));
const DistributorOrdersPage = lazy(() => import("./pages/distributors/DistributorOrdersPage"));
const DistributorStockRequestsPage = lazy(() => import("./pages/distributors/DistributorStockRequestsPage"));
const SupplierListPage = lazy(() => import("./pages/suppliers/SupplierListPage"));
const RecordSupplyPage = lazy(() => import("./pages/suppliers/RecordSupplyPage"));
const PurchaseOrdersPage = lazy(() => import("./pages/suppliers/PurchaseOrdersPage"));
const PlanOrderPage = lazy(() => import("./pages/suppliers/PlanOrderPage"));
const AddEditInventoryPage = lazy(() => import("./pages/inventory/AddEditInventoryPage"));
const InvoiceListPage = lazy(() => import("./pages/invoices/InvoiceListPage"));
const InvoiceDetailPage = lazy(() => import("./pages/invoices/InvoiceDetailPage"));
const NewInvoicePage = lazy(() => import("./pages/invoices/NewInvoicePage"));
const QuotationListPage = lazy(() => import("./pages/quotations/QuotationListPage"));
const QuotationDetailPage = lazy(() => import("./pages/quotations/QuotationDetailPage"));
const NewQuotationPage = lazy(() => import("./pages/quotations/NewQuotationPage"));
const EmployeeListPage = lazy(() => import("./pages/employees/EmployeeListPage"));
const AddEditEmployeePage = lazy(() => import("./pages/employees/AddEditEmployeePage"));
const EmployeeDetailPage = lazy(() => import("./pages/employees/EmployeeDetailPage"));
const TechnicianJobCountsPage = lazy(() => import("./pages/employees/TechnicianJobCountsPage"));
const PayrollSettingsPage = lazy(() => import("./pages/settings/PayrollSettingsPage"));
const PayslipDetailPage = lazy(() => import("./pages/employees/PayslipDetailPage"));
const AttendancePage = lazy(() => import("./pages/attendance/AttendancePage"));
const DepartmentsPage = lazy(() => import("./pages/departments/DepartmentsPage"));
const BookingsPage = lazy(() => import("./pages/bookings/BookingsPage"));
const AnalyticsPage = lazy(() => import("./pages/analytics/AnalyticsPage"));
const BranchesSettingsPage = lazy(() => import("./pages/settings/branches/BranchesSettingsPage"));
const SettingsPage = lazy(() => import("./pages/settings/SettingsPage"));
const CustomRolesPage = lazy(() => import("./pages/settings/CustomRolesPage"));
const PublicCustomerView = lazy(() => import("./pages/public/PublicCustomerView"));
const PublicInvoiceView = lazy(() => import("./pages/public/PublicInvoiceView"));
const DistributorPortal = lazy(() => import("./pages/public/DistributorPortal"));
const ShortLinkResolver = lazy(() => import("./pages/public/ShortLinkResolver"));
const AccountingPage = lazy(() => import("./pages/accounting/AccountingPage"));
const ChequesPage = lazy(() => import("./pages/finance/ChequesPage"));
const HelpPage = lazy(() => import("./pages/help/HelpPage"));

function PageLoader() {
  // Route chunks are normally cached, so a short expectation makes a slow
  // network read as slow rather than as a hung screen.
  return <LoadingScreen expectedMs={1500} />;
}

function RouteBoundary() {
  return (
    <ErrorBoundary label="Page">
      <Outlet />
    </ErrorBoundary>
  );
}

// The sign-in flow's boundary. Its fallback is deliberately plainer than the
// default one: someone stuck at the login screen needs to know the app broke
// (rather than that their password was wrong) and how to get help — not a
// component stack. The underlying error is still logged, and readable under
// "Technical details".
function AuthBoundary() {
  return (
    <ErrorBoundary
      label="Sign in"
      fallback={(error, reset) => <AuthCrashScreen error={error} reset={reset} />}
    >
      <Outlet />
    </ErrorBoundary>
  );
}

function AuthCrashScreen({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-screen bg-[#0B1120] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#162032] border border-white/10 rounded-2xl shadow-2xl p-8 text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full border border-red-500/30 bg-red-500/10">
          <AlertTriangle className="h-6 w-6 text-red-400" />
        </div>
        <h1 className="text-lg font-semibold text-white">The sign-in page failed to load</h1>
        <p className="mt-2 text-sm text-gray-400">
          This is a problem with the app, not with your phone number or password.
          Reload to try again — if it keeps happening, send PitStopIQ support the
          details below.
        </p>
        <div className="mt-6 space-y-2">
          <button
            onClick={() => window.location.reload()}
            className="w-full rounded-lg bg-[#F97316] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#ea6c0f]"
          >
            Reload
          </button>
          <button
            onClick={reset}
            className="w-full rounded-lg border border-white/10 px-4 py-2.5 text-sm font-medium text-gray-300 transition hover:bg-white/5"
          >
            Try again
          </button>
        </div>
        <details className="mt-5 text-left text-xs text-gray-600">
          <summary className="cursor-pointer hover:text-gray-400">Technical details</summary>
          <p className="mt-2 break-words rounded bg-black/30 p-2 font-mono text-[11px] text-gray-500">
            {error.name}: {error.message}
          </p>
        </details>
      </div>
    </div>
  );
}

function AdminApp() {
  return (
    <SuperAdminProvider>
      <Routes>
        <Route path="login" element={<AdminLoginPage />} />
        <Route element={<SuperAdminRoute />}>
          <Route element={<AdminLayout />}>
            <Route index element={<AdminDashboardPage />} />
            <Route path="service-centers" element={<ServiceCentersPage />} />
            <Route path="service-centers/register" element={<RegisterServiceCenterPage />} />
            <Route path="service-centers/:centerId" element={<ServiceCenterDetailPage />} />
            <Route path="requests" element={<AdminRequestsPage />} />
            <Route path="payments" element={<AdminPaymentsPage />} />
            <Route path="unpaid" element={<AdminUnpaidCentersPage />} />
          </Route>
        </Route>
      </Routes>
    </SuperAdminProvider>
  );
}

function ServiceCenterApp() {
  return (
    <AuthProvider>
      <PermissionsProvider>
        <Routes>
          {/* Public customer view — no auth required */}
          <Route path="/v/:code" element={<ShortLinkResolver />} />
          <Route path="/c/:centerId/:customerId" element={<PublicCustomerView />} />
          <Route path="/c/:centerId/:customerId/invoice/:invoiceId" element={<PublicInvoiceView />} />
          {/* Distributor catalog — reached only via the link the owner shares */}
          <Route path="/d/:centerId/:distributorId/:token" element={<DistributorPortal />} />
          {/* Standalone POS register — the counter device's link, no staff login */}
          <Route path="/pos-terminal/:centerId/:outletId/:token" element={<PosTerminalPage />} />

          {/* Sign-in and branch selection get their own boundary: a crash here
              used to bubble to the app-level one, and a user who can't get past
              the login screen has no way to tell a broken page from a rejected
              password. */}
          <Route element={<AuthBoundary />}>
            {/* Public-only routes — redirect to dashboard if already authenticated */}
            <Route element={<PublicRoute />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/invite/:token" element={<InviteAcceptPage />} />
            </Route>

            {/* Multi-branch owner picks which branch to work in. Not wrapped in
                ProtectedRoute so it can be revisited any time without the
                needsBranchSelection redirect looping back to itself. */}
            <Route path="/select-branch" element={<BranchSelectorPage />} />
          </Route>

          {/* Protected routes */}
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route element={<RouteBoundary />}>
              <Route path="/" element={<HomeRoute />} />
              {/* Customer and vehicle directories are hidden from roles that
                  don't own them (technicians), URL included. */}
              <Route element={<RequirePermission anyOf={["customers.view"]} />}>
                <Route path="/customers" element={<CustomerListPage />} />
                <Route path="/customers/add" element={<AddCustomerPage />} />
                <Route path="/customers/:customerId" element={<CustomerDetailPage />} />
                <Route path="/customers/feedback" element={<CustomerFeedbackPage />} />
              </Route>
              <Route element={<RequirePermission anyOf={["vehicles.view"]} />}>
                <Route path="/vehicles" element={<VehicleListPage />} />
                <Route path="/vehicles/add" element={<AddVehiclePage />} />
                <Route path="/vehicles/:vehicleId" element={<VehicleDetailPage />} />
                <Route path="/vehicles/:vehicleId/edit" element={<EditVehiclePage />} />
              </Route>
              <Route element={<RequirePermission anyOf={["jobs.viewAll", "jobs.viewOwn"]} />}>
                <Route path="/services" element={<ServicesPage />} />
                <Route path="/services/:jobId" element={<ServiceDetailPage />} />
              </Route>
              <Route element={<RequirePermission anyOf={["jobs.create"]} redirectTo="/services" />}>
                <Route path="/services/new" element={<NewServicePage />} />
              </Route>
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/sms" element={<SmsSettingsPage />} />
              <Route path="/settings/branches" element={<BranchesSettingsPage />} />
              {/* RolePermissionsPage is only meant to be rendered inside SettingsPage's
                  own tab chrome (see RolePermissionsTab there) — this bare route used
                  to render it standalone with no header/tabs, which is what made the
                  page look cut off after navigating back from Custom Roles. */}
              <Route path="/settings/role-permissions" element={<Navigate to="/settings?tab=rolePermissions" replace />} />
              <Route path="/settings/custom-roles" element={<CustomRolesPage />} />
              <Route element={<RequirePermission anyOf={["sms.viewLog"]} />}>
                <Route path="/sms-logs" element={<SmsLogPage />} />
              </Route>
              <Route element={<RequirePermission anyOf={["inventory.view"]} />}>
                <Route path="/inventory" element={<InventoryListPage />} />
                <Route path="/inventory/add" element={<AddEditInventoryPage />} />
                <Route path="/inventory/:itemId/edit" element={<AddEditInventoryPage />} />
              </Route>
              <Route element={<RequirePermission anyOf={["inventory.request", "inventory.approveRequests"]} />}>
                <Route path="/inventory/requests" element={<InventoryRequestsPage />} />
              </Route>
              <Route element={<RequirePermission anyOf={["inventory.viewLogs"]} redirectTo="/inventory" />}>
                <Route path="/inventory/audit" element={<InventoryAuditPage />} />
              </Route>
              <Route element={<RequirePermission anyOf={["inventory.stockCount"]} redirectTo="/inventory" />}>
                <Route path="/inventory/stock-count" element={<StockCountPage />} />
              </Route>
              {/* Outlets and POS live in one place behind the Outlets & POS
                  store add-on — purchased and approved from Settings →
                  Subscription → Store, see RequireStoreAddon. The in-app
                  pages are sales view and data viewing only (managing
                  outlets, assigning a cashier, sharing the POS terminal
                  link, reviewing sales) — the real register that rings up a
                  sale lives at that separate terminal link, on its own
                  device, with no staff login. */}
              <Route element={<RequireStoreAddon addon="outlets" />}>
                <Route element={<RequirePermission anyOf={["outlets.view"]} />}>
                  <Route path="/outlets" element={<OutletListPage />} />
                </Route>
                <Route element={<RequirePermission anyOf={["pos.viewSales"]} redirectTo="/outlets" />}>
                  <Route path="/pos/sales" element={<PosSalesPage />} />
                </Route>
              </Route>
              {/* Legacy bookmark — the standalone cart-based POS page moved to /outlets. */}
              <Route path="/pos" element={<Navigate to="/outlets" replace />} />
              <Route element={<RequirePermission anyOf={["suppliers.view"]} />}>
                <Route path="/suppliers" element={<SupplierListPage />} />
              </Route>
              <Route element={<RequirePermission anyOf={["suppliers.recordSupply"]} redirectTo="/suppliers" />}>
                <Route path="/suppliers/supply" element={<RecordSupplyPage />} />
              </Route>
              <Route element={<RequirePermission anyOf={["suppliers.planOrders"]} redirectTo="/suppliers" />}>
                <Route path="/suppliers/orders" element={<PurchaseOrdersPage />} />
                <Route path="/suppliers/orders/plan" element={<PlanOrderPage />} />
              </Route>
              {/* Distributors lives behind the Distributors store add-on. */}
              <Route element={<RequireStoreAddon addon="distributors" />}>
                <Route element={<RequirePermission anyOf={["distributors.view"]} />}>
                  <Route path="/distributors" element={<DistributorListPage />} />
                </Route>
                <Route element={<RequirePermission anyOf={["distributors.viewOrders"]} redirectTo="/distributors" />}>
                  <Route path="/distributors/orders" element={<DistributorOrdersPage />} />
                </Route>
                <Route element={<RequirePermission anyOf={["distributors.manageStockRequests", "distributors.viewOrders"]} redirectTo="/distributors" />}>
                  <Route path="/distributors/stock-requests" element={<DistributorStockRequestsPage />} />
                </Route>
              </Route>
              <Route element={<RequirePermission anyOf={["invoices.view"]} />}>
                <Route path="/invoices" element={<InvoiceListPage />} />
                <Route path="/invoices/new" element={<NewInvoicePage />} />
                <Route path="/invoices/:invoiceId" element={<InvoiceDetailPage />} />
              </Route>
              <Route element={<RequirePermission anyOf={["quotations.view"]} />}>
                <Route path="/quotations" element={<QuotationListPage />} />
                <Route path="/quotations/new" element={<NewQuotationPage />} />
                <Route path="/quotations/:quotationId" element={<QuotationDetailPage />} />
              </Route>
              <Route element={<RequirePermission anyOf={["staff.view"]} />}>
                <Route path="/employees" element={<EmployeeListPage />} />
                <Route path="/employees/add" element={<AddEditEmployeePage />} />
                <Route path="/employees/job-counts" element={<TechnicianJobCountsPage />} />
                <Route path="/employees/:staffId" element={<EmployeeDetailPage />} />
                <Route path="/employees/:staffId/edit" element={<AddEditEmployeePage />} />
                <Route path="/employees/:staffId/payslips/:payslipId" element={<PayslipDetailPage />} />
                <Route path="/settings/payroll" element={<PayrollSettingsPage />} />
                <Route path="/attendance" element={<AttendancePage />} />
              </Route>
              <Route element={<RequirePermission anyOf={["staff.viewAuditLog"]} redirectTo="/" />}>
                <Route path="/audit-log" element={<AuditLogPage />} />
              </Route>
              <Route element={<RequirePermission anyOf={["departments.view"]} redirectTo="/" />}>
                <Route path="/departments" element={<DepartmentsPage />} />
              </Route>
              <Route element={<RequirePermission anyOf={["bookings.view"]} redirectTo="/" />}>
                <Route path="/bookings" element={<BookingsPage />} />
              </Route>
              <Route
                element={
                  <RequirePermission
                    anyOf={["analytics.viewRevenue", "jobs.viewProfitability", "analytics.viewServiceFrequency", "analytics.viewTechPerformance", "analytics.viewSmsAnalytics"]}
                  />
                }
              >
                <Route path="/analytics" element={<AnalyticsPage />} />
              </Route>
              <Route path="/accounting" element={<AccountingPage />} />
              {/* The cheque & credit register gates itself to Owner/Manager,
                  the same way the accounting page does. */}
              <Route path="/cheques" element={<ChequesPage />} />
              {/* Help & support — open to every signed-in role. */}
              <Route path="/help" element={<HelpPage />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </PermissionsProvider>
    </AuthProvider>
  );
}

export default function App() {
  return (
    <ErrorBoundary label="App">
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Admin portal — isolated from AuthProvider so auth states don't conflict */}
            <Route path="/admin/*" element={<AdminApp />} />
            {/* Service center app */}
            <Route path="/*" element={<ServiceCenterApp />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
