import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import BlockedPage from "../../pages/auth/BlockedPage";
import { ProfileRetryScreen } from "./ProfileRetryScreen";

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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <svg className="h-8 w-8 animate-spin text-[#E8272A]" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
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
