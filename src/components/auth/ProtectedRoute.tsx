import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import BlockedPage from "../../pages/auth/BlockedPage";
import { AuthIssueScreen } from "./AuthIssueScreen";
import { isProvisionedLoginEmail } from "../../lib/phone";

export function ProtectedRoute() {
  const {
    currentUser, loading, authIssue, retryProfileLoad, logout,
    centerBlocked, needsBranchSelection,
  } = useAuth();

  // The signed-in user's profile couldn't be resolved (a read failed on the
  // network, the account was never provisioned, or resolution threw). The
  // Firebase session may well still be valid, so treating this like a
  // signed-out user and redirecting to /login would be a silent bounce that
  // looks like a failed login. Say what happened instead.
  if (authIssue) {
    return (
      <AuthIssueScreen
        issue={authIssue}
        accountLabel={currentUser?.email ?? null}
        onRetry={currentUser ? retryProfileLoad : undefined}
        onSignOut={logout}
      />
    );
  }

  // Auth is still resolving. Render the route anyway so Layout paints the
  // shell (sidebar frame, banners) on the first frame instead of the whole
  // page waiting on the profile chain — Layout holds its own <Outlet /> back
  // and shows the loader in the content area until `loading` clears, so no
  // page mounts against a null user. Every redirect below still runs, just
  // once there is something to decide on.
  if (loading) return <Outlet />;

  if (!currentUser) return <Navigate to="/login" replace />;
  // Owner has more than one branch and hasn't picked one yet.
  if (needsBranchSelection) return <Navigate to="/select-branch" replace />;
  // The active branch's subscription is blocked — other branches (if any)
  // remain reachable from the branch selector.
  if (centerBlocked) return <BlockedPage />;
  if (!currentUser.centerId) {
    // A phone-provisioned account (super admin registration, staff invite)
    // can never complete registration itself — its number is already taken —
    // so sending it to /register would just loop. That case is an unfinished
    // provisioning and belongs on the issue screen.
    if (isProvisionedLoginEmail(currentUser.email)) {
      return (
        <AuthIssueScreen
          issue={{ kind: "no-profile" }}
          accountLabel={currentUser.email}
          onRetry={retryProfileLoad}
          onSignOut={logout}
        />
      );
    }
    // Signed in but onboarding never finished (e.g. Google sign-up that hasn't
    // created a service center yet) — send them to complete registration.
    return <Navigate to="/register" replace />;
  }
  return <Outlet />;
}
