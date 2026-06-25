import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { Copy, Check, ArrowLeft, Eye, EyeOff } from "lucide-react";
import { SRI_LANKA_DISTRICTS } from "../../types/auth";
import { useSuperAdmin } from "../../contexts/SuperAdminContext";
import { functions } from "../../config/firebase";

interface RegisterPayload {
  centerName: string;
  centerPhone: string;
  address: string;
  district: string;
  ownerName: string;
  ownerPhone: string;
  plan: "basic" | "pro";
  password: string;
}

interface RegisterResult {
  success: boolean;
  centerId: string;
  ownerUid: string;
  loginEmail: string;
  password: string;
}

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#";
  let pwd = "";
  for (let i = 0; i < 12; i++) {
    pwd += chars[Math.floor(Math.random() * chars.length)];
  }
  return pwd;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="ml-2 text-gray-400 hover:text-white transition-colors"
    >
      {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
    </button>
  );
}

export default function RegisterServiceCenterPage() {
  const { superAdmin } = useSuperAdmin();
  const navigate = useNavigate();
  const [showPw, setShowPw] = useState(false);

  const [form, setForm] = useState<RegisterPayload>({
    centerName: "",
    centerPhone: "",
    address: "",
    district: "",
    ownerName: "",
    ownerPhone: "",
    plan: "basic",
    password: generatePassword(),
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RegisterResult | null>(null);

  function set(field: keyof RegisterPayload, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const fn = httpsCallable<RegisterPayload & { adminId: string; adminName: string }, RegisterResult>(
        functions,
        "registerServiceCenter"
      );
      const res = await fn({ ...form, adminId: superAdmin!.id, adminName: superAdmin!.displayName ?? "" });
      setResult(res.data);
    } catch (err: unknown) {
      const e = err as { message?: string; code?: string; details?: unknown };
      setError(e.message ?? "Registration failed.");
      console.error("registerServiceCenter error:", e);
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="p-8 max-w-lg">
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-6 mb-6">
          <h2 className="text-lg font-semibold text-green-400 mb-4">Registration successful</h2>
          <p className="text-sm text-gray-300 mb-4">Share these credentials with the service center owner.</p>

          <div className="space-y-3">
            <div className="bg-gray-900 rounded-lg px-4 py-3">
              <p className="text-xs text-gray-500 mb-1">Login Phone</p>
              <div className="flex items-center justify-between">
                <p className="text-sm font-mono text-white">
                  {"0" + result.loginEmail.split("@")[0]}
                </p>
                <CopyButton text={"0" + result.loginEmail.split("@")[0]} />
              </div>
            </div>
            <div className="bg-gray-900 rounded-lg px-4 py-3">
              <p className="text-xs text-gray-500 mb-1">Password</p>
              <div className="flex items-center justify-between">
                <p className="text-sm font-mono text-white">{result.password}</p>
                <CopyButton text={result.password} />
              </div>
            </div>
            <div className="bg-gray-900 rounded-lg px-4 py-3">
              <p className="text-xs text-gray-500 mb-1">Login URL</p>
              <div className="flex items-center justify-between">
                <p className="text-sm font-mono text-white">https://pitstopiq.web.app/login</p>
                <CopyButton text="https://pitstopiq.web.app/login" />
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => navigate(`/admin/service-centers/${result.centerId}`)}
            className="flex-1 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium py-2 rounded-lg transition-colors"
          >
            View Center
          </button>
          <button
            onClick={() => navigate("/admin/service-centers")}
            className="flex-1 bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium py-2 rounded-lg transition-colors"
          >
            Back to List
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-xl">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>

      <h1 className="text-2xl font-bold text-white mb-1">Register Service Center</h1>
      <p className="text-sm text-gray-400 mb-8">Create a new service center account and generate login credentials.</p>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {/* Center Info */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Service Center</h2>
          <div className="space-y-3">
            <Field label="Center Name" required>
              <input
                value={form.centerName}
                onChange={(e) => set("centerName", e.target.value)}
                required
                className={inputCls}
                placeholder="e.g. Perera Auto Service"
              />
            </Field>
            <Field label="Phone Number" required>
              <input
                value={form.centerPhone}
                onChange={(e) => set("centerPhone", e.target.value)}
                required
                className={inputCls}
                placeholder="07XXXXXXXX"
              />
            </Field>
            <Field label="Address" required>
              <input
                value={form.address}
                onChange={(e) => set("address", e.target.value)}
                required
                className={inputCls}
                placeholder="Street address"
              />
            </Field>
            <Field label="District" required>
              <select
                value={form.district}
                onChange={(e) => set("district", e.target.value)}
                required
                className={inputCls}
              >
                <option value="">Select district</option>
                {SRI_LANKA_DISTRICTS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </Field>
            <Field label="Plan" required>
              <select
                value={form.plan}
                onChange={(e) => set("plan", e.target.value as "basic" | "pro")}
                className={inputCls}
              >
                <option value="basic">Basic (200 SMS/month)</option>
                <option value="pro">Pro (1000 SMS/month)</option>
              </select>
            </Field>
          </div>
        </section>

        {/* Owner Info */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Owner / Login</h2>
          <div className="space-y-3">
            <Field label="Owner Full Name" required>
              <input
                value={form.ownerName}
                onChange={(e) => set("ownerName", e.target.value)}
                required
                className={inputCls}
                placeholder="Full name"
              />
            </Field>
            <Field label="Owner Phone (used as login username)" required>
              <input
                value={form.ownerPhone}
                onChange={(e) => set("ownerPhone", e.target.value)}
                required
                className={inputCls}
                placeholder="07XXXXXXXX"
              />
            </Field>
            <Field label="Initial Password" required>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => set("password", e.target.value)}
                  required
                  className={`${inputCls} pr-20`}
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="text-gray-500 hover:text-gray-300 p-1"
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => set("password", generatePassword())}
                    className="text-xs text-orange-400 hover:text-orange-300 px-1"
                  >
                    Generate
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Login email will be: {form.ownerPhone.replace(/\D/g, "").replace(/^0/, "").replace(/^94/, "") || "PHONE"}@pitstopiq.app
              </p>
            </Field>
          </div>
        </section>

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-medium text-sm py-2.5 rounded-lg transition-colors"
        >
          {submitting ? "Registering…" : "Register & Generate Credentials"}
        </button>
      </form>
    </div>
  );
}

const inputCls =
  "w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-orange-500";

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-gray-400">
        {label}
        {required && <span className="text-orange-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
