import { lazyWithRetry as lazy } from "../../lib/lazyWithRetry";
import { useAuth } from "../../contexts/AuthContext";

const DashboardPage = lazy(() => import("../../pages/dashboard/DashboardPage"));
const TechnicianHomePage = lazy(() => import("../../pages/dashboard/TechnicianHomePage"));

// Technicians get their assigned-jobs list as the landing page instead of the
// center dashboard — no revenue, reminders or center-wide counts.
export default function HomeRoute() {
  const { currentUser } = useAuth();
  return currentUser?.role === "Technician" ? <TechnicianHomePage /> : <DashboardPage />;
}
