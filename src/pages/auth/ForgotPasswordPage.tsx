import { useState, FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CheckCircle } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Card, CardContent, CardHeader } from "../../components/ui/card";

export default function ForgotPasswordPage() {
  const { sendReset } = useAuth();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await sendReset(email);
      setSent(true);
    } catch (err: any) {
      if (err.code === "auth/user-not-found") {
        setSent(true);
      } else {
        setError("Failed to send reset email. Please try again.");
      }
    } finally {
      setLoading(false);
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
        </div>

        <Card>
          <CardHeader>
            <h2 className="text-xl font-semibold text-gray-900">Reset your password</h2>
            <p className="text-sm text-gray-500 mt-1">
              Enter your email and we'll send you a reset link.
            </p>
          </CardHeader>
          <CardContent>
            {sent ? (
              <div className="text-center py-4">
                <CheckCircle className="mx-auto h-12 w-12 text-green-500 mb-3" />
                <h3 className="font-semibold text-gray-900 mb-1">Check your inbox</h3>
                <p className="text-sm text-gray-500 mb-6">
                  If an account with <strong>{email}</strong> exists, a password reset link has been sent. The link expires in 24 hours.
                </p>
                <Link to="/login">
                  <Button variant="outline" className="w-full">Back to sign in</Button>
                </Link>
              </div>
            ) : (
              <>
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
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full" size="lg" loading={loading}>
                    Send reset link
                  </Button>
                </form>
                <Link to="/login" className="flex items-center justify-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mt-4">
                  <ArrowLeft className="h-4 w-4" />
                  Back to sign in
                </Link>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
