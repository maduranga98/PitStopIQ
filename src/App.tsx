import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { BranchProvider } from "./contexts/BranchContext";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import Layout from "./components/layout/Layout";
import { PublicRoute } from "./components/auth/PublicRoute";
import LoginPage from "./pages/auth/LoginPage";
import RegisterPage from "./pages/auth/RegisterPage";
import ForgotPasswordPage from "./pages/auth/ForgotPasswordPage";
import InviteAcceptPage from "./pages/auth/InviteAcceptPage";
import DashboardPage from "./pages/dashboard/DashboardPage";
import CustomerListPage from "./pages/customers/CustomerListPage";
import AddCustomerPage from "./pages/customers/AddCustomerPage";
import CustomerDetailPage from "./pages/customers/CustomerDetailPage";
import VehicleListPage from "./pages/vehicles/VehicleListPage";
import AddVehiclePage from "./pages/vehicles/AddVehiclePage";
import EditVehiclePage from "./pages/vehicles/EditVehiclePage";
import VehicleDetailPage from "./pages/vehicles/VehicleDetailPage";
import ServicesPage from "./pages/services/ServicesPage";
import NewServicePage from "./pages/services/NewServicePage";
import ServiceDetailPage from "./pages/services/ServiceDetailPage";
import SmsSettingsPage from "./pages/settings/SmsSettingsPage";
import SmsLogPage from "./pages/sms/SmsLogPage";
import InventoryListPage from "./pages/inventory/InventoryListPage";
import AddEditInventoryPage from "./pages/inventory/AddEditInventoryPage";
import InvoiceListPage from "./pages/invoices/InvoiceListPage";
import InvoiceDetailPage from "./pages/invoices/InvoiceDetailPage";
import EmployeeListPage from "./pages/employees/EmployeeListPage";
import AddEditEmployeePage from "./pages/employees/AddEditEmployeePage";
import EmployeeDetailPage from "./pages/employees/EmployeeDetailPage";
import AnalyticsPage from "./pages/analytics/AnalyticsPage";
import BranchesSettingsPage from "./pages/settings/branches/BranchesSettingsPage";
import SettingsPage from "./pages/settings/SettingsPage";
import PublicCustomerView from "./pages/public/PublicCustomerView";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <BranchProvider>
        <Routes>
          {/* Public customer view — no auth required */}
          <Route path="/c/:centerId/:customerId" element={<PublicCustomerView />} />

          {/* Public-only routes — redirect to dashboard if already authenticated */}
          <Route element={<PublicRoute />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/invite/:token" element={<InviteAcceptPage />} />
          </Route>

          {/* Protected routes */}
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
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
              <Route path="/sms-logs" element={<SmsLogPage />} />
              <Route path="/inventory" element={<InventoryListPage />} />
              <Route path="/inventory/add" element={<AddEditInventoryPage />} />
              <Route path="/inventory/:itemId/edit" element={<AddEditInventoryPage />} />
              <Route path="/invoices" element={<InvoiceListPage />} />
              <Route path="/invoices/:invoiceId" element={<InvoiceDetailPage />} />
              <Route path="/employees" element={<EmployeeListPage />} />
              <Route path="/employees/add" element={<AddEditEmployeePage />} />
              <Route path="/employees/:staffId" element={<EmployeeDetailPage />} />
              <Route path="/employees/:staffId/edit" element={<AddEditEmployeePage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </BranchProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
