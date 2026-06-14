import { useState, useEffect, FormEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Eye, EyeOff, AlertTriangle } from "lucide-react";
import {
  doc, getDoc, deleteDoc, setDoc, Timestamp,
} from "firebase/firestore";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { auth, db } from "../../config/firebase";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import type { PendingInvite } from "../../types/auth";

export default function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

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
        const data = snap.data() as PendingInvite;
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
      setPasswordError("Min 8 characters with at least one letter and one number.");
      valid = false;
    }
    if (password !== confirmPassword) {
      setConfirmError("Passwords do not match.");
      valid = false;
    }
    if (!valid || !invite) return;

    setSubmitting(true);
    setError("");
    try {
      const credential = await createUserWithEmailAndPassword(auth, invite.email, password);

      await setDoc(doc(db, "servicecenters", invite.centerId, "staff", credential.user.uid), {
        email: invite.email,
        role: invite.role,
        centerId: invite.centerId,
        active: true,
        createdAt: Timestamp.now(),
      });

      await deleteDoc(doc(db, "invites", invite.id));

      navigate("/");
    } catch (err: any) {
      if (err.code === "auth/email-already-in-use") {
        setError("An account with this email already exists. Please sign in instead.");
      } else {
        setError("Failed to create account. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingInvite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <svg className="h-8 w-8 animate-spin text-[#E8272A]" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  const isError = invalid || expired;

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
            {isError ? (
              <>
                <div className="flex items-center gap-2 text-amber-600 mb-1">
                  <AlertTriangle className="h-5 w-5" />
                  <h2 className="text-xl font-semibold">{expired ? "Invite expired" : "Invalid invite"}</h2>
                </div>
                <p className="text-sm text-gray-500">
                  {expired
                    ? "This invite link has expired (72-hour limit). Ask your manager to resend it."
                    : "This invite link is invalid or has already been used."}
                </p>
              </>
            ) : (
              <>
                <h2 className="text-xl font-semibold text-gray-900">You've been invited!</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Set your password to join as <strong>{invite?.role}</strong> at{" "}
                  <strong>{invite?.email}</strong>.
                </p>
              </>
            )}
          </CardHeader>
          {!isError && (
            <CardContent>
              {error && (
                <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label>Email</Label>
                  <Input value={invite?.email ?? ""} disabled />
                </div>
                <div>
                  <Label htmlFor="inv-password">Password</Label>
                  <div className="relative">
                    <Input
                      id="inv-password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Min 8 chars, letters + numbers"
                      error={passwordError}
                    />
                    <button type="button" onClick={() => setShowPassword(p => !p)}
                      className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600">
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <Label htmlFor="inv-confirm">Confirm password</Label>
                  <Input
                    id="inv-confirm"
                    type="password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter your password"
                    error={confirmError}
                  />
                </div>
                <Button type="submit" className="w-full" size="lg" loading={submitting}>
                  Create account & join
                </Button>
              </form>
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
