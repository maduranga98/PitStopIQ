import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { AuthIssueScreen } from "./AuthIssueScreen";
import { LoadingScreen } from "../../components/LoadingProgress";
import { isProvisionedLoginEmail } from "../../lib/phone";

export function PublicRoute() {
  const {
    currentUser, loading, authenticating, authIssue,
    retryProfileLoad, clearAuthIssue, logout, needsBranchSelection,
  } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  if (loading || authenticating) {
    return (
      <LoadingScreen theme="light" expectedMs={2000} />
    );
  }

  // A sign-in that passed the password check but couldn't get the user into
  // the app. Falling through to <Outlet /> here would re-render the login form
  // — which is exactly what made these failures look like "I pressed Sign In
  // and nothing happened". Explain it instead.
  //
  // Only on /login: the other public pages are onboarding flows (/register,
  // /invite/:token) where a profile-less session is the expected state, and
  // interrupting them would break registration.
  if (authIssue && pathname === "/login") {
    return (
      <AuthIssueScreen
        issue={authIssue}
        accountLabel={currentUser?.email ?? null}
        onRetry={currentUser ? retryProfileLoad : undefined}
        onSignOut={async () => {
          if (currentUser) await logout();
          else clearAuthIssue();
        }}
        onRegister={
          // A phone-provisioned account can't self-register (its number is
          // already taken), so only offer this to real-email sign-ups.
          authIssue.kind === "no-profile" && currentUser && !isProvisionedLoginEmail(currentUser.email)
            ? () => navigate("/register")
            : undefined
        }
      />
    );
  }

  if (currentUser) {
    // Owner with several branches and no branch picked yet. centerId is
    // deliberately undefined in that state, so the centerId check below would
    // leave them stranded on the login form — send them to the picker.
    if (needsBranchSelection) return <Navigate to="/select-branch" replace />;
    // Only redirect away from public pages once onboarding is complete. A user
    // who signed in (e.g. via Google) but has no service center yet must stay
    // so they can finish registration.
    if (currentUser.centerId) return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
