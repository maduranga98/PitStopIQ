import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
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

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public-only routes — redirect to dashboard if already authenticated */}
          <Route element={<PublicRoute />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/invite/:token" element={<InviteAcceptPage />} />
          </Route>

          {/* Protected routes */}
          <Route element={<ProtectedRoute />}>
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
            <Route path="/settings/sms" element={<SmsSettingsPage />} />
            <Route path="/sms-logs" element={<SmsLogPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
