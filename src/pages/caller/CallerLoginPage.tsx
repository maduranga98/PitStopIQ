import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { PhoneCall, Eye, EyeOff } from "lucide-react";
import { useCaller } from "../../contexts/CallerContext";
import { DEACTIVATED_MESSAGE, callerLoginErrorMessage } from "../../lib/callerAuth";

const inputClass =
  "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-orange-500";

export default function CallerLoginPage() {
  const { login, resetPassword, caller, loading, notice, clearNotice } = useCaller();

  const [mode, setMode] = useState<"signin" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
      </div>
    );
  }

  // Already signed in as a caller — straight to the board.
  if (caller) {
    return <Navigate to="/caller" replace />;
  }

  function switchMode(next: "signin" | "reset") {
    setMode(next);
    setError("");
    setInfo("");
    clearNotice();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");
    setSubmitting(true);
    try {
      if (mode === "signin") {
        await login(email, password);
        // CallerContext resolves the caller; the Navigate above takes over.
      } else {
        await resetPassword(email);
        setInfo("If that email has an account, a reset link is on its way.");
      }
    } catch (err) {
      setError(
        mode === "signin" ? callerLoginErrorMessage(err) : "Couldn't send the reset link. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const banner = error || (notice === "deactivated" ? DEACTIVATED_MESSAGE : "");

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-orange-500 flex items-center justify-center mb-3">
            <PhoneCall className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-xl font-bold text-white">My Leads</h1>
          <p className="text-sm text-gray-400 mt-1">PitStop IQ Sales</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
          {banner && (
            <div role="alert" className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
              {banner}
            </div>
          )}
          {info && (
            <div role="status" className="text-sm text-green-400 bg-green-900/20 border border-green-800 rounded-lg px-3 py-2">
              {info}
            </div>
          )}

          {mode === "reset" && (
            <p className="text-sm text-gray-400">Enter your email and we'll send you a link to set a new password.</p>
          )}

          <div className="space-y-1">
            <label htmlFor="caller-email" className="text-xs font-medium text-gray-400">Email</label>
            <input
              id="caller-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
              className={inputClass}
              placeholder="you@example.com"
            />
          </div>

          {mode === "signin" && (
            <div className="space-y-1">
              <label htmlFor="caller-password" className="text-xs font-medium text-gray-400">Password</label>
              <div className="relative">
                <input
                  id="caller-password"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className={`${inputClass} pr-10`}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-medium text-sm py-2 rounded-lg transition-colors"
          >
            {mode === "signin"
              ? (submitting ? "Signing in…" : "Sign in")
              : (submitting ? "Sending…" : "Send reset link")}
          </button>

          <button
            type="button"
            onClick={() => switchMode(mode === "signin" ? "reset" : "signin")}
            className="w-full text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            {mode === "signin" ? "Forgot password?" : "Back to sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
