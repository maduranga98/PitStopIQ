import { Navigate, Outlet } from "react-router-dom";
import { ShieldOff } from "lucide-react";
import { usePermissions } from "../../contexts/PermissionsContext";

// Route-level guard. Hiding a nav link isn't enough — a role that can't use a
// section shouldn't be able to reach it by typing the URL either.
export function RequirePermission({
  anyOf,
  redirectTo,
}: {
  anyOf: string[];
  redirectTo?: string;
}) {
  const { loading, hasPermission } = usePermissions();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#F97316] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (anyOf.some(key => hasPermission(key))) return <Outlet />;
  if (redirectTo) return <Navigate to={redirectTo} replace />;

  return (
    <div className="min-h-screen bg-[#0B1120] flex items-center justify-center px-4">
      <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
        <ShieldOff className="w-10 h-10 text-gray-500 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-white mb-2">Access Denied</h2>
        <p className="text-sm text-gray-400">
          Your role doesn't have access to this section.
        </p>
      </div>
    </div>
  );
}
