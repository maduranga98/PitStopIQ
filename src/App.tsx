import { Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { lazyWithRetry as lazy } from "./lib/lazyWithRetry";
import { AuthProvider } from "./contexts/AuthContext";
import { PermissionsProvider } from "./contexts/PermissionsContext";
import { SuperAdminProvider } from "./contexts/SuperAdminContext";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { RequirePermission } from "./components/auth/RequirePermission";
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
const StockCountPage = lazy(() => import("./pages/inventory/StockCountPage"));
const OutletListPage = lazy(() => import("./pages/outlets/OutletListPage"));
const PosPage = lazy(() => import("./pages/pos/PosPage"));
const PosSalesPage = lazy(() => import("./pages/pos/PosSalesPage"));
const DistributorListPage = lazy(() => import("./pages/distributors/DistributorListPage"));
const DistributorOrdersPage = lazy(() => import("./pages/distributors/DistributorOrdersPage"));
const DistributorStockRequestsPage = lazy(() => import("./pages/distributors/DistributorStockRequestsPage"));
const SupplierListPage = lazy(() => import("./pages/suppliers/SupplierListPage"));
const RecordSupplyPage = lazy(() => import("./pages/suppliers/RecordSupplyPage"));
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
const AttendancePage = lazy(() => import("./pages/attendance/AttendancePage"));
const AnalyticsPage = lazy(() => import("./pages/analytics/AnalyticsPage"));
const BranchesSettingsPage = lazy(() => import("./pages/settings/branches/BranchesSettingsPage"));
const SettingsPage = lazy(() => import("./pages/settings/SettingsPage"));
const RolePermissionsPage = lazy(() => import("./pages/settings/RolePermissionsPage"));
const CustomRolesPage = lazy(() => import("./pages/settings/CustomRolesPage"));
const PublicCustomerView = lazy(() => import("./pages/public/PublicCustomerView"));
const PublicInvoiceView = lazy(() => import("./pages/public/PublicInvoiceView"));
const DistributorPortal = lazy(() => import("./pages/public/DistributorPortal"));
const ShortLinkResolver = lazy(() => import("./pages/public/ShortLinkResolver"));
const AccountingPage = lazy(() => import("./pages/accounting/AccountingPage"));
const ChequesPage = lazy(() => import("./pages/finance/ChequesPage"));

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
              <Route path="/settings/role-permissions" element={<RolePermissionsPage />} />
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
              <Route element={<RequirePermission anyOf={["outlets.view"]} />}>
                <Route path="/outlets" element={<OutletListPage />} />
              </Route>
              <Route element={<RequirePermission anyOf={["pos.view"]} />}>
                <Route path="/pos" element={<PosPage />} />
              </Route>
              <Route element={<RequirePermission anyOf={["pos.viewSales"]} redirectTo="/pos" />}>
                <Route path="/pos/sales" element={<PosSalesPage />} />
              </Route>
              <Route element={<RequirePermission anyOf={["suppliers.view"]} />}>
                <Route path="/suppliers" element={<SupplierListPage />} />
              </Route>
              <Route element={<RequirePermission anyOf={["suppliers.recordSupply"]} redirectTo="/suppliers" />}>
                <Route path="/suppliers/supply" element={<RecordSupplyPage />} />
              </Route>
              <Route element={<RequirePermission anyOf={["distributors.view"]} />}>
                <Route path="/distributors" element={<DistributorListPage />} />
              </Route>
              <Route element={<RequirePermission anyOf={["distributors.viewOrders"]} redirectTo="/distributors" />}>
                <Route path="/distributors/orders" element={<DistributorOrdersPage />} />
              </Route>
              <Route element={<RequirePermission anyOf={["distributors.manageStockRequests", "distributors.viewOrders"]} redirectTo="/distributors" />}>
                <Route path="/distributors/stock-requests" element={<DistributorStockRequestsPage />} />
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
                <Route path="/attendance" element={<AttendancePage />} />
              </Route>
              <Route
                element={
                  <RequirePermission
                    anyOf={["analytics.viewRevenue", "analytics.viewServiceFrequency", "analytics.viewTechPerformance", "analytics.viewSmsAnalytics"]}
                  />
                }
              >
                <Route path="/analytics" element={<AnalyticsPage />} />
              </Route>
              <Route path="/accounting" element={<AccountingPage />} />
              {/* The cheque & credit register gates itself to Owner/Manager,
                  the same way the accounting page does. */}
              <Route path="/cheques" element={<ChequesPage />} />
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
