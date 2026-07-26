import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import BlockedPage from "../../pages/auth/BlockedPage";
import { ProfileRetryScreen } from "./ProfileRetryScreen";
import { LoadingScreen } from "../../components/LoadingProgress";

export function ProtectedRoute() {
  const { currentUser, loading, profileError, retryProfileLoad, centerBlocked, needsBranchSelection } = useAuth();

  // A Firestore read for the signed-in user's profile failed on the network.
  // The Firebase session is still valid, so treating this like a signed-out
  // user (and redirecting to /login) would be a silent bounce that looks like
  // a failed login. Offer a retry instead; the session is left intact.
  if (profileError) {
    return <ProfileRetryScreen onRetry={retryProfileLoad} />;
  }

  if (loading) {
    return (
      <LoadingScreen theme="light" expectedMs={2000} />
    );
  }

  if (!currentUser) return <Navigate to="/login" replace />;
  // Owner has more than one branch and hasn't picked one yet.
  if (needsBranchSelection) return <Navigate to="/select-branch" replace />;
  // The active branch's subscription is blocked — other branches (if any)
  // remain reachable from the branch selector.
  if (centerBlocked) return <BlockedPage />;
  // Signed in but onboarding never finished (e.g. Google sign-up that hasn't
  // created a service center yet) — send them to complete registration.
  if (!currentUser.centerId) return <Navigate to="/register" replace />;
  return <Outlet />;
}
