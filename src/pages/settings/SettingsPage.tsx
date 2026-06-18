import { useEffect, useState, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  collection, query, where, getDocs, doc, updateDoc, addDoc,
  deleteDoc, onSnapshot, orderBy, Timestamp,
} from "firebase/firestore";
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import {
  ArrowLeft, MessageSquare, Users, CreditCard, Download,
  AlertTriangle, Camera, CheckCircle, X, UserPlus, ExternalLink,
  Info, Trash2, ChevronRight, Shield, Loader2, RefreshCw, Clock,
  User, Package, FileText, Send,
} from "lucide-react";
import { db, storage } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { downloadCSV } from "../../lib/csvExport";
import type { ServiceCenter, StaffMember, UserRole, PendingInvite } from "../../types/auth";
import { SRI_LANKA_DISTRICTS } from "../../types/auth";

// ── Helpers ─────────────────────────────────────────────────────────────────────
type TabId = "profile" | "sms" | "reminders" | "staff" | "subscription" | "exports" | "danger";

const ownerOrManager = (role?: UserRole) => role === "Owner" || role === "Manager";
const ownerOnly = (role?: UserRole) => role === "Owner";

const TABS: { id: TabId; label: string; ownerOnly: boolean }[] = [
  { id: "profile",      label: "Profile",      ownerOnly: false },
  { id: "sms",          label: "SMS",          ownerOnly: false },
  { id: "reminders",    label: "Reminders",    ownerOnly: false },
  { id: "staff",        label: "Staff",        ownerOnly: false },
  { id: "subscription", label: "Subscription", ownerOnly: true },
  { id: "exports",      label: "Exports",      ownerOnly: true },
  { id: "danger",       label: "Danger Zone",  ownerOnly: true },
];

const ROLE_COLORS: Record<UserRole, string> = {
  Owner:        "bg-orange-500/20 text-orange-300 border-orange-500/30",
  Manager:      "bg-blue-500/20 text-blue-300 border-blue-500/30",
  Technician:   "bg-green-500/20 text-green-300 border-green-500/30",
  Cashier:      "bg-purple-500/20 text-purple-300 border-purple-500/30",
  Receptionist: "bg-gray-500/20 text-gray-300 border-gray-500/30",
};

const ALL_ROLES: UserRole[] = ["Owner", "Manager", "Technician", "Cashier", "Receptionist"];

function FormField({
  label, hint, error, children,
}: {
  label: string; hint?: string; error?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-xs text-gray-400 block mb-1">{label}</label>
      {hint && <p className="text-xs text-gray-600 mb-1">{hint}</p>}
      {children}
      {error && (
        <div className="flex items-center gap-1 mt-1 text-xs text-red-400">
          <AlertTriangle className="w-3 h-3 flex-shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const role = currentUser?.role;
  const centerId = currentUser?.centerId;

  const [center, setCenter] = useState<ServiceCenter | null>(null);
  const [loading, setLoading] = useState(true);


  useEffect(() => {
    if (!centerId) return;
    const unsub = onSnapshot(doc(db, "servicecenters", centerId), snap => {
      if (snap.exists()) setCenter({ id: snap.id, ...snap.data() } as ServiceCenter);
      setLoading(false);
    });
    return unsub;
  }, [centerId]);

  const activeTab = (searchParams.get("tab") as TabId) ?? "profile";
  const visibleTabs = TABS;

  function setTab(id: TabId) { setSearchParams({ tab: id }, { replace: true }); }

  return (
    <div className="min-h-screen bg-[#0B1120] text-white">
      {/* Sticky header + tabs */}
      <div className="border-b border-white/10 bg-[#0B1120]/90 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Shield className="w-5 h-5 text-[#F97316]" />
          <h1 className="text-lg font-bold">Settings</h1>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 overflow-x-auto">
          <div className="flex min-w-max border-t border-white/5">
            {visibleTabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setTab(tab.id)}
                className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? "border-[#F97316] text-white"
                    : tab.id === "danger"
                    ? "border-transparent text-gray-400 hover:text-red-400"
                    : "border-transparent text-gray-400 hover:text-gray-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center pt-24">
          <Loader2 className="w-6 h-6 text-[#F97316] animate-spin" />
        </div>
      ) : (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {activeTab === "profile" && center && centerId && (
            <ProfileTab center={center} centerId={centerId} role={role} />
          )}
          {activeTab === "sms" && center && centerId && (
            <SmsTab center={center} centerId={centerId} role={role} />
          )}
          {activeTab === "reminders" && center && centerId && (
            <RemindersTab center={center} centerId={centerId} role={role} />
          )}
          {activeTab === "staff" && centerId && (
            <StaffTab centerId={centerId} role={role} currentUid={currentUser?.uid} />
          )}
          {activeTab === "subscription" && center && centerId && ownerOnly(role) && (
            <SubscriptionTab center={center} centerId={centerId} />
          )}
          {activeTab === "exports" && centerId && ownerOnly(role) && (
            <ExportsTab centerId={centerId} plan={center?.plan} />
          )}
          {activeTab === "danger" && center && centerId && ownerOnly(role) && (
            <DangerZoneTab center={center} centerId={centerId} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Profile Tab ──────────────────────────────────────────────────────────────────
function ProfileTab({ center, centerId, role }: {
  center: ServiceCenter; centerId: string; role?: UserRole;
}) {
  const editable = ownerOrManager(role);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(center.name ?? "");
  const [address, setAddress] = useState(center.address ?? "");
  const [phone, setPhone] = useState(center.phone ?? "");
  const [district, setDistrict] = useState(center.district ?? "");
  const [businessReg, setBusinessReg] = useState(center.businessRegistrationNumber ?? "");

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(center.logoUrl ?? null);
  const [logoProgress, setLogoProgress] = useState(0);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState("");

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setSaveError("Logo must be under 2 MB."); return; }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setSaveError("Logo must be PNG, JPG, or WebP.");
      return;
    }
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
    setSaveError("");
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Center name is required";
    else if (name.trim().length > 80) e.name = "Max 80 characters";
    if (!address.trim()) e.address = "Address is required";
    if (!phone.trim()) e.phone = "Phone number is required";
    if (!district) e.district = "District is required";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    setSaveError("");
    try {
      let logoUrl: string | undefined = center.logoUrl;

      if (logoFile) {
        const ext = logoFile.name.split(".").pop() ?? "jpg";
        const logoRef = storageRef(storage, `servicecenters/${centerId}/logo.${ext}`);
        await new Promise<void>((resolve, reject) => {
          const task = uploadBytesResumable(logoRef, logoFile);
          task.on(
            "state_changed",
            snap => setLogoProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
            reject,
            async () => { logoUrl = await getDownloadURL(task.snapshot.ref); resolve(); },
          );
        });
        setLogoFile(null);
        setLogoProgress(0);
      }

      await updateDoc(doc(db, "servicecenters", centerId), {
        name: name.trim(),
        address: address.trim(),
        phone: phone.trim(),
        district,
        businessRegistrationNumber: businessReg.trim(),
        ...(logoUrl ? { logoUrl } : {}),
        updatedAt: Timestamp.now(),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setSaveError("Failed to save. Please try again.");
    }
    setSaving(false);
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h2 className="text-base font-semibold text-white">Center Profile</h2>
        <p className="text-sm text-gray-400 mt-0.5">Appears on invoices, SMS messages, and public QR pages.</p>
      </div>

      {/* Logo */}
      <div className="bg-[#162032] border border-white/10 rounded-xl p-5">
        <label className="text-xs text-gray-400 block mb-3">Center Logo</label>
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-xl border-2 border-dashed border-white/20 flex items-center justify-center overflow-hidden bg-white/5 flex-shrink-0">
            {logoPreview
              ? <img src={logoPreview} alt="Logo" className="w-full h-full object-contain" />
              : <Camera className="w-6 h-6 text-gray-500" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-500 mb-2">PNG, JPG, or WebP — max 2 MB</p>
            {editable && (
              <>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg transition"
                >
                  {logoPreview ? "Change Logo" : "Upload Logo"}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={handleLogoChange}
                />
              </>
            )}
            {logoProgress > 0 && logoProgress < 100 && (
              <div className="mt-2">
                <div className="w-full bg-white/10 rounded-full h-1.5">
                  <div className="bg-[#F97316] h-1.5 rounded-full transition-all" style={{ width: `${logoProgress}%` }} />
                </div>
                <p className="text-xs text-gray-500 mt-1">Uploading… {logoProgress}%</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Fields */}
      <div className="bg-[#162032] border border-white/10 rounded-xl p-5 space-y-4">
        <FormField label="Center Name *" error={errors.name} hint="Max 80 characters · appears on invoices and SMS">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={80}
            disabled={!editable}
            placeholder="e.g. AutoFix Service Center"
            className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316] disabled:opacity-50"
          />
          <div className="text-right mt-1">
            <span className={`text-xs ${name.length > 72 ? "text-amber-400" : "text-gray-600"}`}>{name.length}/80</span>
          </div>
        </FormField>

        <FormField label="Address *" error={errors.address} hint="Appears on PDF invoices">
          <textarea
            value={address}
            onChange={e => setAddress(e.target.value)}
            disabled={!editable}
            rows={3}
            placeholder="Street address, city"
            className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316] disabled:opacity-50 resize-none"
          />
        </FormField>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Phone Number *" error={errors.phone} hint="LK format">
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              disabled={!editable}
              placeholder="+94 77 123 4567"
              className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316] disabled:opacity-50"
            />
          </FormField>

          <FormField label="District *" error={errors.district}>
            <select
              value={district}
              onChange={e => setDistrict(e.target.value)}
              disabled={!editable}
              className="w-full bg-[#0B1120] border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316] disabled:opacity-50"
            >
              <option value="">Select district</option>
              {SRI_LANKA_DISTRICTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </FormField>
        </div>

        <FormField label="Business Registration Number" hint="Optional · appears on PDF invoices">
          <input
            type="text"
            value={businessReg}
            onChange={e => setBusinessReg(e.target.value)}
            disabled={!editable}
            placeholder="e.g. PV 12345678"
            className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316] disabled:opacity-50"
          />
        </FormField>
      </div>

      {editable && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-[#F97316] hover:bg-[#ea6c0f] text-white px-5 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 transition flex items-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? "Saving…" : "Save Profile"}
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-green-400 text-sm">
              <CheckCircle className="w-4 h-4" />Saved
            </span>
          )}
          {saveError && <span className="text-red-400 text-sm">{saveError}</span>}
        </div>
      )}
    </div>
  );
}

// ── SMS Tab ──────────────────────────────────────────────────────────────────────
function SmsTab({ center }: {
  center: ServiceCenter; centerId: string; role?: UserRole;
}) {
  const navigate = useNavigate();

  const quotaUsed = center.smsQuotaUsed ?? 0;
  const quotaLimit = center.smsQuotaLimit ?? (center.plan === "pro" ? 1000 : 200);
  const quotaPct = quotaLimit > 0 ? Math.round((quotaUsed / quotaLimit) * 100) : 0;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h2 className="text-base font-semibold text-white">SMS Settings</h2>
        <p className="text-sm text-gray-400 mt-0.5">Configure SMS sender identity and manage message templates.</p>
      </div>

      {/* Quota */}
      <div className="bg-[#162032] border border-white/10 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-white">Monthly SMS Quota</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold uppercase border ${
            center.plan === "pro"
              ? "bg-orange-500/20 text-orange-400 border-orange-500/30"
              : "bg-gray-500/20 text-gray-400 border-gray-500/30"
          }`}>
            {center.plan} plan
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-400">Used this month</span>
          <span className={quotaPct >= 100 ? "text-red-400 font-semibold" : quotaPct >= 80 ? "text-amber-400 font-semibold" : "text-white"}>
            {quotaUsed.toLocaleString()} / {quotaLimit.toLocaleString()} SMS ({quotaPct}%)
          </span>
        </div>
        <div className="w-full bg-white/10 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${quotaPct >= 100 ? "bg-red-500" : quotaPct >= 80 ? "bg-amber-500" : "bg-green-500"}`}
            style={{ width: `${Math.min(quotaPct, 100)}%` }}
          />
        </div>
        {quotaPct >= 100 && (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg px-3 py-2 text-xs">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            Quota reached — SMS sending is paused until next month or plan upgrade.
          </div>
        )}
        {quotaPct >= 80 && quotaPct < 100 && (
          <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg px-3 py-2 text-xs">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            You've used {quotaPct}% of your monthly SMS quota.
          </div>
        )}
      </div>

      {/* Quick links */}
      <div className="space-y-2">
        <button
          onClick={() => navigate("/settings/sms")}
          className="w-full bg-[#162032] border border-white/10 rounded-xl p-4 flex items-center justify-between hover:border-white/20 transition group text-left"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#F97316]/10 rounded-lg flex items-center justify-center flex-shrink-0">
              <MessageSquare className="w-4 h-4 text-[#F97316]" />
            </div>
            <div>
              <div className="text-sm font-medium text-white">SMS Templates</div>
              <div className="text-xs text-gray-500">Edit completion and reminder message templates</div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-gray-500 group-hover:text-gray-300 transition flex-shrink-0" />
        </button>

        <button
          onClick={() => navigate("/sms-logs")}
          className="w-full bg-[#162032] border border-white/10 rounded-xl p-4 flex items-center justify-between hover:border-white/20 transition group text-left"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-500/10 rounded-lg flex items-center justify-center flex-shrink-0">
              <ExternalLink className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <div className="text-sm font-medium text-white">SMS Log</div>
              <div className="text-xs text-gray-500">View sent, delivered, and failed messages</div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-gray-500 group-hover:text-gray-300 transition flex-shrink-0" />
        </button>
      </div>
    </div>
  );
}

// ── Reminders Tab ────────────────────────────────────────────────────────────────
function RemindersTab({ center, centerId, role }: {
  center: ServiceCenter; centerId: string; role?: UserRole;
}) {
  const editable = ownerOrManager(role);

  const [thresholdKm, setThresholdKm] = useState(String(center.reminderThresholdKm ?? 1000));
  const [cooldownDays, setCooldownDays] = useState(String(center.reminderCooldownDays ?? 7));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const e: Record<string, string> = {};
    const km = parseInt(thresholdKm, 10);
    if (isNaN(km) || km < 100 || km > 5000) e.thresholdKm = "Must be between 100 and 5,000 km";
    const days = parseInt(cooldownDays, 10);
    if (isNaN(days) || days < 1 || days > 60) e.cooldownDays = "Must be between 1 and 60 days";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "servicecenters", centerId), {
        reminderThresholdKm: parseInt(thresholdKm, 10),
        reminderCooldownDays: parseInt(cooldownDays, 10),
        updatedAt: Timestamp.now(),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h2 className="text-base font-semibold text-white">Reminder Settings</h2>
        <p className="text-sm text-gray-400 mt-0.5">Controls when and how often service reminders are automatically sent.</p>
      </div>

      <div className="bg-[#162032] border border-white/10 rounded-xl p-5 space-y-5">
        <FormField
          label="Reminder Threshold (km)"
          error={errors.thresholdKm}
          hint="Vehicles enter the reminder queue when remaining km drops to or below this value"
        >
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={thresholdKm}
              onChange={e => setThresholdKm(e.target.value)}
              disabled={!editable}
              min={100}
              max={5000}
              placeholder="1000"
              className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316] disabled:opacity-50"
            />
            <span className="text-sm text-gray-400 whitespace-nowrap flex-shrink-0">km</span>
          </div>
          <p className="text-xs text-gray-600 mt-1">Range: 100 – 5,000 km</p>
        </FormField>

        <div className="border-t border-white/5" />

        <FormField
          label="Reminder Cooldown (days)"
          error={errors.cooldownDays}
          hint="Minimum days between reminders sent to the same vehicle — prevents spam"
        >
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={cooldownDays}
              onChange={e => setCooldownDays(e.target.value)}
              disabled={!editable}
              min={1}
              max={60}
              placeholder="7"
              className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316] disabled:opacity-50"
            />
            <span className="text-sm text-gray-400 whitespace-nowrap flex-shrink-0">days</span>
          </div>
          <p className="text-xs text-gray-600 mt-1">Range: 1 – 60 days</p>
        </FormField>
      </div>

      <div className="flex items-start gap-3 bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3">
        <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-blue-300">
          <span className="font-semibold">Reminder Sending Time:</span> Reminders are dispatched nightly at{" "}
          <span className="font-semibold">20:00 Sri Lanka Time (LKT)</span> by an automated system. This time is fixed in v1 and cannot be changed.
        </div>
      </div>

      {editable && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-[#F97316] hover:bg-[#ea6c0f] text-white px-5 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 transition flex items-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? "Saving…" : "Save Settings"}
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-green-400 text-sm">
              <CheckCircle className="w-4 h-4" />Saved
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Staff Tab ────────────────────────────────────────────────────────────────────
function StaffTab({ centerId, role: userRole, currentUid }: {
  centerId: string; role?: UserRole; currentUid?: string;
}) {
  const isOwner = ownerOnly(userRole);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [invites, setInvites] = useState<(PendingInvite & { docId: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [changeRoleFor, setChangeRoleFor] = useState<{ id: string; current: UserRole } | null>(null);
  const [newRole, setNewRole] = useState<UserRole>("Technician");

  useEffect(() => {
    if (!centerId) return;
    const staffUnsub = onSnapshot(
      query(collection(db, "servicecenters", centerId, "staff"), orderBy("createdAt", "asc")),
      snap => { setStaff(snap.docs.map(d => ({ id: d.id, ...d.data() } as StaffMember))); setLoading(false); },
    );
    const inviteUnsub = onSnapshot(
      query(collection(db, "invites"), where("centerId", "==", centerId)),
      snap => setInvites(snap.docs.map(d => ({ docId: d.id, ...d.data() } as PendingInvite & { docId: string }))),
    );
    return () => { staffUnsub(); inviteUnsub(); };
  }, [centerId]);

  const now = new Date();
  const activeInvites = invites.filter(inv => {
    const exp = (inv.expiresAt instanceof Date ? inv.expiresAt : (inv.expiresAt as unknown as { toDate(): Date }).toDate());
    return exp > now;
  });

  const activeStaff = staff.filter(s => s.active);
  const inactiveStaff = staff.filter(s => !s.active);

  async function handleRemove(staffId: string) {
    if (!window.confirm("Remove this staff member? They will lose access on next page load.")) return;
    setProcessingId(staffId);
    try { await updateDoc(doc(db, "servicecenters", centerId, "staff", staffId), { active: false }); }
    finally { setProcessingId(null); }
  }

  async function handleChangeRole(staffId: string, role: UserRole) {
    setProcessingId(staffId);
    try {
      await updateDoc(doc(db, "servicecenters", centerId, "staff", staffId), { role });
      setChangeRoleFor(null);
    } finally { setProcessingId(null); }
  }

  async function handleResendInvite(invite: PendingInvite & { docId: string }) {
    setProcessingId(invite.docId);
    try {
      await deleteDoc(doc(db, "invites", invite.docId));
      await addDoc(collection(db, "invites"), {
        email: invite.email,
        role: invite.role,
        centerId,
        expiresAt: Timestamp.fromDate(new Date(Date.now() + 72 * 60 * 60 * 1000)),
        createdAt: Timestamp.now(),
        createdBy: currentUid ?? "",
      });
    } finally { setProcessingId(null); }
  }

  async function handleRevokeInvite(inviteDocId: string) {
    if (!window.confirm("Revoke this invite?")) return;
    setProcessingId(inviteDocId);
    try { await deleteDoc(doc(db, "invites", inviteDocId)); }
    finally { setProcessingId(null); }
  }

  async function handleReinvite(member: StaffMember) {
    setProcessingId(member.id);
    try {
      await addDoc(collection(db, "invites"), {
        email: member.email,
        role: member.role,
        centerId,
        expiresAt: Timestamp.fromDate(new Date(Date.now() + 72 * 60 * 60 * 1000)),
        createdAt: Timestamp.now(),
        createdBy: currentUid ?? "",
      });
    } finally { setProcessingId(null); }
  }

  function staffDisplayName(m: StaffMember): string {
    return m.fullName || m.displayName || m.email.split("@")[0];
  }

  function formatLastLogin(ts?: Timestamp): string {
    if (!ts) return "—";
    const d = ts.toDate();
    return d.toLocaleDateString("en-LK", { day: "numeric", month: "short", year: "numeric" });
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-white">Staff Accounts</h2>
          <p className="text-sm text-gray-400 mt-0.5">Manage who has access to your service center.</p>
        </div>
        {isOwner && (
          <button
            onClick={() => setShowInvite(true)}
            className="flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white px-4 py-2 rounded-lg text-sm font-semibold transition flex-shrink-0"
          >
            <UserPlus className="w-4 h-4" />
            Invite Staff
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 text-[#F97316] animate-spin" /></div>
      ) : (
        <div className="space-y-6">
          {/* Active staff */}
          {activeStaff.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Active · {activeStaff.length}
              </h3>
              <div className="bg-[#162032] border border-white/10 rounded-xl overflow-hidden">
                {activeStaff.map((member, idx) => (
                  <div
                    key={member.id}
                    className={`flex items-center gap-4 px-4 py-3.5 ${idx < activeStaff.length - 1 ? "border-b border-white/5" : ""}`}
                  >
                    <div className="w-8 h-8 rounded-full bg-[#F97316]/20 flex items-center justify-center flex-shrink-0">
                      <User className="w-4 h-4 text-[#F97316]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-white truncate">{staffDisplayName(member)}</span>
                        {member.id === currentUid && (
                          <span className="text-xs text-gray-500">(you)</span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${ROLE_COLORS[member.role]}`}>
                          {member.role}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5 truncate">{member.email}</div>
                    </div>
                    <div className="hidden sm:block text-xs text-gray-500 flex-shrink-0">
                      Last login: {formatLastLogin(member.lastLoginAt)}
                    </div>
                    {isOwner && member.id !== currentUid && (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {changeRoleFor?.id === member.id ? (
                          <div className="flex items-center gap-2">
                            <select
                              value={newRole}
                              onChange={e => setNewRole(e.target.value as UserRole)}
                              className="bg-[#0B1120] border border-white/10 text-white rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-[#F97316]"
                            >
                              {ALL_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                            <button
                              onClick={() => handleChangeRole(member.id, newRole)}
                              disabled={processingId === member.id}
                              className="text-xs bg-[#F97316] hover:bg-[#ea6c0f] text-white px-2 py-1 rounded-lg transition disabled:opacity-50"
                            >
                              {processingId === member.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
                            </button>
                            <button
                              onClick={() => setChangeRoleFor(null)}
                              className="text-gray-500 hover:text-gray-300"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              onClick={() => { setChangeRoleFor({ id: member.id, current: member.role }); setNewRole(member.role); }}
                              className="text-xs text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 px-2.5 py-1.5 rounded-lg transition"
                            >
                              Change Role
                            </button>
                            <button
                              onClick={() => handleRemove(member.id)}
                              disabled={processingId === member.id}
                              className="text-xs text-red-400 hover:text-red-300 bg-red-500/5 hover:bg-red-500/10 border border-red-500/20 px-2.5 py-1.5 rounded-lg transition disabled:opacity-50"
                            >
                              {processingId === member.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Remove"}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pending invites */}
          {activeInvites.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Pending Invites · {activeInvites.length}
              </h3>
              <div className="bg-[#162032] border border-white/10 rounded-xl overflow-hidden">
                {activeInvites.map((invite, idx) => {
                  const exp = (invite.expiresAt instanceof Date ? invite.expiresAt : (invite.expiresAt as unknown as { toDate(): Date }).toDate());
                  const hoursLeft = Math.ceil((exp.getTime() - Date.now()) / 3600000);
                  return (
                    <div
                      key={invite.docId}
                      className={`flex items-center gap-4 px-4 py-3.5 ${idx < activeInvites.length - 1 ? "border-b border-white/5" : ""}`}
                    >
                      <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                        <Clock className="w-4 h-4 text-amber-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-white truncate">{invite.email}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${ROLE_COLORS[invite.role]}`}>
                            {invite.role}
                          </span>
                          <span className="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full">
                            Pending
                          </span>
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          Expires in {hoursLeft}h
                        </div>
                      </div>
                      {isOwner && (
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={() => handleResendInvite(invite)}
                            disabled={processingId === invite.docId}
                            className="text-xs text-blue-400 hover:text-blue-300 bg-blue-500/5 hover:bg-blue-500/10 border border-blue-500/20 px-2.5 py-1.5 rounded-lg transition flex items-center gap-1 disabled:opacity-50"
                          >
                            {processingId === invite.docId ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                            Resend
                          </button>
                          <button
                            onClick={() => handleRevokeInvite(invite.docId)}
                            disabled={processingId === invite.docId}
                            className="text-xs text-gray-400 hover:text-red-400 bg-white/5 hover:bg-red-500/5 border border-white/10 hover:border-red-500/20 px-2.5 py-1.5 rounded-lg transition disabled:opacity-50"
                          >
                            Revoke
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Inactive staff */}
          {inactiveStaff.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Inactive · {inactiveStaff.length}
              </h3>
              <div className="bg-[#162032] border border-white/10 rounded-xl overflow-hidden">
                {inactiveStaff.map((member, idx) => (
                  <div
                    key={member.id}
                    className={`flex items-center gap-4 px-4 py-3.5 opacity-60 ${idx < inactiveStaff.length - 1 ? "border-b border-white/5" : ""}`}
                  >
                    <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center flex-shrink-0">
                      <User className="w-4 h-4 text-gray-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-300 truncate">{staffDisplayName(member)}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${ROLE_COLORS[member.role]}`}>
                          {member.role}
                        </span>
                        <span className="text-xs bg-gray-500/10 text-gray-400 border border-gray-500/20 px-2 py-0.5 rounded-full">
                          Inactive
                        </span>
                      </div>
                      <div className="text-xs text-gray-600 mt-0.5 truncate">{member.email}</div>
                    </div>
                    {isOwner && (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => handleReinvite(member)}
                          disabled={processingId === member.id}
                          className="text-xs text-[#F97316] hover:text-orange-300 bg-orange-500/5 hover:bg-orange-500/10 border border-orange-500/20 px-2.5 py-1.5 rounded-lg transition flex items-center gap-1 disabled:opacity-50"
                        >
                          {processingId === member.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                          Re-invite
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeStaff.length === 0 && activeInvites.length === 0 && inactiveStaff.length === 0 && (
            <div className="text-center py-12">
              <Users className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <p className="text-sm text-gray-400">No staff yet.</p>
              {isOwner && <p className="text-xs text-gray-600 mt-1">Invite your first team member above.</p>}
            </div>
          )}
        </div>
      )}

      {showInvite && isOwner && (
        <InviteModal centerId={centerId} currentUid={currentUid} onClose={() => setShowInvite(false)} />
      )}
    </div>
  );
}

function InviteModal({ centerId, currentUid, onClose }: {
  centerId: string; currentUid?: string; onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("Technician");
  const [saving, setSaving] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function handleSend() {
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const docRef = await addDoc(collection(db, "invites"), {
        email: email.trim().toLowerCase(),
        role,
        centerId,
        expiresAt: Timestamp.fromDate(new Date(Date.now() + 72 * 60 * 60 * 1000)),
        createdAt: Timestamp.now(),
        createdBy: currentUid ?? "",
      });
      setInviteLink(`${window.location.origin}/invite/${docRef.id}`);
    } catch {
      setError("Failed to create invite. Please try again.");
    }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">Invite Staff Member</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {inviteLink ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2 bg-green-500/10 border border-green-500/20 rounded-lg p-3 text-xs text-green-300">
              <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium mb-1">Invite created — expires in 72 hours</p>
                <p>Share this link with <strong>{email}</strong>:</p>
              </div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-lg p-3">
              <p className="text-xs text-gray-300 break-all font-mono">{inviteLink}</p>
            </div>
            <button
              onClick={() => { navigator.clipboard.writeText(inviteLink); }}
              className="w-full bg-white/10 hover:bg-white/20 text-white text-sm font-medium py-2 rounded-lg transition"
            >
              Copy Invite Link
            </button>
            <button onClick={onClose} className="w-full text-gray-400 hover:text-gray-200 text-sm py-1 transition">
              Done
            </button>
          </div>
        ) : (
          <>
            <FormField label="Email Address *" error={error}>
              <input
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(""); }}
                placeholder="staff@example.com"
                className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
              />
            </FormField>

            <FormField label="Role">
              <select
                value={role}
                onChange={e => setRole(e.target.value as UserRole)}
                className="w-full bg-[#0B1120] border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
              >
                {ALL_ROLES.filter(r => r !== "Owner").map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </FormField>

            <p className="text-xs text-gray-500">
              An invite link will be generated. Share it with the staff member — it expires in 72 hours.
            </p>

            <div className="flex gap-3 pt-1">
              <button
                onClick={onClose}
                className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 rounded-lg transition text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={saving}
                className="flex-1 bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition text-sm flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {saving ? "Creating…" : "Send Invite"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Subscription Tab ─────────────────────────────────────────────────────────────
function SubscriptionTab({ center }: { center: ServiceCenter; centerId: string }) {
  const trialDate = center.trialEndsAt instanceof Date
    ? center.trialEndsAt
    : (center.trialEndsAt as unknown as { toDate(): Date })?.toDate?.() ?? new Date(0);
  const trialDaysLeft = Math.ceil((trialDate.getTime() - Date.now()) / 86400000);
  const isTrial = trialDaysLeft > 0;

  const quotaUsed = center.smsQuotaUsed ?? 0;
  const quotaLimit = center.smsQuotaLimit ?? (center.plan === "pro" ? 1000 : 200);
  const quotaPct = quotaLimit > 0 ? Math.round((quotaUsed / quotaLimit) * 100) : 0;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h2 className="text-base font-semibold text-white">Subscription & Billing</h2>
        <p className="text-sm text-gray-400 mt-0.5">Manage your plan, usage, and billing.</p>
      </div>

      {/* Current Plan */}
      <div className="bg-[#162032] border border-white/10 rounded-xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Current Plan</div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-2xl font-bold text-white capitalize">{center.plan}</span>
              <span className={`text-sm px-2.5 py-0.5 rounded-full font-semibold border ${
                center.plan === "pro"
                  ? "bg-orange-500/20 text-orange-400 border-orange-500/30"
                  : "bg-gray-500/20 text-gray-300 border-gray-500/30"
              }`}>
                {center.plan === "pro" ? "LKR 7,999/mo" : "LKR 4,999/mo"}
              </span>
            </div>
          </div>
          <span className="bg-green-500/15 text-green-400 text-xs px-2.5 py-1 rounded-full font-medium border border-green-500/20 flex-shrink-0">
            {isTrial ? "Trial" : "Active"}
          </span>
        </div>

        {isTrial && (
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
            trialDaysLeft <= 1 ? "bg-red-500/10 border border-red-500/20 text-red-400"
            : trialDaysLeft <= 3 ? "bg-amber-500/10 border border-amber-500/20 text-amber-400"
            : "bg-orange-500/10 border border-orange-500/20 text-orange-400"
          }`}>
            <Clock className="w-4 h-4 flex-shrink-0" />
            Free trial: <strong className="ml-1">{trialDaysLeft} day{trialDaysLeft !== 1 ? "s" : ""} remaining</strong>
          </div>
        )}
      </div>

      {/* SMS Usage */}
      <div className="bg-[#162032] border border-white/10 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-white">SMS Usage This Month</span>
          <span className={quotaPct >= 80 ? "text-amber-400 font-semibold" : "text-gray-300"}>
            {quotaUsed.toLocaleString()} / {quotaLimit.toLocaleString()}
          </span>
        </div>
        <div className="w-full bg-white/10 rounded-full h-3">
          <div
            className={`h-3 rounded-full transition-all ${quotaPct >= 100 ? "bg-red-500" : quotaPct >= 80 ? "bg-amber-500" : "bg-green-500"}`}
            style={{ width: `${Math.min(quotaPct, 100)}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>{quotaPct}% used</span>
          <span>{Math.max(0, quotaLimit - quotaUsed).toLocaleString()} SMS remaining</span>
        </div>
      </div>

      {/* Upgrade to Pro */}
      {center.plan === "basic" && (
        <div className="bg-gradient-to-br from-orange-500/10 to-amber-500/5 border border-orange-500/20 rounded-xl p-5 space-y-4">
          <div>
            <div className="text-sm font-semibold text-white mb-1">Upgrade to Pro</div>
            <p className="text-xs text-gray-400">Unlock 1,000 SMS/month, multi-branch management, inventory, employee tracking, invoice PDFs, and advanced analytics.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => alert("PayHere checkout integration coming soon. Contact support to upgrade manually.")}
              className="flex-1 bg-[#F97316] hover:bg-[#ea6c0f] text-white text-sm font-semibold py-2.5 rounded-lg transition"
            >
              Upgrade to Pro — LKR 7,999/mo
            </button>
            <button
              onClick={() => alert("Annual plan checkout coming soon. Contact support to upgrade manually.")}
              className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-medium py-2.5 rounded-lg transition flex items-center justify-center gap-1"
            >
              Annual — LKR 79,990/yr
              <span className="text-xs text-green-400 font-semibold">(Save 17%)</span>
            </button>
          </div>
        </div>
      )}

      {/* Payment History */}
      <div>
        <h3 className="text-sm font-semibold text-white mb-3">Payment History</h3>
        <div className="bg-[#162032] border border-white/10 rounded-xl p-6 text-center">
          <CreditCard className="w-10 h-10 text-gray-600 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No payment records yet</p>
          <p className="text-xs text-gray-600 mt-1">Billing history will appear here once you have a paid subscription.</p>
        </div>
      </div>

      {/* Cancel Subscription (Pro only) */}
      {center.plan === "pro" && (
        <div>
          <h3 className="text-sm font-semibold text-white mb-3">Cancel Subscription</h3>
          <div className="bg-[#162032] border border-white/10 rounded-xl p-5">
            <p className="text-sm text-gray-400 mb-4">
              Cancelling will downgrade your account to the Basic plan at the next billing cycle. Your data will be retained.
            </p>
            <button
              onClick={() => alert("To cancel your subscription, please contact support. Cancellation flow will be available in a future update.")}
              className="text-sm text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500/50 px-4 py-2 rounded-lg transition"
            >
              Cancel Subscription
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Exports Tab ──────────────────────────────────────────────────────────────────
function ExportsTab({ centerId, plan }: { centerId: string; plan?: string }) {
  const isPro = plan === "pro";
  const [exporting, setExporting] = useState<string | null>(null);
  const [dateRanges, setDateRanges] = useState({
    services: { from: "", to: "" },
    invoices: { from: "", to: "" },
    sms:      { from: "", to: "" },
  });

  function setRange(key: keyof typeof dateRanges, field: "from" | "to", val: string) {
    setDateRanges(prev => ({ ...prev, [key]: { ...prev[key], [field]: val } }));
  }

  function dateToTimestamp(dateStr: string, end = false): Timestamp | null {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (end) d.setHours(23, 59, 59, 999);
    return Timestamp.fromDate(d);
  }

  async function exportCustomers() {
    setExporting("customers");
    try {
      const snap = await getDocs(query(
        collection(db, "servicecenters", centerId, "customers"),
        where("isDeleted", "==", false),
        orderBy("name"),
      ));
      const headers = ["Name", "Phone", "NIC", "Vehicle Count", "Last Service Date", "Notes", "Created At"];
      const rows = snap.docs.map(d => {
        const c = d.data();
        return [
          c.name ?? "", c.phone ?? "", c.nic ?? "",
          String(c.vehicleCount ?? 0),
          c.lastServiceDate ? new Date(c.lastServiceDate.seconds * 1000).toISOString().split("T")[0] : "",
          c.notes ?? "",
          c.createdAt ? new Date(c.createdAt.seconds * 1000).toISOString().split("T")[0] : "",
        ];
      });
      downloadCSV(`customers_${today()}.csv`, headers, rows);
    } finally { setExporting(null); }
  }

  async function exportVehicles() {
    setExporting("vehicles");
    try {
      const snap = await getDocs(query(
        collection(db, "servicecenters", centerId, "vehicles"),
        where("isDeleted", "==", false),
        orderBy("plateNumber"),
      ));
      const headers = ["Plate", "Make", "Model", "Year", "Colour", "Customer", "Current Mileage (km)", "Next Service (km)", "Oil Brand", "Oil Grade", "Oil Notes", "Created At"];
      const rows = snap.docs.map(d => {
        const v = d.data();
        return [
          v.plateNumber ?? "", v.make ?? "", v.model ?? "", String(v.year ?? ""),
          v.colour ?? "", v.customerName ?? "",
          String(v.currentMileageKm ?? 0), String(v.nextServiceMileageKm ?? 0),
          v.oilBrand ?? "", v.oilGrade ?? "", v.oilViscosityNotes ?? "",
          v.createdAt ? new Date(v.createdAt.seconds * 1000).toISOString().split("T")[0] : "",
        ];
      });
      downloadCSV(`vehicles_${today()}.csv`, headers, rows);
    } finally { setExporting(null); }
  }

  async function exportServices() {
    setExporting("services");
    try {
      const constraints = [orderBy("createdAt", "desc")];
      const fromTs = dateToTimestamp(dateRanges.services.from);
      const toTs = dateToTimestamp(dateRanges.services.to, true);
      if (fromTs) constraints.push(where("createdAt", ">=", fromTs) as never);
      if (toTs) constraints.push(where("createdAt", "<=", toTs) as never);

      const snap = await getDocs(query(
        collection(db, "servicecenters", centerId, "jobs"),
        ...constraints,
      ));
      const headers = ["Job #", "Plate", "Customer", "Technician", "Status", "Services", "Mileage In", "Mileage Out", "Created At", "Completed At"];
      const rows = snap.docs.map(d => {
        const j = d.data();
        return [
          j.jobNumber ?? "", j.plateNumber ?? "", j.customerName ?? "", j.technicianName ?? "",
          j.status ?? "",
          [...(j.services ?? []), ...(j.customServices ?? [])].join("; "),
          String(j.mileageIn ?? ""), String(j.mileageOut ?? ""),
          j.createdAt ? new Date(j.createdAt.seconds * 1000).toISOString().split("T")[0] : "",
          j.completedAt ? new Date(j.completedAt.seconds * 1000).toISOString().split("T")[0] : "",
        ];
      });
      downloadCSV(`services_${today()}.csv`, headers, rows);
    } finally { setExporting(null); }
  }

  async function exportInvoices() {
    setExporting("invoices");
    try {
      const constraints = [orderBy("createdAt", "desc")];
      const fromTs = dateToTimestamp(dateRanges.invoices.from);
      const toTs = dateToTimestamp(dateRanges.invoices.to, true);
      if (fromTs) constraints.push(where("createdAt", ">=", fromTs) as never);
      if (toTs) constraints.push(where("createdAt", "<=", toTs) as never);

      const snap = await getDocs(query(
        collection(db, "servicecenters", centerId, "invoices"),
        ...constraints,
      ));
      const headers = ["Invoice #", "Customer", "Plate", "Subtotal", "Discount", "Tax", "Grand Total", "Status", "Paid Amount", "Balance Due", "Date"];
      const rows = snap.docs.map(d => {
        const inv = d.data();
        return [
          inv.invoiceNumber ?? "", inv.customerName ?? "", inv.plateNumber ?? "",
          String(inv.subtotal ?? 0), String(inv.discount ?? 0), String(inv.tax ?? 0),
          String(inv.grandTotal ?? 0), inv.status ?? "",
          String(inv.paidAmount ?? 0), String(inv.balanceDue ?? 0),
          inv.createdAt ? new Date(inv.createdAt.seconds * 1000).toISOString().split("T")[0] : "",
        ];
      });
      downloadCSV(`invoices_${today()}.csv`, headers, rows);
    } finally { setExporting(null); }
  }

  async function exportSmsLog() {
    setExporting("sms");
    try {
      const constraints = [orderBy("sentAt", "desc")];
      const fromTs = dateToTimestamp(dateRanges.sms.from);
      const toTs = dateToTimestamp(dateRanges.sms.to, true);
      if (fromTs) constraints.push(where("sentAt", ">=", fromTs) as never);
      if (toTs) constraints.push(where("sentAt", "<=", toTs) as never);

      const snap = await getDocs(query(
        collection(db, "servicecenters", centerId, "smsLogs"),
        ...constraints,
      ));
      const headers = ["Customer", "Phone", "Plate", "Type", "Status", "Message", "Sent At", "Error Code"];
      const rows = snap.docs.map(d => {
        const s = d.data();
        return [
          s.customerName ?? "", s.phone ?? "", s.plateNumber ?? "",
          s.messageType ?? "", s.status ?? "", s.message ?? "",
          s.sentAt ? new Date(s.sentAt.seconds * 1000).toISOString() : "",
          s.errorCode ?? "",
        ];
      });
      downloadCSV(`sms_log_${today()}.csv`, headers, rows);
    } finally { setExporting(null); }
  }

  async function exportInventory() {
    setExporting("inventory");
    try {
      const snap = await getDocs(query(
        collection(db, "servicecenters", centerId, "inventory"),
        where("isArchived", "==", false),
        orderBy("name"),
      ));
      const headers = ["Name", "Category", "Unit", "Current Qty", "Threshold", "Unit Cost", "Supplier Name", "Supplier Phone", "Notes", "Created At"];
      const rows = snap.docs.map(d => {
        const i = d.data();
        return [
          i.name ?? "", i.category ?? "", i.unit ?? "",
          String(i.currentQty ?? 0), String(i.threshold ?? 0), String(i.unitCost ?? ""),
          i.supplierName ?? "", i.supplierPhone ?? "", i.notes ?? "",
          i.createdAt ? new Date(i.createdAt.seconds * 1000).toISOString().split("T")[0] : "",
        ];
      });
      downloadCSV(`inventory_${today()}.csv`, headers, rows);
    } finally { setExporting(null); }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h2 className="text-base font-semibold text-white">Data Export</h2>
        <p className="text-sm text-gray-400 mt-0.5">Download your data as UTF-8 encoded CSV files. All exports are scoped to the current center.</p>
      </div>

      <div className="space-y-3">
        <ExportCard
          icon={<User className="w-4 h-4 text-blue-400" />}
          iconBg="bg-blue-500/10"
          title="Customers"
          description="All customer records"
          onExport={exportCustomers}
          exporting={exporting === "customers"}
        />

        <ExportCard
          icon={<FileText className="w-4 h-4 text-green-400" />}
          iconBg="bg-green-500/10"
          title="Vehicles"
          description="All vehicle records including oil specs and mileage"
          onExport={exportVehicles}
          exporting={exporting === "vehicles"}
        />

        <ExportCardWithDateRange
          icon={<FileText className="w-4 h-4 text-[#F97316]" />}
          iconBg="bg-orange-500/10"
          title="Services"
          description="All service records with technician and status"
          dateRange={dateRanges.services}
          onFromChange={v => setRange("services", "from", v)}
          onToChange={v => setRange("services", "to", v)}
          onExport={exportServices}
          exporting={exporting === "services"}
        />

        <ExportCardWithDateRange
          icon={<CreditCard className="w-4 h-4 text-purple-400" />}
          iconBg="bg-purple-500/10"
          title="Invoices"
          description="All invoice records with payment status"
          dateRange={dateRanges.invoices}
          onFromChange={v => setRange("invoices", "from", v)}
          onToChange={v => setRange("invoices", "to", v)}
          onExport={exportInvoices}
          exporting={exporting === "invoices"}
        />

        <ExportCardWithDateRange
          icon={<MessageSquare className="w-4 h-4 text-amber-400" />}
          iconBg="bg-amber-500/10"
          title="SMS Log"
          description="All SMS records with delivery status"
          dateRange={dateRanges.sms}
          onFromChange={v => setRange("sms", "from", v)}
          onToChange={v => setRange("sms", "to", v)}
          onExport={exportSmsLog}
          exporting={exporting === "sms"}
        />

        <div className={!isPro ? "opacity-50 pointer-events-none" : ""}>
          <ExportCard
            icon={<Package className="w-4 h-4 text-cyan-400" />}
            iconBg="bg-cyan-500/10"
            title="Inventory"
            description="All inventory items with current stock levels"
            badge={!isPro ? "PRO" : undefined}
            onExport={exportInventory}
            exporting={exporting === "inventory"}
          />
        </div>
      </div>
    </div>
  );
}

function ExportCard({ icon, iconBg, title, description, badge, onExport, exporting }: {
  icon: React.ReactNode; iconBg: string; title: string; description: string;
  badge?: string; onExport: () => void; exporting: boolean;
}) {
  return (
    <div className="bg-[#162032] border border-white/10 rounded-xl p-4 flex items-center gap-4">
      <div className={`w-10 h-10 ${iconBg} rounded-lg flex items-center justify-center flex-shrink-0`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white">{title}</span>
          {badge && (
            <span className="text-xs font-bold bg-[#F97316]/20 text-[#F97316] border border-[#F97316]/30 px-1.5 py-0.5 rounded-full">
              {badge}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
      </div>
      <button
        onClick={onExport}
        disabled={exporting}
        className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-medium px-3 py-2 rounded-lg transition disabled:opacity-50 flex-shrink-0"
      >
        {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
        {exporting ? "Exporting…" : "Export CSV"}
      </button>
    </div>
  );
}

function ExportCardWithDateRange({ icon, iconBg, title, description, dateRange, onFromChange, onToChange, onExport, exporting }: {
  icon: React.ReactNode; iconBg: string; title: string; description: string;
  dateRange: { from: string; to: string };
  onFromChange: (v: string) => void; onToChange: (v: string) => void;
  onExport: () => void; exporting: boolean;
}) {
  return (
    <div className="bg-[#162032] border border-white/10 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-4">
        <div className={`w-10 h-10 ${iconBg} rounded-lg flex items-center justify-center flex-shrink-0`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-white">{title}</span>
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        </div>
        <button
          onClick={onExport}
          disabled={exporting}
          className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-medium px-3 py-2 rounded-lg transition disabled:opacity-50 flex-shrink-0"
        >
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>
      <div className="flex items-center gap-2 pl-14">
        <div className="flex items-center gap-2 flex-1">
          <label className="text-xs text-gray-500 whitespace-nowrap">From</label>
          <input
            type="date"
            value={dateRange.from}
            onChange={e => onFromChange(e.target.value)}
            className="flex-1 bg-white/5 border border-white/10 text-white rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-[#F97316]"
          />
        </div>
        <div className="flex items-center gap-2 flex-1">
          <label className="text-xs text-gray-500 whitespace-nowrap">To</label>
          <input
            type="date"
            value={dateRange.to}
            onChange={e => onToChange(e.target.value)}
            className="flex-1 bg-white/5 border border-white/10 text-white rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-[#F97316]"
          />
        </div>
      </div>
    </div>
  );
}

// ── Danger Zone Tab ──────────────────────────────────────────────────────────────
function DangerZoneTab({ center, centerId }: { center: ServiceCenter; centerId: string }) {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const isDeletionScheduled = !!center.deletionScheduledAt;

  async function handleCancelDeletion() {
    if (!window.confirm("Cancel the scheduled deletion? Your account will remain fully active.")) return;
    await updateDoc(doc(db, "servicecenters", centerId), {
      isDeleted: false,
      deletionScheduledAt: null,
    });
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h2 className="text-base font-semibold text-red-400">Danger Zone</h2>
        <p className="text-sm text-gray-400 mt-0.5">These actions have serious consequences. Proceed with extreme caution.</p>
      </div>

      {isDeletionScheduled ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-5 space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-red-300 mb-1">Account Deletion Scheduled</div>
              <p className="text-xs text-gray-400 leading-relaxed">
                Your account has been queued for permanent deletion. All data — customers, vehicles, services, invoices,
                staff, and storage files — will be permanently purged after the 30-day grace period.
                You can cancel this at any time before the grace period ends.
              </p>
            </div>
          </div>
          <button
            onClick={handleCancelDeletion}
            className="bg-white/10 hover:bg-white/20 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            Cancel Deletion — Keep My Account
          </button>
        </div>
      ) : (
        <div className="bg-[#162032] border border-red-500/20 rounded-xl p-5">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-red-500/10 rounded-lg flex items-center justify-center flex-shrink-0">
              <Trash2 className="w-5 h-5 text-red-400" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-white mb-1">Delete Center Account</div>
              <p className="text-xs text-gray-400 leading-relaxed mb-4">
                Permanently deletes all data including customers, vehicles, services, invoices, SMS history, and staff accounts.
                A <strong className="text-gray-300">30-day grace period</strong> applies — you can cancel during this window.
                After 30 days, all data is permanently purged and cannot be recovered.
              </p>
              <button
                onClick={() => setShowDeleteModal(true)}
                className="flex items-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 text-sm font-medium px-4 py-2 rounded-lg transition"
              >
                <Trash2 className="w-4 h-4" />
                Delete Account
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteModal && (
        <DeleteAccountModal
          centerName={center.name}
          centerId={centerId}
          onClose={() => setShowDeleteModal(false)}
        />
      )}
    </div>
  );
}

function DeleteAccountModal({ centerName, centerId, onClose }: {
  centerName: string; centerId: string; onClose: () => void;
}) {
  const navigate = useNavigate();
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const isMatch = confirmText.trim() === centerName.trim();

  async function handleDelete() {
    if (!isMatch) { setError("Center name does not match."); return; }
    setDeleting(true);
    setError("");
    try {
      await updateDoc(doc(db, "servicecenters", centerId), {
        isDeleted: true,
        deletionScheduledAt: Timestamp.now(),
      });
      navigate("/", { replace: true });
    } catch {
      setError("Failed to schedule deletion. Please try again.");
    }
    setDeleting(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-red-500/30 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            <h3 className="text-base font-semibold text-red-300">Delete Account</h3>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-red-300 leading-relaxed">
          This will schedule the permanent deletion of all data associated with <strong>{centerName}</strong>.
          A 30-day grace period applies. After that, this action cannot be undone.
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-1.5">
            Type <strong className="text-white">{centerName}</strong> to confirm
          </label>
          <input
            type="text"
            value={confirmText}
            onChange={e => { setConfirmText(e.target.value); setError(""); }}
            placeholder={centerName}
            className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-500"
          />
          {error && (
            <div className="flex items-center gap-1 mt-1 text-xs text-red-400">
              <AlertTriangle className="w-3 h-3" />{error}
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 rounded-lg transition text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={!isMatch || deleting}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white font-semibold py-2.5 rounded-lg transition text-sm flex items-center justify-center gap-2"
          >
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            {deleting ? "Scheduling…" : "Delete Account"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Utility ──────────────────────────────────────────────────────────────────────
function today(): string {
  return new Date().toISOString().split("T")[0];
}
