import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { PermissionsProvider } from "./contexts/PermissionsContext";
import { SuperAdminProvider } from "./contexts/SuperAdminContext";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { SuperAdminRoute } from "./components/auth/SuperAdminRoute";
import Layout from "./components/layout/Layout";
import AdminLayout from "./components/layout/AdminLayout";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PublicRoute } from "./components/auth/PublicRoute";

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
const DashboardPage = lazy(() => import("./pages/dashboard/DashboardPage"));
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
const AddEditInventoryPage = lazy(() => import("./pages/inventory/AddEditInventoryPage"));
const InvoiceListPage = lazy(() => import("./pages/invoices/InvoiceListPage"));
const InvoiceDetailPage = lazy(() => import("./pages/invoices/InvoiceDetailPage"));
const NewInvoicePage = lazy(() => import("./pages/invoices/NewInvoicePage"));
const EmployeeListPage = lazy(() => import("./pages/employees/EmployeeListPage"));
const AddEditEmployeePage = lazy(() => import("./pages/employees/AddEditEmployeePage"));
const EmployeeDetailPage = lazy(() => import("./pages/employees/EmployeeDetailPage"));
const AnalyticsPage = lazy(() => import("./pages/analytics/AnalyticsPage"));
const BranchesSettingsPage = lazy(() => import("./pages/settings/branches/BranchesSettingsPage"));
const SettingsPage = lazy(() => import("./pages/settings/SettingsPage"));
const RolePermissionsPage = lazy(() => import("./pages/settings/RolePermissionsPage"));
const PublicCustomerView = lazy(() => import("./pages/public/PublicCustomerView"));
const PublicInvoiceView = lazy(() => import("./pages/public/PublicInvoiceView"));
const AccountingPage = lazy(() => import("./pages/accounting/AccountingPage"));

function PageLoader() {
  return (
    <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[#F97316] border-t-transparent rounded-full animate-spin" />
    </div>
  );
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
          <Route path="/c/:centerId/:customerId" element={<PublicCustomerView />} />
          <Route path="/c/:centerId/:customerId/invoice/:invoiceId" element={<PublicInvoiceView />} />

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
              <Route path="/" element={<DashboardPage />} />
              <Route path="/customers" element={<CustomerListPage />} />
              <Route path="/customers/add" element={<AddCustomerPage />} />
              <Route path="/customers/:customerId" element={<CustomerDetailPage />} />
              <Route path="/vehicles" element={<VehicleListPage />} />
              <Route path="/vehicles/add" element={<AddVehiclePage />} />
              <Route path="/vehicles/:vehicleId" element={<VehicleDetailPage />} />
              <Route path="/vehicles/:vehicleId/edit" element={<EditVehiclePage />} />
              <Route path="/services" element={<ServicesPage />} />
              <Route path="/services/new" element={<NewServicePage />} />
              <Route path="/services/:jobId" element={<ServiceDetailPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/sms" element={<SmsSettingsPage />} />
              <Route path="/settings/branches" element={<BranchesSettingsPage />} />
              <Route path="/settings/role-permissions" element={<RolePermissionsPage />} />
              <Route path="/sms-logs" element={<SmsLogPage />} />
              <Route path="/inventory" element={<InventoryListPage />} />
              <Route path="/inventory/add" element={<AddEditInventoryPage />} />
              <Route path="/inventory/:itemId/edit" element={<AddEditInventoryPage />} />
              <Route path="/invoices" element={<InvoiceListPage />} />
              <Route path="/invoices/new" element={<NewInvoicePage />} />
              <Route path="/invoices/:invoiceId" element={<InvoiceDetailPage />} />
              <Route path="/employees" element={<EmployeeListPage />} />
              <Route path="/employees/add" element={<AddEditEmployeePage />} />
              <Route path="/employees/:staffId" element={<EmployeeDetailPage />} />
              <Route path="/employees/:staffId/edit" element={<AddEditEmployeePage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/accounting" element={<AccountingPage />} />
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
