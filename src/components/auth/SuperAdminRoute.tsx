import { Navigate, Outlet } from "react-router-dom";
import { useSuperAdmin } from "../../contexts/SuperAdminContext";
import { LoadingScreen } from "../../components/LoadingProgress";

export function SuperAdminRoute() {
  const { superAdmin, loading } = useSuperAdmin();

  if (loading) {
    return (
      <LoadingScreen expectedMs={2000} />
    );
  }

  if (!superAdmin) {
    return <Navigate to="/admin/login" replace />;
  }

  return <Outlet />;
}
