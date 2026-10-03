import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import { useInspectionReportsEnabled } from "../../hooks/useInspectionReportsEnabled";
import { useInspectionReportsSettingsStore } from "../../store/inspectionReportsSlice";
import { LoadingBlock } from "../LoadingProgress";

/** Route guard: Inspection Reports pages exist only while the center's switch is
 *  on. Turning it off hides the module — it never deletes anything. */
export default function InspectionReportsGate() {
  const { currentUser } = useAuth();
  const centerId = currentUser?.centerId;
  const enabled = useInspectionReportsEnabled(centerId);
  const loaded = useInspectionReportsSettingsStore((s) => s.centerId === centerId && s.loaded);
  const canView = usePermission("inspectionReports.view");
  if (!centerId || !loaded) return <LoadingBlock />;
  // Hidden, not greyed: no module or no view permission means the pages don't exist for this user.
  return enabled && canView ? <Outlet /> : <Navigate to="/" replace />;
}
