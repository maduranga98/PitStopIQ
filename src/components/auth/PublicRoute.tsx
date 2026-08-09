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

  // Only the initial auth resolution replaces the page outright — at that point
  // there is no form on screen to preserve.
  //
  // `authenticating` is deliberately NOT part of this check. Swapping the
  // <Outlet /> for the loading screen unmounts the login form, and a form that
  // unmounts loses its local state — including the error message its submit
  // handler is about to set. Every rejected password therefore rendered into a
  // dead component and the remounted form came back blank, which is why sign-in
  // failures showed nothing at all. The in-flight state is shown as an overlay
  // below instead, so the form survives the round trip.
  if (loading) {
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

  return (
    <>
      <Outlet />
      {/* Covers the form while a sign-in is in flight without unmounting it, so
          a rejection lands on a live component that can render the reason. */}
      {authenticating && (
        <div className="fixed inset-0 z-50" aria-busy="true">
          <LoadingScreen theme="light" expectedMs={2000} />
        </div>
      )}
    </>
  );
}
