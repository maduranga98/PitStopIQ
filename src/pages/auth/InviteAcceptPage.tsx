import { useState, useEffect, type FormEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Eye, EyeOff, AlertTriangle, CheckCircle, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  doc, getDoc, Timestamp,
} from "firebase/firestore";
import { safeDeleteDoc, safeSetDoc } from "../../lib/firestoreWrite";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { auth, db } from "../../config/firebase";
import type { PendingInvite } from "../../types/auth";

export default function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [invite, setInvite] = useState<PendingInvite | null>(null);
  const [loadingInvite, setLoadingInvite] = useState(true);
  const [expired, setExpired] = useState(false);
  const [invalid, setInvalid] = useState(false);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) { setInvalid(true); setLoadingInvite(false); return; }

    async function loadInvite() {
      try {
        const snap = await getDoc(doc(db, "invites", token!));
        if (!snap.exists()) { setInvalid(true); return; }
        const data = snap.data() as PendingInvite & { expiresAt: { toDate(): Date } };
        if (new Date() > data.expiresAt.toDate()) { setExpired(true); return; }
        setInvite({ ...data, id: snap.id });
      } catch {
        setInvalid(true);
      } finally {
        setLoadingInvite(false);
      }
    }
    loadInvite();
  }, [token]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    let valid = true;
    setPasswordError("");
    setConfirmError("");

    if (password.length < 8 || !/(?=.*[a-zA-Z])(?=.*\d)/.test(password)) {
      setPasswordError(t("errors.passwordTooWeak"));
      valid = false;
    }
    if (password !== confirmPassword) {
      setConfirmError(t("errors.passwordMismatch"));
      valid = false;
    }
    if (!valid || !invite) return;

    setSubmitting(true);
    setError("");
    try {
      const credential = await createUserWithEmailAndPassword(auth, invite.email, password);

      await safeSetDoc(doc(db, "servicecenters", invite.centerId, "staff", credential.user.uid), {
        email: invite.email,
        role: invite.role,
        centerId: invite.centerId,
        active: true,
        createdAt: Timestamp.now(),
      });

      await safeSetDoc(doc(db, "users", credential.user.uid), {
        email: invite.email,
        role: invite.role,
        centerId: invite.centerId,
        createdAt: Timestamp.now(),
      });

      await safeDeleteDoc(doc(db, "invites", invite.id));

      navigate("/");
    } catch (err: any) {
      if (err.code === "auth/email-already-in-use") {
        setError(t("errors.emailAlreadyInUse"));
      } else {
        setError(t("errors.serverError"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingInvite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0B1120]">
        <Loader2 className="h-8 w-8 animate-spin text-[#F97316]" />
      </div>
    );
  }

  const isError = invalid || expired;

  return (
    <div className="min-h-screen bg-[#0B1120] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-2">
            <img
              src="/logo.png"
              alt="PitStop IQ"
              className="h-10 w-auto"
              onError={(e) => (e.currentTarget.style.display = "none")}
            />
            <span className="text-2xl font-extrabold tracking-tight text-white">
              PITSTOP <span className="text-[#F97316]">IQ</span>
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">Service Center Management</p>
        </div>

        <div className="bg-[#162032] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="px-6 pt-6 pb-5 border-b border-white/5">
            {isError ? (
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 bg-amber-500/10 rounded-lg flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="h-5 w-5 text-amber-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    {expired ? t("auth.inviteExpired") : t("auth.invalidInvite")}
                  </h2>
                  <p className="text-sm text-gray-400 mt-1">
                    {expired ? t("auth.inviteExpiredDesc") : t("auth.invalidInviteDesc")}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 bg-[#F97316]/10 rounded-lg flex items-center justify-center flex-shrink-0">
                  <CheckCircle className="h-5 w-5 text-[#F97316]" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">{t("auth.inviteTitle")}</h2>
                  <p className="text-sm text-gray-400 mt-1">
                    Join as <span className="text-[#F97316] font-medium">{invite?.role}</span> using{" "}
                    <span className="text-white font-medium">{invite?.email}</span>
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Form */}
          {!isError && (
            <div className="px-6 py-5">
              {error && (
                <div className="mb-4 flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-400">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-xs text-gray-400 block mb-1.5">{t("auth.email")}</label>
                  <input
                    value={invite?.email ?? ""}
                    disabled
                    className="w-full bg-white/5 border border-white/10 text-gray-400 rounded-lg px-3 py-2.5 text-sm cursor-not-allowed"
                  />
                </div>

                <div>
                  <label htmlFor="inv-password" className="text-xs text-gray-400 block mb-1.5">
                    {t("auth.password")}
                  </label>
                  <div className="relative">
                    <input
                      id="inv-password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={e => { setPassword(e.target.value); setPasswordError(""); }}
                      placeholder="Min 8 chars, letters + numbers"
                      className={`w-full bg-white/5 border text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#F97316] pr-10 ${
                        passwordError ? "border-red-500" : "border-white/10"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(p => !p)}
                      className="absolute right-3 top-2.5 text-gray-500 hover:text-gray-300 transition"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {passwordError && (
                    <p className="flex items-center gap-1 mt-1 text-xs text-red-400">
                      <AlertTriangle className="h-3 w-3 flex-shrink-0" /> {passwordError}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="inv-confirm" className="text-xs text-gray-400 block mb-1.5">
                    {t("auth.confirmPassword")}
                  </label>
                  <input
                    id="inv-confirm"
                    type="password"
                    value={confirmPassword}
                    onChange={e => { setConfirmPassword(e.target.value); setConfirmError(""); }}
                    placeholder="Re-enter your password"
                    className={`w-full bg-white/5 border text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#F97316] ${
                      confirmError ? "border-red-500" : "border-white/10"
                    }`}
                  />
                  {confirmError && (
                    <p className="flex items-center gap-1 mt-1 text-xs text-red-400">
                      <AlertTriangle className="h-3 w-3 flex-shrink-0" /> {confirmError}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition text-sm flex items-center justify-center gap-2 mt-2"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {submitting ? t("auth.creatingAccount") : t("auth.acceptInvite")}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
