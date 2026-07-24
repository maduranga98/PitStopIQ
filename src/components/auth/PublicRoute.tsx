import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { ProfileRetryScreen } from "./ProfileRetryScreen";

export function PublicRoute() {
  const { currentUser, loading, authenticating, profileError, retryProfileLoad } = useAuth();

  // A Firestore read for the signed-in user's profile failed on the network.
  // The Firebase session is still valid, so falling through to <Outlet /> would
  // show the login form again — a silent bounce that looks like a failed login.
  // Show a retry screen instead; the session is never invalidated by this.
  if (profileError) {
    return <ProfileRetryScreen onRetry={retryProfileLoad} />;
  }

  if (loading || authenticating) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <svg className="h-8 w-8 animate-spin text-[#E8272A]" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  // Only redirect away from public pages once onboarding is complete. A user
  // who signed in (e.g. via Google) but has no service center yet must stay so
  // they can finish registration.
  return currentUser && currentUser.centerId ? <Navigate to="/" replace /> : <Outlet />;
}
