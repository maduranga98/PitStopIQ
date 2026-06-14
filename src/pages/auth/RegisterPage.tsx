import { useState, FormEvent, ChangeEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Upload, X, Check } from "lucide-react";
import { doc, setDoc, Timestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { updateProfile } from "firebase/auth";
import { auth, db, storage } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { SRI_LANKA_DISTRICTS } from "../../types/auth";

const TOTAL_STEPS = 3;

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
              done ? "bg-green-500 text-white" : active ? "bg-[#E8272A] text-white" : "bg-gray-200 text-gray-500"
            }`}>
              {done ? <Check className="h-4 w-4" /> : n}
            </div>
            <span className={`text-sm hidden sm:block ${active ? "text-gray-900 font-medium" : "text-gray-400"}`}>
              {label}
            </span>
            {i < steps.length - 1 && <div className={`h-px w-8 ${done ? "bg-green-500" : "bg-gray-200"}`} />}
          </div>
        );
      })}
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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[#E8272A] mb-4">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">PitStopIQ</h1>
          <p className="text-sm text-gray-500 mt-1">Service Center Management</p>
        </div>

        <StepIndicator current={step} />

        <Card>
          <CardHeader>
            <h2 className="text-xl font-semibold text-gray-900">{stepTitles[step - 1]}</h2>
            <p className="text-sm text-gray-500 mt-1">{stepSubtitles[step - 1]}</p>
          </CardHeader>
          <CardContent>
            {globalError && (
              <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {globalError}
              </div>
            )}

            {/* ── Step 1 ── */}
            {step === 1 && (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="reg-email">Email address</Label>
                  <Input
                    id="reg-email"
                    type="email"
                    value={step1.email}
                    onChange={e => setStep1(p => ({ ...p, email: e.target.value }))}
                    placeholder="you@example.com"
                    error={step1Errors.email}
                  />
                </div>
                <div>
                  <Label htmlFor="reg-password">Password</Label>
                  <div className="relative">
                    <Input
                      id="reg-password"
                      type={showPassword ? "text" : "password"}
                      value={step1.password}
                      onChange={e => setStep1(p => ({ ...p, password: e.target.value }))}
                      placeholder="Min 8 chars, letters + numbers"
                      error={step1Errors.password}
                    />
                    <button type="button" onClick={() => setShowPassword(p => !p)}
                      className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600">
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <Label htmlFor="reg-confirm">Confirm password</Label>
                  <div className="relative">
                    <Input
                      id="reg-confirm"
                      type={showConfirm ? "text" : "password"}
                      value={step1.confirmPassword}
                      onChange={e => setStep1(p => ({ ...p, confirmPassword: e.target.value }))}
                      placeholder="Re-enter your password"
                      error={step1Errors.confirmPassword}
                    />
                    <button type="button" onClick={() => setShowConfirm(p => !p)}
                      className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600">
                      {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <Button className="w-full" size="lg" onClick={goNext}>Next — Service Center Details</Button>
                <p className="text-center text-sm text-gray-500">
                  Already registered?{" "}
                  <Link to="/login" className="text-[#E8272A] hover:underline font-medium">Sign in</Link>
                </p>
              </div>
            )}

            {/* ── Step 2 ── */}
            {step === 2 && (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="center-name">Center name</Label>
                  <Input
                    id="center-name"
                    value={step2.centerName}
                    onChange={e => setStep2(p => ({ ...p, centerName: e.target.value }))}
                    placeholder="e.g. Silva Auto Services"
                    error={step2Errors.centerName}
                  />
                </div>
                <div>
                  <Label htmlFor="phone">Phone number</Label>
                  <Input
                    id="phone"
                    type="tel"
                    value={step2.phone}
                    onChange={e => setStep2(p => ({ ...p, phone: e.target.value }))}
                    placeholder="071-2345678 or +94712345678"
                    error={step2Errors.phone}
                  />
                </div>
                <div>
                  <Label htmlFor="address">Address</Label>
                  <Textarea
                    id="address"
                    value={step2.address}
                    onChange={e => setStep2(p => ({ ...p, address: e.target.value }))}
                    placeholder="Full street address..."
                    rows={3}
                    error={step2Errors.address}
                  />
                </div>
                <div>
                  <Label htmlFor="district">District</Label>
                  <Select
                    id="district"
                    value={step2.district}
                    onChange={e => setStep2(p => ({ ...p, district: e.target.value }))}
                    error={step2Errors.district}
                  >
                    <option value="">Select district</option>
                    {SRI_LANKA_DISTRICTS.map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>Logo (optional)</Label>
                  {logoPreview ? (
                    <div className="flex items-center gap-3 mt-1">
                      <img src={logoPreview} alt="Logo preview" className="h-16 w-16 rounded-lg object-cover border border-gray-200" />
                      <button type="button" onClick={removeLogo}
                        className="flex items-center gap-1 text-sm text-red-500 hover:text-red-700">
                        <X className="h-4 w-4" /> Remove
                      </button>
                    </div>
                  ) : (
                    <label className="mt-1 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 p-6 cursor-pointer hover:border-[#E8272A] hover:bg-red-50 transition-colors">
                      <Upload className="h-6 w-6 text-gray-400" />
                      <span className="text-sm text-gray-500">PNG, JPG, or WebP — max 2 MB</span>
                      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleLogoChange} className="sr-only" />
                    </label>
                  )}
                  {step2Errors.logo && <p className="mt-1 text-xs text-red-500">{step2Errors.logo}</p>}
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1" onClick={() => setStep(1)}>Back</Button>
                  <Button className="flex-1" size="lg" onClick={goNext}>Next — Configuration</Button>
                </div>
              </div>
            )}

            {/* ── Step 3 ── */}
            {step === 3 && (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="sms-sender">SMS Sender Name</Label>
                  <Input
                    id="sms-sender"
                    value={step3.smsSenderName}
                    onChange={e => setStep3(p => ({ ...p, smsSenderName: e.target.value }))}
                    placeholder="e.g. SilvaAuto"
                    maxLength={11}
                    error={step3Errors.smsSenderName}
                  />
                  <p className="mt-1 text-xs text-gray-400">3–11 chars, letters, numbers, hyphens. No spaces (Dialog Axiata requirement).</p>
                </div>
                <div>
                  <Label htmlFor="threshold-km">Reminder Threshold (km)</Label>
                  <Input
                    id="threshold-km"
                    type="number"
                    min={100}
                    max={2000}
                    value={step3.reminderThresholdKm}
                    onChange={e => setStep3(p => ({ ...p, reminderThresholdKm: e.target.value }))}
                    error={step3Errors.reminderThresholdKm}
                  />
                  <p className="mt-1 text-xs text-gray-400">Send service reminder when a vehicle is within this many km of its next service (100–2000).</p>
                </div>
                <div>
                  <Label htmlFor="cooldown-days">Reminder Cooldown (days)</Label>
                  <Input
                    id="cooldown-days"
                    type="number"
                    min={1}
                    max={30}
                    value={step3.reminderCooldownDays}
                    onChange={e => setStep3(p => ({ ...p, reminderCooldownDays: e.target.value }))}
                    error={step3Errors.reminderCooldownDays}
                  />
                  <p className="mt-1 text-xs text-gray-400">Minimum days before re-sending a reminder to the same vehicle (1–30).</p>
                </div>

                <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
                  <p className="text-sm text-blue-700">
                    <strong>14-day free trial</strong> — Your account starts on the Basic plan with full access.
                    No credit card required.
                  </p>
                </div>

                <div className="flex gap-3">
                  <Button type="button" variant="outline" className="flex-1" onClick={() => setStep(2)}>Back</Button>
                  <Button type="submit" className="flex-1" size="lg" loading={submitting}>
                    Create account
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
