import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
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
  if (!centerId || !loaded) return <LoadingBlock />;
  return enabled ? <Outlet /> : <Navigate to="/" replace />;
}
