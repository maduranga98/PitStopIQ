import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  collection, doc, addDoc, updateDoc, getDoc, Timestamp,
} from "firebase/firestore";
import { ArrowLeft, LogOut, UserPlus, Save } from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import type { StaffMember, UserRole } from "../../types/auth";

// ── Constants ──────────────────────────────────────────────────────────────────
const ROLES: UserRole[] = ["Manager", "Technician", "Cashier", "Receptionist"];

// ── Helpers ────────────────────────────────────────────────────────────────────
function validatePhone(phone: string): boolean {
  return /^(07\d{8}|\+947\d{8})$/.test(phone);
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function AddEditEmployeePage() {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const { staffId } = useParams<{ staffId?: string }>();
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
  const [inviteToggle, setInviteToggle] = useState(false);
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
        <NavBar onBack={() => navigate("/employees")} onLogout={logout} currentUser={currentUser} title={isEdit ? "Edit Employee" : "Add Employee"} />
        <div className="max-w-lg mx-auto px-4 py-20 text-center">
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-8">
            <h2 className="text-xl font-bold text-white mb-2">Access Denied</h2>
            <p className="text-gray-400 text-sm">Only Owners can add or edit employees.</p>
          </div>
        </div>
      </div>
    );
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!fullName.trim() || fullName.trim().length < 2 || fullName.trim().length > 80) {
      errs.fullName = "Full name must be 2–80 characters.";
    }
    if (!phone.trim() || !validatePhone(phone.trim())) {
      errs.phone = "Enter a valid LK phone number (07XXXXXXXX or +947XXXXXXXX).";
    }
    if (inviteToggle && !email.trim()) {
      errs.email = "Email is required when 'Invite to Platform' is enabled.";
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
      const payload: Partial<StaffMember> = {
        fullName: fullName.trim(),
        phone: phone.trim(),
        role: staffRole,
        email: email.trim(),
        employeeId: employeeId.trim() || undefined,
        notes: notes.trim() || undefined,
        inviteSent: inviteToggle,
        dateJoined: dateJoined ? Timestamp.fromDate(new Date(dateJoined)) : undefined,
      };

      if (isEdit && staffId) {
        await updateDoc(doc(db, "servicecenters", centerId, "staff", staffId), payload);
      } else {
        await addDoc(collection(db, "servicecenters", centerId, "staff"), {
          ...payload,
          active: true,
          centerId,
          createdAt: Timestamp.now(),
        });
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
        <NavBar onBack={() => navigate("/employees")} onLogout={logout} currentUser={currentUser} title={isEdit ? "Edit Employee" : "Add Employee"} />
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
      <NavBar onBack={() => navigate("/employees")} onLogout={logout} currentUser={currentUser} title={isEdit ? "Edit Employee" : "Add Employee"} />

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2.5 rounded-xl bg-[#F97316]/10">
            <UserPlus className="h-5 w-5 text-[#F97316]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">{isEdit ? "Edit Employee" : "Add New Employee"}</h1>
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

          {/* Platform Invite */}
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white">Invite to Platform</h2>
                <p className="text-xs text-gray-500 mt-0.5">Allow this employee to log in to PitStop IQ</p>
              </div>
              <button
                type="button"
                onClick={() => setInviteToggle(!inviteToggle)}
                className={`relative w-11 h-6 rounded-full transition-colors ${inviteToggle ? "bg-[#F97316]" : "bg-white/10"}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${inviteToggle ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </div>

            {inviteToggle && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Email Address <span className="text-red-400">*</span></label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="employee@example.com"
                  className="w-full bg-[#0B1120] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#F97316]/50"
                />
                {errors.email && <p className="text-xs text-red-400 mt-1">{errors.email}</p>}
                <p className="text-xs text-gray-600 mt-2">Note: Invite emails require backend setup. The invite flag will be saved on the record.</p>
              </div>
            )}

            {!inviteToggle && (
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

// ── NavBar ─────────────────────────────────────────────────────────────────────
function NavBar({ onBack, onLogout, currentUser, title }: {
  onBack: () => void;
  onLogout: () => void;
  currentUser: { email: string | null; role?: string; displayName: string | null } | null;
  title: string;
}) {
  return (
    <nav className="bg-[#162032] border-b border-white/10 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <img src="/logo.png" alt="PitStop IQ" className="h-8 w-auto" />
            <span className="text-lg font-extrabold tracking-tight text-white hidden sm:block">
              PITSTOP <span className="text-[#F97316]">IQ</span>
            </span>
            <span className="text-sm text-gray-400 hidden sm:block">/ {title}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-xs text-gray-400 leading-none">{currentUser?.email}</p>
              <p className="text-xs text-[#F97316] font-medium mt-0.5">{currentUser?.role}</p>
            </div>
            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg transition"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
