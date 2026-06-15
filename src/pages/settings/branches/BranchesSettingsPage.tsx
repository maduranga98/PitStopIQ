import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection, query, orderBy, onSnapshot,
  addDoc, doc, updateDoc, getDoc, Timestamp,
} from "firebase/firestore";
import {
  ArrowLeft, Plus, Building2, MapPin, Phone, X, Check, AlertTriangle,
} from "lucide-react";
import { db } from "../../../config/firebase";
import { useAuth } from "../../../contexts/AuthContext";
import { SRI_LANKA_DISTRICTS } from "../../../types/auth";
import type { Branch } from "../../../types/auth";

export default function BranchesSettingsPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [plan, setPlan] = useState<string | null>(null);
  const [centerName, setCenterName] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const centerId = currentUser?.centerId;
  const isOwner = currentUser?.role === "Owner";

  useEffect(() => {
    if (!centerId) return;
    getDoc(doc(db, "servicecenters", centerId)).then(snap => {
      if (snap.exists()) {
        const d = snap.data() as { plan: string; name: string };
        setPlan(d.plan);
        setCenterName(d.name ?? "");
      }
    });
  }, [centerId]);

  useEffect(() => {
    if (!centerId) return;
    const q = query(
      collection(db, "servicecenters", centerId, "branches"),
      orderBy("createdAt", "asc"),
    );
    return onSnapshot(q, snap => {
      setBranches(snap.docs.map(d => ({ id: d.id, ...d.data() } as Branch)));
      setLoading(false);
    });
  }, [centerId]);

  async function toggleActive(branch: Branch) {
    if (!centerId) return;
    await updateDoc(doc(db, "servicecenters", centerId, "branches", branch.id), {
      active: !branch.active,
    });
  }

  if (plan !== null && plan !== "pro") {
    return (
      <div className="min-h-screen bg-[#0B1120] text-white">
        <Header onBack={() => navigate("/")} />
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-center">
          <Building2 className="w-14 h-14 text-gray-600 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Pro Plan Required</h2>
          <p className="text-sm text-gray-400">
            Multi-Branch management is available on the Pro plan (LKR 7,999/mo).
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      <div className="border-b border-white/10 bg-[#0B1120]/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/")}
              className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <Building2 className="w-5 h-5 text-[#F97316]" />
            <h1 className="text-lg font-bold">Branches</h1>
            <span className="text-xs font-bold bg-[#F97316]/20 text-[#F97316] border border-[#F97316]/30 px-2 py-0.5 rounded-full">PRO</span>
          </div>
          {isOwner && (
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-[#F97316] hover:bg-[#ea6c0f] text-white rounded-lg transition"
            >
              <Plus className="w-4 h-4" />
              Add Branch
            </button>
          )}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-[#F97316] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : branches.length === 0 ? (
          <div className="text-center py-16">
            <Building2 className="w-14 h-14 text-gray-600 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-white mb-2">No branches yet</h2>
            <p className="text-sm text-gray-400 mb-6">
              Add branches to manage multiple service locations under one account.
            </p>
            {isOwner && (
              <button
                onClick={() => setShowAdd(true)}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#F97316] hover:bg-[#ea6c0f] text-white text-sm font-semibold rounded-lg transition"
              >
                <Plus className="w-4 h-4" />
                Add Your First Branch
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {branches.map(branch => (
              <div
                key={branch.id}
                className={`bg-[#162032] border rounded-xl p-5 flex items-start justify-between gap-4 ${
                  branch.active ? "border-white/10" : "border-white/5 opacity-60"
                }`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className={`p-2 rounded-lg mt-0.5 flex-shrink-0 ${branch.active ? "bg-[#F97316]/10" : "bg-white/5"}`}>
                    <Building2 className={`w-4 h-4 ${branch.active ? "text-[#F97316]" : "text-gray-500"}`} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-white">{branch.name}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        branch.active ? "bg-green-500/20 text-green-300" : "bg-gray-500/20 text-gray-400"
                      }`}>
                        {branch.active ? "Active" : "Inactive"}
                      </span>
                    </div>
                    <div className="mt-1.5 space-y-1">
                      <div className="flex items-center gap-1.5 text-xs text-gray-400">
                        <MapPin className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">
                          {branch.address}{branch.district ? `, ${branch.district}` : ""}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-gray-400">
                        <Phone className="w-3 h-3 flex-shrink-0" />
                        <span>{branch.phone}</span>
                      </div>
                      {branch.smsSenderName && (
                        <div className="text-xs text-gray-500">SMS Sender: {branch.smsSenderName}</div>
                      )}
                      {branch.reminderThresholdKm !== undefined && (
                        <div className="text-xs text-gray-500">
                          Reminder threshold: {branch.reminderThresholdKm.toLocaleString()} km
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                {isOwner && (
                  <button
                    onClick={() => toggleActive(branch)}
                    className={`flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg border transition ${
                      branch.active
                        ? "bg-white/5 border-white/10 text-gray-400 hover:text-red-400 hover:border-red-500/30"
                        : "bg-white/5 border-white/10 text-gray-400 hover:text-green-400 hover:border-green-500/30"
                    }`}
                  >
                    {branch.active ? "Deactivate" : "Activate"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showAdd && isOwner && (
        <AddBranchModal
          centerId={centerId!}
          defaultName={branches.length === 0 ? centerName : ""}
          isFirst={branches.length === 0}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <div className="border-b border-white/10 bg-[#0B1120]/80 backdrop-blur sticky top-0 z-10">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <Building2 className="w-5 h-5 text-[#F97316]" />
        <h1 className="text-lg font-bold text-white">Branches</h1>
      </div>
    </div>
  );
}

function AddBranchModal({
  centerId, defaultName, isFirst, onClose,
}: {
  centerId: string;
  defaultName: string;
  isFirst: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [smsSenderName, setSmsSenderName] = useState("");
  const [district, setDistrict] = useState("");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate() {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Branch name is required";
    if (!address.trim()) e.address = "Address is required";
    if (!phone.trim()) e.phone = "Phone number is required";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      await addDoc(collection(db, "servicecenters", centerId, "branches"), {
        name: name.trim(),
        address: address.trim(),
        phone: phone.trim(),
        ...(smsSenderName.trim() ? { smsSenderName: smsSenderName.trim() } : {}),
        ...(district ? { district } : {}),
        active: true,
        createdAt: Timestamp.now(),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">
            {isFirst ? "Add First Branch" : "Add Branch"}
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {isFirst && (
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2 text-xs text-blue-300">
            The first branch inherits your center's primary name by default. You can change it.
          </div>
        )}

        <FormField label="Branch Name *" error={errors.name}>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. AutoFix Kandy"
            className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
          />
        </FormField>

        <FormField label="Address *" error={errors.address}>
          <input
            type="text"
            value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder="Street address"
            className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
          />
        </FormField>

        <FormField label="Phone *" error={errors.phone}>
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="+94 77 123 4567"
            className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
          />
        </FormField>

        <FormField label="SMS Sender Name" hint="Defaults to center sender name if empty (max 11 chars)">
          <input
            type="text"
            value={smsSenderName}
            onChange={e => setSmsSenderName(e.target.value)}
            placeholder="e.g. AUTOFIX-KDY"
            maxLength={11}
            className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
          />
        </FormField>

        <FormField label="District">
          <select
            value={district}
            onChange={e => setDistrict(e.target.value)}
            className="w-full bg-[#0B1120] border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
          >
            <option value="">Select district</option>
            {SRI_LANKA_DISTRICTS.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </FormField>

        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 rounded-lg transition text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition text-sm flex items-center justify-center gap-2"
          >
            {saving ? (
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <Check className="w-4 h-4" />
            )}
            {saving ? "Saving…" : "Add Branch"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FormField({
  label, hint, error, children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-xs text-gray-400 block mb-1">{label}</label>
      {hint && <p className="text-xs text-gray-600 mb-1">{hint}</p>}
      {children}
      {error && (
        <div className="flex items-center gap-1 mt-1 text-xs text-red-400">
          <AlertTriangle className="w-3 h-3" />
          {error}
        </div>
      )}
    </div>
  );
}
