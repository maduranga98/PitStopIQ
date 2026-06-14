import { useState, type FormEvent, type ChangeEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Upload, X, Check } from "lucide-react";
import { doc, setDoc, Timestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { SRI_LANKA_DISTRICTS } from "../../types/auth";

// ── Validation helpers ─────────────────────────────────────────────────────────
const LK_PHONE = /^(07\d-\d{7}|07\d{8}|\+947\d{8})$/;
const SMS_SENDER = /^[a-zA-Z0-9-]{3,11}$/;

function validateStep1(fields: Step1Fields) {
  const errors: Partial<Step1Fields> = {};
  if (!fields.email) errors.email = "Email is required.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) errors.email = "Enter a valid email address.";
  if (!fields.password) errors.password = "Password is required.";
  else if (fields.password.length < 8) errors.password = "Minimum 8 characters.";
  else if (!/(?=.*[a-zA-Z])(?=.*\d)/.test(fields.password)) errors.password = "Must contain at least one letter and one number.";
  if (!fields.confirmPassword) errors.confirmPassword = "Please confirm your password.";
  else if (fields.password !== fields.confirmPassword) errors.confirmPassword = "Passwords do not match.";
  return errors;
}

function validateStep2(fields: Step2Fields) {
  const errors: Partial<Record<keyof Step2Fields, string>> = {};
  if (!fields.centerName.trim()) errors.centerName = "Center name is required.";
  else if (fields.centerName.trim().length < 2 || fields.centerName.trim().length > 80)
    errors.centerName = "Must be 2–80 characters.";
  if (!fields.phone.trim()) errors.phone = "Phone number is required.";
  else if (!LK_PHONE.test(fields.phone.trim())) errors.phone = "Format: 07X-XXXXXXX or +947XXXXXXXX";
  if (!fields.address.trim()) errors.address = "Address is required.";
  else if (fields.address.trim().length < 10 || fields.address.trim().length > 200)
    errors.address = "Must be 10–200 characters.";
  if (!fields.district) errors.district = "Select a district.";
  return errors;
}

function validateStep3(fields: Step3Fields) {
  const errors: Partial<Record<keyof Step3Fields, string>> = {};
  if (!fields.smsSenderName.trim()) errors.smsSenderName = "SMS Sender Name is required.";
  else if (!SMS_SENDER.test(fields.smsSenderName.trim()))
    errors.smsSenderName = "3–11 chars, letters/numbers/hyphens only, no spaces.";
  const km = Number(fields.reminderThresholdKm);
  if (isNaN(km) || km < 100 || km > 2000) errors.reminderThresholdKm = "Must be between 100 and 2000 km.";
  const days = Number(fields.reminderCooldownDays);
  if (isNaN(days) || days < 1 || days > 30) errors.reminderCooldownDays = "Must be between 1 and 30 days.";
  return errors;
}

// ── Step types ─────────────────────────────────────────────────────────────────
interface Step1Fields { email: string; password: string; confirmPassword: string; }
interface Step2Fields { centerName: string; phone: string; address: string; district: string; logo: File | null; }
interface Step3Fields { smsSenderName: string; reminderThresholdKm: string; reminderCooldownDays: string; }

// ── Step indicator ─────────────────────────────────────────────────────────────
function StepIndicator({ current }: { current: number }) {
  const steps = ["Account", "Service Center", "Configuration"];
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {steps.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <div key={n} className="flex items-center gap-2">
            <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold transition-colors ${
              done ? "bg-green-500 text-white" : active ? "bg-[#F97316] text-white" : "bg-white/10 text-gray-500"
            }`}>
              {done ? <Check className="h-4 w-4" /> : n}
            </div>
            <span className={`text-sm hidden sm:block ${active ? "text-white font-medium" : "text-gray-500"}`}>
              {label}
            </span>
            {i < steps.length - 1 && <div className={`h-px w-8 ${done ? "bg-green-500" : "bg-white/10"}`} />}
          </div>
        );
      })}
    </div>
  );
}

// ── Dark field components ──────────────────────────────────────────────────────
function DarkInput({ label, error, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1.5">{label}</label>
      <input
        {...props}
        className={`w-full bg-[#0B1120] border rounded-lg px-4 py-2.5 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent transition ${
          error ? "border-red-500/60" : "border-white/10"
        }`}
      />
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}

function DarkTextarea({ label, error, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1.5">{label}</label>
      <textarea
        {...props}
        className={`w-full bg-[#0B1120] border rounded-lg px-4 py-2.5 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent transition resize-none ${
          error ? "border-red-500/60" : "border-white/10"
        }`}
      />
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}

function DarkSelect({ label, error, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1.5">{label}</label>
      <select
        {...props}
        className={`w-full bg-[#0B1120] border rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent transition ${
          error ? "border-red-500/60" : "border-white/10"
        }`}
      >
        {children}
      </select>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function RegisterPage() {
  const { createAccount } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState("");

  const [step1, setStep1] = useState<Step1Fields>({ email: "", password: "", confirmPassword: "" });
  const [step1Errors, setStep1Errors] = useState<Partial<Step1Fields>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [step2, setStep2] = useState<Step2Fields>({ centerName: "", phone: "", address: "", district: "", logo: null });
  const [step2Errors, setStep2Errors] = useState<Partial<Record<keyof Step2Fields, string>>>({});
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const [step3, setStep3] = useState<Step3Fields>({ smsSenderName: "", reminderThresholdKm: "500", reminderCooldownDays: "7" });
  const [step3Errors, setStep3Errors] = useState<Partial<Record<keyof Step3Fields, string>>>({});

  function goNext() {
    if (step === 1) {
      const errors = validateStep1(step1);
      setStep1Errors(errors);
      if (Object.keys(errors).length === 0) setStep(2);
    } else if (step === 2) {
      const errors = validateStep2(step2);
      setStep2Errors(errors);
      if (Object.keys(errors).length === 0) setStep(3);
    }
  }

  function handleLogoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setStep2Errors(prev => ({ ...prev, logo: "Only PNG, JPG, or WebP allowed." }));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setStep2Errors(prev => ({ ...prev, logo: "File must be under 2 MB." }));
      return;
    }
    setStep2Errors(prev => ({ ...prev, logo: undefined }));
    setStep2(prev => ({ ...prev, logo: file }));
    setLogoPreview(URL.createObjectURL(file));
  }

  function removeLogo() {
    setStep2(prev => ({ ...prev, logo: null }));
    setLogoPreview(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const errors = validateStep3(step3);
    setStep3Errors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    setGlobalError("");

    try {
      const uid = await createAccount(step1.email, step1.password);

      let logoUrl: string | undefined;
      if (step2.logo) {
        const logoRef = ref(storage, `servicecenters/${uid}/logo`);
        await uploadBytes(logoRef, step2.logo);
        logoUrl = await getDownloadURL(logoRef);
      }

      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + 14);

      await setDoc(doc(db, "servicecenters", uid), {
        name: step2.centerName.trim(),
        phone: step2.phone.trim(),
        address: step2.address.trim(),
        district: step2.district,
        logoUrl: logoUrl ?? null,
        smsSenderName: step3.smsSenderName.trim(),
        reminderThresholdKm: Number(step3.reminderThresholdKm),
        reminderCooldownDays: Number(step3.reminderCooldownDays),
        plan: "basic",
        trialEndsAt: Timestamp.fromDate(trialEndsAt),
        createdAt: Timestamp.now(),
        ownerId: uid,
      });

      await setDoc(doc(db, "servicecenters", uid, "staff", uid), {
        email: step1.email,
        role: "Owner",
        centerId: uid,
        active: true,
        createdAt: Timestamp.now(),
      });

      navigate("/");
    } catch (err: any) {
      if (err.code === "auth/email-already-in-use") {
        setGlobalError("An account with this email already exists.");
        setStep(1);
      } else {
        setGlobalError("Registration failed. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const stepTitles = ["Create your account", "Service center details", "Configure defaults"];
  const stepSubtitles = [
    "Set up your login credentials",
    "Tell us about your service center",
    "Set up SMS reminders and thresholds",
  ];

  return (
    <div className="min-h-screen bg-[#0B1120] flex items-center justify-center p-4">
      {/* Background accent */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-[#F97316] opacity-5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-[#F97316] opacity-5 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-lg relative z-10">
        {/* Logo / Brand */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center mb-4">
            <img src="/logo.png" alt="PitStop IQ Logo" className="h-14 w-auto" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white">
            PITSTOP <span className="text-[#F97316]">IQ</span>
          </h1>
          <p className="text-sm text-gray-400 mt-1 tracking-wide">Service Intelligence</p>
        </div>

        <StepIndicator current={step} />

        <div className="bg-[#162032] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
          <div className="px-8 pt-8 pb-2">
            <h2 className="text-xl font-semibold text-white">{stepTitles[step - 1]}</h2>
            <p className="text-sm text-gray-400 mt-1">{stepSubtitles[step - 1]}</p>
          </div>
          <div className="px-8 pb-8 pt-4">
            {globalError && (
              <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
                {globalError}
              </div>
            )}

            {/* ── Step 1 ── */}
            {step === 1 && (
              <div className="space-y-4">
                <DarkInput
                  label="Email address"
                  id="reg-email"
                  type="email"
                  value={step1.email}
                  onChange={e => setStep1(p => ({ ...p, email: e.target.value }))}
                  placeholder="you@example.com"
                  error={step1Errors.email}
                />
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Password</label>
                  <div className="relative">
                    <input
                      id="reg-password"
                      type={showPassword ? "text" : "password"}
                      value={step1.password}
                      onChange={e => setStep1(p => ({ ...p, password: e.target.value }))}
                      placeholder="Min 8 chars, letters + numbers"
                      className={`w-full bg-[#0B1120] border rounded-lg px-4 py-2.5 pr-10 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent transition ${step1Errors.password ? "border-red-500/60" : "border-white/10"}`}
                    />
                    <button type="button" onClick={() => setShowPassword(p => !p)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition">
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {step1Errors.password && <p className="mt-1 text-xs text-red-400">{step1Errors.password}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Confirm password</label>
                  <div className="relative">
                    <input
                      id="reg-confirm"
                      type={showConfirm ? "text" : "password"}
                      value={step1.confirmPassword}
                      onChange={e => setStep1(p => ({ ...p, confirmPassword: e.target.value }))}
                      placeholder="Re-enter your password"
                      className={`w-full bg-[#0B1120] border rounded-lg px-4 py-2.5 pr-10 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent transition ${step1Errors.confirmPassword ? "border-red-500/60" : "border-white/10"}`}
                    />
                    <button type="button" onClick={() => setShowConfirm(p => !p)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition">
                      {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {step1Errors.confirmPassword && <p className="mt-1 text-xs text-red-400">{step1Errors.confirmPassword}</p>}
                </div>
                <button
                  type="button"
                  onClick={goNext}
                  className="w-full bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold py-2.5 px-4 rounded-lg transition text-sm mt-2"
                >
                  Next — Service Center Details
                </button>
                <p className="text-center text-sm text-gray-500">
                  Already registered?{" "}
                  <Link to="/login" className="text-[#F97316] hover:text-[#fb923c] font-medium transition">Sign in</Link>
                </p>
              </div>
            )}

            {/* ── Step 2 ── */}
            {step === 2 && (
              <div className="space-y-4">
                <DarkInput
                  label="Center name"
                  id="center-name"
                  value={step2.centerName}
                  onChange={e => setStep2(p => ({ ...p, centerName: e.target.value }))}
                  placeholder="e.g. Silva Auto Services"
                  error={step2Errors.centerName}
                />
                <DarkInput
                  label="Phone number"
                  id="phone"
                  type="tel"
                  value={step2.phone}
                  onChange={e => setStep2(p => ({ ...p, phone: e.target.value }))}
                  placeholder="071-2345678 or +94712345678"
                  error={step2Errors.phone}
                />
                <DarkTextarea
                  label="Address"
                  id="address"
                  value={step2.address}
                  onChange={e => setStep2(p => ({ ...p, address: e.target.value }))}
                  placeholder="Full street address..."
                  rows={3}
                  error={step2Errors.address}
                />
                <DarkSelect
                  label="District"
                  id="district"
                  value={step2.district}
                  onChange={e => setStep2(p => ({ ...p, district: e.target.value }))}
                  error={step2Errors.district}
                >
                  <option value="">Select district</option>
                  {SRI_LANKA_DISTRICTS.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </DarkSelect>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Logo (optional)</label>
                  {logoPreview ? (
                    <div className="flex items-center gap-3 mt-1">
                      <img src={logoPreview} alt="Logo preview" className="h-16 w-16 rounded-lg object-cover border border-white/10" />
                      <button type="button" onClick={removeLogo}
                        className="flex items-center gap-1 text-sm text-red-400 hover:text-red-300 transition">
                        <X className="h-4 w-4" /> Remove
                      </button>
                    </div>
                  ) : (
                    <label className="mt-1 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-white/10 p-6 cursor-pointer hover:border-[#F97316]/50 hover:bg-[#F97316]/5 transition-colors">
                      <Upload className="h-6 w-6 text-gray-500" />
                      <span className="text-sm text-gray-500">PNG, JPG, or WebP — max 2 MB</span>
                      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleLogoChange} className="sr-only" />
                    </label>
                  )}
                  {step2Errors.logo && <p className="mt-1 text-xs text-red-400">{step2Errors.logo}</p>}
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 px-4 rounded-lg transition text-sm"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={goNext}
                    className="flex-1 bg-[#F97316] hover:bg-[#ea6c0f] text-white font-semibold py-2.5 px-4 rounded-lg transition text-sm"
                  >
                    Next — Configuration
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 3 ── */}
            {step === 3 && (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <DarkInput
                    label="SMS Sender Name"
                    id="sms-sender"
                    value={step3.smsSenderName}
                    onChange={e => setStep3(p => ({ ...p, smsSenderName: e.target.value }))}
                    placeholder="e.g. SilvaAuto"
                    maxLength={11}
                    error={step3Errors.smsSenderName}
                  />
                  <p className="mt-1 text-xs text-gray-500">3–11 chars, letters, numbers, hyphens. No spaces (Dialog Axiata requirement).</p>
                </div>
                <div>
                  <DarkInput
                    label="Reminder Threshold (km)"
                    id="threshold-km"
                    type="number"
                    min={100}
                    max={2000}
                    value={step3.reminderThresholdKm}
                    onChange={e => setStep3(p => ({ ...p, reminderThresholdKm: e.target.value }))}
                    error={step3Errors.reminderThresholdKm}
                  />
                  <p className="mt-1 text-xs text-gray-500">Send service reminder when a vehicle is within this many km of its next service (100–2000).</p>
                </div>
                <div>
                  <DarkInput
                    label="Reminder Cooldown (days)"
                    id="cooldown-days"
                    type="number"
                    min={1}
                    max={30}
                    value={step3.reminderCooldownDays}
                    onChange={e => setStep3(p => ({ ...p, reminderCooldownDays: e.target.value }))}
                    error={step3Errors.reminderCooldownDays}
                  />
                  <p className="mt-1 text-xs text-gray-500">Minimum days before re-sending a reminder to the same vehicle (1–30).</p>
                </div>

                <div className="rounded-lg bg-[#F97316]/10 border border-[#F97316]/20 px-4 py-3">
                  <p className="text-sm text-[#fb923c]">
                    <strong>14-day free trial</strong> — Your account starts on the Basic plan with full access.
                    No credit card required.
                  </p>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 px-4 rounded-lg transition text-sm"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-60 text-white font-semibold py-2.5 px-4 rounded-lg transition text-sm flex items-center justify-center gap-2"
                  >
                    {submitting ? (
                      <>
                        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Creating account…
                      </>
                    ) : "Create account"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
