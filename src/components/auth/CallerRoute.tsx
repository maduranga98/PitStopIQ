import { Navigate, Outlet } from "react-router-dom";
import { useCaller } from "../../contexts/CallerContext";
import { LoadingScreen } from "../../components/LoadingProgress";

export function CallerRoute() {
  const { caller, loading } = useCaller();

  if (loading) {
    return <LoadingScreen expectedMs={2000} />;
  }

  if (!caller) {
    return <Navigate to="/caller/login" replace />;
  }

  return <Outlet />;
}
