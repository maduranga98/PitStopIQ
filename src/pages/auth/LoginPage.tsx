import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Eye, EyeOff, Wrench, BarChart3, MessageSquare, Calculator } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";

function normalizeLoginInput(input: string): string {
  const trimmed = input.trim();
  // If it looks like a Sri Lankan phone number, convert to internal email format
  if (/^(\+94|94|0)7\d{8}$/.test(trimmed.replace(/[\s-]/g, ""))) {
    const digits = trimmed.replace(/[\s\-()+]/g, "");
    const normalized = digits.startsWith("94") ? digits.slice(2) : digits.startsWith("0") ? digits.slice(1) : digits;
    return `${normalized}@pitstopiq.app`;
  }
  return trimmed;
}

function GoogleIcon() {
  return (
    <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

export default function LoginPage() {
  const { login, loginWithGoogle } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(normalizeLoginInput(email), password, rememberMe);
    } catch (err: any) {
      if (err.code === "auth/invalid-credential" || err.code === "auth/wrong-password" || err.code === "auth/user-not-found") {
        setError("Invalid credentials. Please check your phone/email and password.");
      } else if (err.code === "auth/too-many-requests") {
        setError("Too many attempts. Please try again later.");
      } else {
        setError("An error occurred. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError("");
    setGoogleLoading(true);
    try {
      await loginWithGoogle();
    } catch {
      setError("Google sign-in failed. Please try again.");
    } finally {
      setGoogleLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0B1120] flex flex-col lg:flex-row">
      {/* Hero / Brand panel */}
      <div className="relative hidden lg:flex flex-1 bg-gradient-to-br from-[#0B1120] via-[#10182a] to-[#1a0f05] p-12 flex-col justify-between overflow-hidden">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-[#F97316] opacity-20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-[28rem] h-[28rem] bg-[#F97316] opacity-10 rounded-full blur-3xl" />

        <div className="relative z-10 flex items-center gap-3">
          <img src="/logo.png" alt="PitStop IQ" className="h-10 w-auto" onError={(e) => (e.currentTarget.style.display = "none")} />
          <span className="text-2xl font-extrabold tracking-tight text-white">
            PITSTOP <span className="text-[#F97316]">IQ</span>
          </span>
        </div>

        <div className="relative z-10 max-w-md">
          <h2 className="text-4xl font-extrabold text-white leading-tight mb-3">
            Run your service center with <span className="text-[#F97316]">intelligence</span>.
          </h2>
          <p className="text-gray-400 mb-8">
            From job cards to invoicing, SMS notifications to a full in-app accountant — PitStop IQ is built for Sri Lankan auto service centers.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <Feature icon={<Wrench className="h-4 w-4" />} title="Smart Job Cards" desc="Track every service end-to-end" />
            <Feature icon={<MessageSquare className="h-4 w-4" />} title="Customer SMS" desc="Auto reminders & invoices" />
            <Feature icon={<BarChart3 className="h-4 w-4" />} title="Real-time Reports" desc="Revenue, services, fleet" />
            <Feature icon={<Calculator className="h-4 w-4" />} title="Built-in Accounting" desc="Track P&L without spreadsheets" />
          </div>
        </div>

        <div className="relative z-10 text-xs text-gray-500">
          © {new Date().getFullYear()} PitStop IQ · A product of{" "}
          <a href="https://www.lumoraventures.com/" target="_blank" rel="noreferrer" className="hover:text-gray-300 transition">
            Lumora Ventures PVT LTD
          </a>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-8 relative">
        <div className="absolute inset-0 overflow-hidden pointer-events-none lg:hidden">
          <div className="absolute -top-40 -right-40 w-96 h-96 bg-[#F97316] opacity-5 rounded-full blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-[#F97316] opacity-5 rounded-full blur-3xl" />
        </div>
        <div className="w-full max-w-md relative z-10">
        {/* Logo / Brand (mobile only) */}
        <div className="text-center mb-8 lg:hidden">
          <div className="inline-flex items-center justify-center mb-4">
            <img src="/logo.png" alt="PitStop IQ Logo" className="h-16 w-auto" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white">
            PITSTOP <span className="text-[#F97316]">IQ</span>
          </h1>
          <p className="text-sm text-gray-400 mt-1 tracking-wide">Service Intelligence</p>
        </div>

        <div className="bg-[#162032] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
          <div className="px-8 pt-8 pb-2">
            <h2 className="text-xl font-semibold text-white">Welcome back</h2>
            <p className="text-sm text-gray-400 mt-1">Sign in to your account</p>
          </div>
          <div className="px-8 pb-8 pt-4">
            {error && (
              <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-1.5">
                  Email or Phone Number
                </label>
                <input
                  id="email"
                  type="text"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com or 07XXXXXXXX"
                  autoComplete="username"
                  required
                  className="w-full bg-[#0B1120] border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent transition"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    required
                    className="w-full bg-[#0B1120] border border-white/10 rounded-lg px-4 py-2.5 pr-10 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={e => setRememberMe(e.target.checked)}
                    className="rounded border-white/20 bg-[#0B1120] text-[#F97316] focus:ring-[#F97316]"
                  />
                  Remember me
                </label>
                <Link to="/forgot-password" className="text-sm text-[#F97316] hover:text-[#fb923c] transition">
                  Forgot password?
                </Link>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-60 text-white font-semibold py-2.5 px-4 rounded-lg transition text-sm flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Signing in…
                  </>
                ) : "Sign in"}
              </button>
            </form>

            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/10" />
              </div>
              <div className="relative flex justify-center text-xs text-gray-500">
                <span className="bg-[#162032] px-3">or continue with</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleGoogle}
              disabled={googleLoading}
              className="w-full bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-60 text-white font-medium py-2.5 px-4 rounded-lg transition text-sm flex items-center justify-center"
            >
              {googleLoading ? (
                <svg className="animate-spin h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : <GoogleIcon />}
              Sign in with Google
            </button>

            <p className="text-center text-sm text-gray-500 mt-6">
              New service center?{" "}
              <Link to="/register" className="text-[#F97316] hover:text-[#fb923c] font-medium transition">
                Register here
              </Link>
            </p>

            <div className="mt-6 pt-5 border-t border-white/10 text-center">
              <p className="text-xs text-gray-600">
                A product of{" "}
                <a
                  href="https://www.lumoraventures.com/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-gray-500 hover:text-gray-300 transition"
                >
                  Lumora Ventures PVT LTD
                </a>
              </p>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
      <div className="w-7 h-7 rounded-lg bg-[#F97316]/15 text-[#F97316] flex items-center justify-center mb-2">
        {icon}
      </div>
      <div className="text-sm font-semibold text-white">{title}</div>
      <div className="text-xs text-gray-400">{desc}</div>
    </div>
  );
}
