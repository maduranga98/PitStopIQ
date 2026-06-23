import { Navigate, Outlet } from "react-router-dom";
import { useSuperAdmin } from "../../contexts/SuperAdminContext";

export function SuperAdminRoute() {
  const { superAdmin, loading } = useSuperAdmin();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
      </div>
    );
  }

  if (!superAdmin) {
    return <Navigate to="/admin/login" replace />;
  }

  return <Outlet />;
}
