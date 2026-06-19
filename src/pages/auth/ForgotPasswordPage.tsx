import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CheckCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../contexts/AuthContext";

export default function ForgotPasswordPage() {
  const { sendReset } = useAuth();
  const { t } = useTranslation();
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
        setError(t("errors.resetEmailFailed"));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0B1120] flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-[#F97316] opacity-5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-[#F97316] opacity-5 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
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
            <h2 className="text-xl font-semibold text-white">{t("auth.resetPassword")}</h2>
            <p className="text-sm text-gray-400 mt-1">{t("auth.resetPasswordSubtitle")}</p>
          </div>
          <div className="px-8 pb-8 pt-4">
            {sent ? (
              <div className="text-center py-4">
                <CheckCircle className="mx-auto h-12 w-12 text-green-400 mb-3" />
                <h3 className="font-semibold text-white mb-1">{t("auth.checkInbox")}</h3>
                <p className="text-sm text-gray-400 mb-6">
                  If an account with <strong className="text-white">{email}</strong> exists, a password reset link has been sent. The link expires in 24 hours.
                </p>
                <Link to="/login" className="block w-full bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 px-4 rounded-lg transition text-sm text-center">
                  {t("auth.backToLogin")}
                </Link>
              </div>
            ) : (
              <>
                {error && (
                  <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
                    {error}
                  </div>
                )}
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-1.5">
                      {t("auth.email")}
                    </label>
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      required
                      className="w-full bg-[#0B1120] border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent transition"
                    />
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
                        {t("auth.sending")}
                      </>
                    ) : t("auth.sendResetEmail")}
                  </button>
                </form>
                <Link to="/login" className="flex items-center justify-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 mt-5 transition">
                  <ArrowLeft className="h-4 w-4" />
                  {t("auth.backToLogin")}
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
