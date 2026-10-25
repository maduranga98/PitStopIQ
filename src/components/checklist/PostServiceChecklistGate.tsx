import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useWorkshopModules } from "../../hooks/useWorkshopModules";
import { LoadingBlock } from "../LoadingProgress";

/** Roles that can fill in a checklist — the same three the security rules let create one. */
const CHECKLIST_ROLES = ["Owner", "Manager", "Technician"];

/** Route guard: standalone checklist pages exist only while the Pro module is on,
 *  and only for the roles that fill them in. Turning it off hides the module —
 *  it never deletes anything. */
export default function PostServiceChecklistGate() {
  const { currentUser } = useAuth();
  const { postServiceChecklistEnabled, loading } = useWorkshopModules(currentUser?.centerId);
  if (!currentUser?.centerId || loading) return <LoadingBlock />;
  const allowed = postServiceChecklistEnabled && !!currentUser.role && CHECKLIST_ROLES.includes(currentUser.role);
  return allowed ? <Outlet /> : <Navigate to="/" replace />;
}
