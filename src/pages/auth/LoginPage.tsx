import { useState, FormEvent } from "react";
import { Link } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Card, CardContent, CardHeader } from "../../components/ui/card";

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
      await login(email, password, rememberMe);
    } catch (err: any) {
      if (err.code === "auth/invalid-credential" || err.code === "auth/wrong-password" || err.code === "auth/user-not-found") {
        setError("Invalid email or password.");
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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[#E8272A] mb-4">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">PitStopIQ</h1>
          <p className="text-sm text-gray-500 mt-1">Service Center Management</p>
        </div>

        <Card>
          <CardHeader>
            <h2 className="text-xl font-semibold text-gray-900">Welcome back</h2>
            <p className="text-sm text-gray-500 mt-1">Sign in to your account</p>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </div>

              <div>
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={e => setRememberMe(e.target.checked)}
                    className="rounded border-gray-300 text-[#E8272A] focus:ring-[#E8272A]"
                  />
                  Remember me
                </label>
                <Link to="/forgot-password" className="text-sm text-[#E8272A] hover:underline">
                  Forgot password?
                </Link>
              </div>

              <Button type="submit" className="w-full" size="lg" loading={loading}>
                Sign in
              </Button>
            </form>

            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-xs text-gray-400 bg-white px-2">
                <span className="bg-white px-2">or continue with</span>
              </div>
            </div>

            <Button variant="outline" className="w-full" size="lg" onClick={handleGoogle} loading={googleLoading}>
              <GoogleIcon />
              Sign in with Google
            </Button>

            <p className="text-center text-sm text-gray-500 mt-6">
              New service center?{" "}
              <Link to="/register" className="text-[#E8272A] hover:underline font-medium">
                Register here
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
