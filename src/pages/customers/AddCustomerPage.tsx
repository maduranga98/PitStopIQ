import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection, query, where, getDocs, addDoc, Timestamp,
} from "firebase/firestore";
import { UserPlus, ArrowLeft, AlertCircle, ExternalLink } from "lucide-react";
import { db } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";

// Normalise Sri Lanka phone → +94XXXXXXXXX or return null if invalid
function normaliseLKPhone(raw: string): string | null {
  const s = raw.replace(/[\s\-()]/g, "");
  if (/^\+94\d{9}$/.test(s)) return s;
  if (/^0\d{9}$/.test(s)) return "+94" + s.slice(1);
  if (/^94\d{9}$/.test(s)) return "+" + s;
  return null;
}

function formatPhoneDisplay(phone: string) {
  if (phone.startsWith("+94") && phone.length === 12) {
    const local = "0" + phone.slice(3);
    return local.slice(0, 3) + " " + local.slice(3, 6) + " " + local.slice(6);
  }
  return phone;
}

interface DuplicateInfo {
  id: string;
  name: string;
  phone: string;
}

export default function AddCustomerPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();


  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [smsLanguage, setSmsLanguage] = useState<"sinhala" | "tamil" | "english">("english");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null);
  const [showDupModal, setShowDupModal] = useState(false);
  const [phoneChecking, setPhoneChecking] = useState(false);

  // Duplicate phone check when phone field loses focus
  async function checkDuplicate(rawPhone: string) {
    const normalized = normaliseLKPhone(rawPhone);
    if (!normalized || !currentUser?.centerId) return;
    setPhoneChecking(true);
    try {
      const q = query(
        collection(db, "servicecenters", currentUser.centerId, "customers"),
        where("phone", "==", normalized),
        where("isDeleted", "==", false),
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        const d = snap.docs[0];
        const data = d.data();
        setDuplicate({ id: d.id, name: data.name, phone: data.phone });
        setShowDupModal(true);
      } else {
        setDuplicate(null);
      }
    } finally {
      setPhoneChecking(false);
    }
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!name.trim()) {
      errs.name = "Name is required";
    } else if (name.trim().length < 2 || name.trim().length > 80) {
      errs.name = "Name must be 2–80 characters";
    }
    if (!phone.trim()) {
      errs.phone = "Phone number is required";
    } else if (!normaliseLKPhone(phone)) {
      errs.phone = "Enter a valid Sri Lanka number (07X XXX XXXX or +94XXXXXXXXX)";
    }
    if (notes.length > 500) {
      errs.notes = "Notes must be 500 characters or less";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate() || !currentUser?.centerId) return;

    const normalized = normaliseLKPhone(phone)!;

    // Check duplicate before submitting
    if (!duplicate) {
      const q = query(
        collection(db, "servicecenters", currentUser.centerId, "customers"),
        where("phone", "==", normalized),
        where("isDeleted", "==", false),
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        const d = snap.docs[0];
        const data = d.data();
        setDuplicate({ id: d.id, name: data.name, phone: data.phone });
        setShowDupModal(true);
        return;
      }
    }

    await doCreate(normalized);
  }

  async function doCreate(normalizedPhone: string) {
    if (!currentUser?.centerId) return;
    setSubmitting(true);
    try {
      const docRef = await addDoc(
        collection(db, "servicecenters", currentUser.centerId, "customers"),
        {
          name: name.trim(),
          phone: normalizedPhone,
          smsLanguage,
          notes: notes.trim() || null,
          isDeleted: false,
          vehicleCount: 0,
          lastServiceDate: null,
          createdAt: Timestamp.now(),
          centerId: currentUser.centerId,
        },
      );
      navigate(`/customers/${docRef.id}`);
    } catch (err) {
      console.error(err);
      setErrors({ submit: "Failed to save customer. Please try again." });
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      {/* Header */}
      <div className="border-b border-white/10 bg-[#0B1120]/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <button
            onClick={() => navigate("/customers")}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <UserPlus className="w-5 h-5 text-[#F97316]" />
          <h1 className="text-xl font-bold">Add Customer</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-6 space-y-5">

            {/* Full Name */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-300">
                Full Name <span className="text-[#F97316]">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Kamal Perera"
                maxLength={80}
                className={`w-full bg-[#0B1120] border rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#F97316]/60 ${
                  errors.name ? "border-red-500" : "border-white/10"
                }`}
              />
              {errors.name && (
                <p className="flex items-center gap-1 text-xs text-red-400">
                  <AlertCircle className="w-3.5 h-3.5" /> {errors.name}
                </p>
              )}
            </div>

            {/* Phone */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-300">
                Phone Number <span className="text-[#F97316]">*</span>
              </label>
              <div className="relative">
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => { setPhone(e.target.value); setDuplicate(null); }}
                  onBlur={(e) => checkDuplicate(e.target.value)}
                  placeholder="071 234 5678 or +94712345678"
                  className={`w-full bg-[#0B1120] border rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#F97316]/60 ${
                    errors.phone ? "border-red-500" : "border-white/10"
                  }`}
                />
                {phoneChecking && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
              </div>
              {errors.phone && (
                <p className="flex items-center gap-1 text-xs text-red-400">
                  <AlertCircle className="w-3.5 h-3.5" /> {errors.phone}
                </p>
              )}
              <p className="text-xs text-gray-500">
                Stored as +94XXXXXXXXX international format
              </p>
            </div>

            {/* SMS Language */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-300">
                SMS Language <span className="text-[#F97316]">*</span>
              </label>
              <select
                value={smsLanguage}
                onChange={(e) => setSmsLanguage(e.target.value as "sinhala" | "tamil" | "english")}
                className="w-full bg-[#0B1120] border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#F97316]/60"
              >
                <option value="english" className="bg-[#162032] text-white">English</option>
                <option value="sinhala" className="bg-[#162032] text-white">Sinhala</option>
                <option value="tamil" className="bg-[#162032] text-white">Tamil</option>
              </select>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-300">
                Notes{" "}
                <span className="text-gray-500 font-normal">(optional · internal only)</span>
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any notes about this customer…"
                rows={3}
                maxLength={500}
                className={`w-full bg-[#0B1120] border rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#F97316]/60 resize-none ${
                  errors.notes ? "border-red-500" : "border-white/10"
                }`}
              />
              <div className="flex justify-between">
                {errors.notes ? (
                  <p className="flex items-center gap-1 text-xs text-red-400">
                    <AlertCircle className="w-3.5 h-3.5" /> {errors.notes}
                  </p>
                ) : <span />}
                <span className={`text-xs ${notes.length > 480 ? "text-amber-400" : "text-gray-500"}`}>
                  {notes.length}/500
                </span>
              </div>
            </div>
          </div>

          {errors.submit && (
            <p className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
              <AlertCircle className="w-4 h-4 shrink-0" /> {errors.submit}
            </p>
          )}

          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={() => navigate("/customers")}
              className="px-5 py-2.5 text-sm text-gray-300 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-[#F97316] hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              {submitting && (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )}
              Save Customer
            </button>
          </div>
        </form>
      </div>

      {/* Duplicate Phone Modal */}
      {showDupModal && duplicate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#162032] border border-white/10 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h3 className="font-semibold text-white mb-1">Duplicate Phone Number</h3>
                <p className="text-sm text-gray-400">
                  <span className="text-white font-medium">{duplicate.name}</span> is already
                  registered with {formatPhoneDisplay(duplicate.phone)}.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2 mt-5">
              <button
                onClick={() => navigate(`/customers/${duplicate.id}`)}
                className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm font-medium border border-white/10 hover:border-white/20 text-gray-300 hover:text-white rounded-lg transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                View existing record
              </button>
              <button
                onClick={async () => {
                  setShowDupModal(false);
                  const normalized = normaliseLKPhone(phone)!;
                  await doCreate(normalized);
                }}
                disabled={submitting}
                className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm font-medium bg-[#F97316] hover:bg-orange-600 disabled:opacity-50 text-white rounded-lg transition-colors"
              >
                {submitting && (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                Add as new customer anyway
              </button>
              <button
                onClick={() => setShowDupModal(false)}
                className="w-full px-4 py-2 text-sm text-gray-500 hover:text-gray-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
