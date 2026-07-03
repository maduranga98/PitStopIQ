import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  collection, doc, getDoc, Timestamp,
} from "firebase/firestore";
import { safeAddDoc, safeUpdateDoc } from "../../lib/firestoreWrite";
import { httpsCallable } from "firebase/functions";
import { UserPlus, Save, Eye, EyeOff, RefreshCw } from "lucide-react";
import { db, functions } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type { StaffMember, UserRole } from "../../types/auth";
import { useTranslation } from "react-i18next";

// ── Constants ──────────────────────────────────────────────────────────────────
const ROLES: UserRole[] = ["Manager", "Technician", "Cashier", "Receptionist"];

// ── Helpers ────────────────────────────────────────────────────────────────────
function validatePhone(phone: string): boolean {
  return /^(07\d{8}|\+947\d{8})$/.test(phone);
}

function generatePassword(fullName: string, phone: string): string {
  const firstName = fullName.trim().split(" ")[0].toLowerCase().replace(/[^a-z]/g, "") || "staff";
  const lastFour = phone.replace(/\D/g, "").slice(-4) || "1234";
  return `${firstName}${lastFour}`;
}

function generateUsername(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  // Return as local format starting with 0
  if (digits.startsWith("94")) return `0${digits.slice(2)}`;
  if (digits.startsWith("7") && digits.length === 9) return `0${digits}`;
  return digits;
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function AddEditEmployeePage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const { staffId } = useParams<{ staffId?: string }>();
  const { t } = useTranslation();
  const isEdit = Boolean(staffId);

  const centerId = currentUser?.centerId ?? "";
  const role = currentUser?.role;

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Form state
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [staffRole, setStaffRole] = useState<UserRole>("Technician");
  const [email, setEmail] = useState("");
  const [loginEnabled, setLoginEnabled] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [dateJoined, setDateJoined] = useState("");
  const [notes, setNotes] = useState("");

  // Validation errors
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Load existing staff if editing
  useEffect(() => {
    if (!isEdit || !staffId || !centerId) return;
    getDoc(doc(db, "servicecenters", centerId, "staff", staffId)).then(snap => {
      if (snap.exists()) {
        const d = snap.data() as StaffMember;
        setFullName(d.fullName ?? "");
        setPhone(d.phone ?? "");
        setStaffRole(d.role);
        setEmail(d.email ?? "");
        setLoginEnabled(d.hasLogin ?? false);
        setEmployeeId(d.employeeId ?? "");
        if (d.dateJoined) {
          const date = d.dateJoined.toDate();
          setDateJoined(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`);
        }
        setNotes(d.notes ?? "");
      }
      setLoading(false);
    });
  }, [isEdit, staffId, centerId]);

  // Access guard
  if (role !== "Owner") {
    return (
      <div className="min-h-screen bg-[#0B1120]">

        <div className="max-w-lg mx-auto px-4 py-20 text-center">
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-8">
            <h2 className="text-xl font-bold text-white mb-2">Access Denied</h2>
            <p className="text-gray-400 text-sm">Only Owners can add or edit employees.</p>
          </div>
        </div>
      </div>
    );
  }

  function refreshPassword() {
    if (fullName || phone) {
      setGeneratedPassword(generatePassword(fullName || "staff", phone || "0700000000"));
    }
  }

  function handleLoginToggle() {
    const next = !loginEnabled;
    setLoginEnabled(next);
    if (next && !generatedPassword) {
      setGeneratedPassword(generatePassword(fullName || "staff", phone || "0700000000"));
    }
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!fullName.trim() || fullName.trim().length < 2 || fullName.trim().length > 80) {
      errs.fullName = "Full name must be 2–80 characters.";
    }
    if (!phone.trim() || !validatePhone(phone.trim())) {
      errs.phone = "Enter a valid LK phone number (07XXXXXXXX or +947XXXXXXXX).";
    }
    if (loginEnabled && !generatedPassword.trim()) {
      errs.password = "Password cannot be empty.";
    }
    if (notes.length > 500) {
      errs.notes = "Notes cannot exceed 500 characters.";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!validate()) return;

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        fullName: fullName.trim(),
        phone: phone.trim(),
        role: staffRole,
        email: email.trim(),
        hasLogin: loginEnabled,
      };
      const employeeIdTrimmed = employeeId.trim();
      if (employeeIdTrimmed) payload.employeeId = employeeIdTrimmed;
      const notesTrimmed = notes.trim();
      if (notesTrimmed) payload.notes = notesTrimmed;
      if (dateJoined) payload.dateJoined = Timestamp.fromDate(new Date(dateJoined));

      let savedStaffId = staffId;

      if (isEdit && staffId) {
        await safeUpdateDoc(doc(db, "servicecenters", centerId, "staff", staffId), payload);
      } else {
        const ref = await safeAddDoc(collection(db, "servicecenters", centerId, "staff"), {
          ...payload,
          active: true,
          centerId,
          createdAt: Timestamp.now(),
        });
        savedStaffId = ref.id;
      }

      // If login access enabled and it's a new employee (or first-time enabling), create auth account
      if (loginEnabled && !isEdit && savedStaffId) {
        try {
          const createStaffAccount = httpsCallable(functions, "createStaffAccount");
          await createStaffAccount({
            centerId,
            staffId: savedStaffId,
            phone: phone.trim(),
            fullName: fullName.trim(),
            role: staffRole,
            password: generatedPassword,
          });
        } catch (fnErr: any) {
          // Non-blocking: staff record saved, just warn about login setup
          setError(`Staff saved but login setup failed: ${fnErr.message ?? "Unknown error"}. You can retry from the employee profile.`);
          setSaving(false);
          return;
        }
      }

      navigate("/employees");
    } catch (err) {
      console.error(err);
      setError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B1120]">

        <div className="flex items-center justify-center py-20">
          <svg className="animate-spin h-8 w-8 text-[#F97316]" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120]">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2.5 rounded-xl bg-[#F97316]/10">
            <UserPlus className="h-5 w-5 text-[#F97316]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">{isEdit ? t("employees.editEmployee") : t("employees.addEmployee")}</h1>
            <p className="text-sm text-gray-500">{isEdit ? "Update employee information." : "Create a new staff member record."}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-xl">
              {error}
            </div>
          )}

          {/* Full Name */}
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-5 space-y-4">
            <h2 className="text-sm font-semibold text-white">Basic Information</h2>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Full Name <span className="text-red-400">*</span></label>
              <input
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="e.g. Kumara Perera"
                className="w-full bg-[#0B1120] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#F97316]/50"
              />
              {errors.fullName && <p className="text-xs text-red-400 mt-1">{errors.fullName}</p>}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Phone Number <span className="text-red-400">*</span></label>
              <input
                type="text"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="07XXXXXXXX or +947XXXXXXXX"
                className="w-full bg-[#0B1120] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#F97316]/50"
              />
              {errors.phone && <p className="text-xs text-red-400 mt-1">{errors.phone}</p>}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Role <span className="text-red-400">*</span></label>
              <select
                value={staffRole}
                onChange={e => setStaffRole(e.target.value as UserRole)}
                className="w-full bg-[#0B1120] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#F97316]/50"
              >
                {ROLES.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Employee ID <span className="text-gray-600">(optional)</span></label>
              <input
                type="text"
                value={employeeId}
                onChange={e => setEmployeeId(e.target.value)}
                placeholder="e.g. EMP-001"
                className="w-full bg-[#0B1120] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#F97316]/50"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Date Joined <span className="text-gray-600">(optional)</span></label>
              <input
                type="date"
                value={dateJoined}
                onChange={e => setDateJoined(e.target.value)}
                className="w-full bg-[#0B1120] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#F97316]/50"
              />
            </div>
          </div>

          {/* System Login Access */}
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white">System Login Access</h2>
                <p className="text-xs text-gray-500 mt-0.5">Allow this employee to log in to PitStop IQ. Credentials will be sent via SMS.</p>
              </div>
              <button
                type="button"
                onClick={handleLoginToggle}
                className={`relative w-11 h-6 rounded-full transition-colors ${loginEnabled ? "bg-[#F97316]" : "bg-white/10"}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${loginEnabled ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </div>

            {loginEnabled && (
              <div className="space-y-3">
                <div className="bg-[#0B1120] rounded-xl px-4 py-3 border border-white/5 space-y-1">
                  <p className="text-xs text-gray-500">Login Username (Phone Number)</p>
                  <p className="text-sm font-mono text-white">{generateUsername(phone || "07XXXXXXXX")}</p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Password</label>
                  <div className="relative flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={generatedPassword}
                        onChange={e => setGeneratedPassword(e.target.value)}
                        placeholder="Auto-generated password"
                        className="w-full bg-[#0B1120] border border-white/10 rounded-xl px-4 py-2.5 pr-10 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#F97316]/50"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(p => !p)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={refreshPassword}
                      title="Regenerate password"
                      className="bg-white/5 hover:bg-white/10 border border-white/10 px-3 rounded-xl text-gray-400 hover:text-white transition"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </button>
                  </div>
                  {errors.password && <p className="text-xs text-red-400 mt-1">{errors.password}</p>}
                  <p className="text-xs text-gray-600 mt-2">The employee will receive their username and password via SMS. They can log in using their phone number.</p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Email Address <span className="text-gray-600">(optional)</span></label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="employee@example.com"
                    className="w-full bg-[#0B1120] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#F97316]/50"
                  />
                </div>
              </div>
            )}

            {!loginEnabled && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Email Address <span className="text-gray-600">(optional)</span></label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="employee@example.com"
                  className="w-full bg-[#0B1120] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-gray-500 placeholder-gray-600 focus:outline-none focus:border-[#F97316]/50 opacity-60"
                />
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-5">
            <label className="block text-xs font-medium text-gray-400 mb-1.5">
              Notes <span className="text-gray-600">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Any additional notes about this employee…"
              className="w-full bg-[#0B1120] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#F97316]/50 resize-none"
            />
            <div className="flex justify-between items-center mt-1">
              {errors.notes && <p className="text-xs text-red-400">{errors.notes}</p>}
              <p className="text-xs text-gray-600 ml-auto">{notes.length}/500</p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => navigate("/employees")}
              className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 px-4 rounded-lg transition text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-60 text-white font-semibold py-2.5 px-4 rounded-lg transition text-sm flex items-center justify-center gap-2"
            >
              {saving ? (
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : <Save className="h-4 w-4" />}
              {saving ? "Saving…" : isEdit ? "Update Employee" : "Add Employee"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

