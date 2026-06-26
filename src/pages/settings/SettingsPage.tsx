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
  User, Package, FileText, Send, QrCode, Copy, Check, Upload, ClipboardList,
} from "lucide-react";
import QRCodeLib from "qrcode";
import { db, storage } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { downloadCSV } from "../../lib/csvExport";
import type { ServiceCenter, StaffMember, UserRole, PendingInvite, UpgradeRequest, PaymentSlipRequest } from "../../types/auth";
import { SRI_LANKA_DISTRICTS } from "../../types/auth";
import { useTranslation } from "react-i18next";

// ── Helpers ─────────────────────────────────────────────────────────────────────
type TabId = "profile" | "sms" | "reminders" | "staff" | "services" | "subscription" | "exports" | "danger";

const ownerOrManager = (role?: UserRole) => role === "Owner" || role === "Manager";
const ownerOnly = (role?: UserRole) => role === "Owner";

const TAB_IDS: { id: TabId; labelKey: string; ownerOnly: boolean }[] = [
  { id: "profile",      labelKey: "settings.tabs.profile",      ownerOnly: false },
  { id: "sms",          labelKey: "settings.tabs.sms",          ownerOnly: false },
  { id: "reminders",    labelKey: "settings.tabs.reminders",    ownerOnly: false },
  { id: "staff",        labelKey: "settings.tabs.staff",        ownerOnly: false },
  { id: "services",     labelKey: "settings.tabs.services",     ownerOnly: false },
  { id: "subscription", labelKey: "settings.tabs.subscription", ownerOnly: true },
  { id: "exports",      labelKey: "settings.tabs.exports",      ownerOnly: true },
  { id: "danger",       labelKey: "settings.tabs.danger",       ownerOnly: true },
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
  const { t } = useTranslation();

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
  // Manager sees only operational tabs; Owner-only tabs are hidden from Manager
  const visibleTabs = TAB_IDS.filter(tab => !tab.ownerOnly || ownerOnly(role));

  // Only Owner and Manager can access Settings
  if (role !== "Owner" && role !== "Manager") {
    return (
      <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <Shield className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-white mb-2">{t("settings.accessDenied")}</h2>
          <p className="text-sm text-gray-400">{t("settings.accessDeniedDesc")}</p>
        </div>
      </div>
    );
  }

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
          <h1 className="text-lg font-bold">{t("settings.title")}</h1>
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
                {t(tab.labelKey)}
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
          {activeTab === "services" && center && centerId && (
            <ServicesTab center={center} centerId={centerId} role={role} />
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
  const { t } = useTranslation();
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
    if (file.size > 2 * 1024 * 1024) { setSaveError(t("settings.profile.logoError2mb")); return; }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setSaveError(t("settings.profile.logoErrorType"));
      return;
    }
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
    setSaveError("");
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = t("settings.profile.nameRequired");
    else if (name.trim().length > 80) e.name = t("settings.profile.nameMax");
    if (!address.trim()) e.address = t("settings.profile.addressRequired");
    if (!phone.trim()) e.phone = t("settings.profile.phoneRequired");
    if (!district) e.district = t("settings.profile.districtRequired");
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
      setSaveError(t("settings.profile.saveError"));
    }
    setSaving(false);
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h2 className="text-base font-semibold text-white">{t("settings.profile.sectionTitle")}</h2>
        <p className="text-sm text-gray-400 mt-0.5">{t("settings.profile.subtitle")}</p>
      </div>

      {/* Logo */}
      <div className="bg-[#162032] border border-white/10 rounded-xl p-5">
        <label className="text-xs text-gray-400 block mb-3">{t("settings.profile.logoLabel")}</label>
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-xl border-2 border-dashed border-white/20 flex items-center justify-center overflow-hidden bg-white/5 flex-shrink-0">
            {logoPreview
              ? <img src={logoPreview} alt="Logo" className="w-full h-full object-contain" />
              : <Camera className="w-6 h-6 text-gray-500" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-500 mb-2">{t("settings.profile.logoHint")}</p>
            {editable && (
              <>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg transition"
                >
                  {logoPreview ? t("settings.profile.changeLogo") : t("settings.profile.uploadLogo")}
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
                <p className="text-xs text-gray-500 mt-1">{t("settings.profile.uploading", { percent: logoProgress })}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Fields */}
      <div className="bg-[#162032] border border-white/10 rounded-xl p-5 space-y-4">
        <FormField label={t("settings.profile.nameLabel")} error={errors.name} hint={t("settings.profile.nameHint")}>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={80}
            disabled={!editable}
            placeholder={t("settings.profile.namePlaceholder")}
            className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316] disabled:opacity-50"
          />
          <div className="text-right mt-1">
            <span className={`text-xs ${name.length > 72 ? "text-amber-400" : "text-gray-600"}`}>{name.length}/80</span>
          </div>
        </FormField>

        <FormField label={t("settings.profile.addressLabel")} error={errors.address} hint={t("settings.profile.addressHint")}>
          <textarea
            value={address}
            onChange={e => setAddress(e.target.value)}
            disabled={!editable}
            rows={3}
            placeholder={t("settings.profile.addressPlaceholder")}
            className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316] disabled:opacity-50 resize-none"
          />
        </FormField>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label={t("settings.profile.phoneLabel")} error={errors.phone} hint={t("settings.profile.phoneHint")}>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              disabled={!editable}
              placeholder={t("settings.profile.phonePlaceholder")}
              className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316] disabled:opacity-50"
            />
          </FormField>

          <FormField label={t("settings.profile.districtLabel")} error={errors.district}>
            <select
              value={district}
              onChange={e => setDistrict(e.target.value)}
              disabled={!editable}
              className="w-full bg-[#0B1120] border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316] disabled:opacity-50"
            >
              <option value="">{t("settings.profile.districtPlaceholder")}</option>
              {SRI_LANKA_DISTRICTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </FormField>
        </div>

        <FormField label={t("settings.profile.businessRegLabel")} hint={t("settings.profile.businessRegHint")}>
          <input
            type="text"
            value={businessReg}
            onChange={e => setBusinessReg(e.target.value)}
            disabled={!editable}
            placeholder={t("settings.profile.businessRegPlaceholder")}
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
            {saving ? t("settings.profile.saving") : t("settings.profile.save")}
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-green-400 text-sm">
              <CheckCircle className="w-4 h-4" />{t("settings.profile.saved")}
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
  const { t } = useTranslation();

  const quotaUsed = center.smsQuotaUsed ?? 0;
  const quotaLimit = center.smsQuotaLimit ?? (center.plan === "pro" ? 1000 : 200);
  const quotaPct = quotaLimit > 0 ? Math.round((quotaUsed / quotaLimit) * 100) : 0;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h2 className="text-base font-semibold text-white">{t("settings.sms.sectionTitle")}</h2>
        <p className="text-sm text-gray-400 mt-0.5">{t("settings.sms.subtitle")}</p>
      </div>

      {/* Quota */}
      <div className="bg-[#162032] border border-white/10 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-white">{t("settings.sms.monthlyQuota")}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold uppercase border ${
            center.plan === "pro"
              ? "bg-orange-500/20 text-orange-400 border-orange-500/30"
              : "bg-gray-500/20 text-gray-400 border-gray-500/30"
          }`}>
            {center.plan} plan
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-400">{t("settings.sms.usedThisMonth")}</span>
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
            {t("settings.sms.quotaReached")}
          </div>
        )}
        {quotaPct >= 80 && quotaPct < 100 && (
          <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg px-3 py-2 text-xs">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {t("settings.sms.quotaWarning", { percent: quotaPct })}
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
              <div className="text-sm font-medium text-white">{t("settings.sms.templatesTitle")}</div>
              <div className="text-xs text-gray-500">{t("settings.sms.templatesDesc")}</div>
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
              <div className="text-sm font-medium text-white">{t("settings.sms.logsTitle")}</div>
              <div className="text-xs text-gray-500">{t("settings.sms.logsDesc")}</div>
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
  const { t } = useTranslation();
  const editable = ownerOrManager(role);

  const [cooldownDays, setCooldownDays] = useState(String(center.reminderCooldownDays ?? 7));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const e: Record<string, string> = {};
    const days = parseInt(cooldownDays, 10);
    if (isNaN(days) || days < 1 || days > 60) e.cooldownDays = t("settings.reminders.cooldownError");
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "servicecenters", centerId), {
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
        <h2 className="text-base font-semibold text-white">{t("settings.reminders.sectionTitle")}</h2>
        <p className="text-sm text-gray-400 mt-0.5">{t("settings.reminders.subtitle")}</p>
      </div>

      <div className="bg-[#162032] border border-white/10 rounded-xl p-5 space-y-5">
        <FormField
          label={t("settings.reminders.cooldownLabel")}
          error={errors.cooldownDays}
          hint={t("settings.reminders.cooldownHint")}
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
            <span className="text-sm text-gray-400 whitespace-nowrap flex-shrink-0">{t("settings.reminders.cooldownUnit")}</span>
          </div>
          <p className="text-xs text-gray-600 mt-1">{t("settings.reminders.cooldownRange")}</p>
        </FormField>
      </div>

      <div className="flex items-start gap-3 bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3">
        <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-blue-300">
          <span className="font-semibold">{t("settings.reminders.sendingTimeLabel")}</span>{" "}
          {t("settings.reminders.sendingTimeDesc")}
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
            {saving ? t("settings.reminders.saving") : t("settings.reminders.save")}
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-green-400 text-sm">
              <CheckCircle className="w-4 h-4" />{t("settings.reminders.saved")}
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
  const { t } = useTranslation();
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
    if (!window.confirm(t("settings.staff.removeConfirm"))) return;
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
    if (!window.confirm(t("settings.staff.revokeConfirm"))) return;
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
          <h2 className="text-base font-semibold text-white">{t("settings.staff.sectionTitle")}</h2>
          <p className="text-sm text-gray-400 mt-0.5">{t("settings.staff.subtitle")}</p>
        </div>
        {isOwner && (
          <button
            onClick={() => setShowInvite(true)}
            className="flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white px-4 py-2 rounded-lg text-sm font-semibold transition flex-shrink-0"
          >
            <UserPlus className="w-4 h-4" />
            {t("settings.staff.invite")}
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
                {t("settings.staff.activeSection", { count: activeStaff.length })}
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
                          <span className="text-xs text-gray-500">{t("settings.staff.you")}</span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${ROLE_COLORS[member.role]}`}>
                          {member.role}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5 truncate">{member.email}</div>
                    </div>
                    <div className="hidden sm:block text-xs text-gray-500 flex-shrink-0">
                      {t("settings.staff.lastLogin")} {formatLastLogin(member.lastLoginAt)}
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
                              {processingId === member.id ? <Loader2 className="w-3 h-3 animate-spin" /> : t("settings.staff.save")}
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
                              {t("settings.staff.changeRole")}
                            </button>
                            <button
                              onClick={() => handleRemove(member.id)}
                              disabled={processingId === member.id}
                              className="text-xs text-red-400 hover:text-red-300 bg-red-500/5 hover:bg-red-500/10 border border-red-500/20 px-2.5 py-1.5 rounded-lg transition disabled:opacity-50"
                            >
                              {processingId === member.id ? <Loader2 className="w-3 h-3 animate-spin" /> : t("settings.staff.remove")}
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
                {t("settings.staff.pendingSection", { count: activeInvites.length })}
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
                            {t("settings.staff.pendingBadge")}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {t("settings.staff.expiresIn", { hours: hoursLeft })}
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
                            {t("settings.staff.resend")}
                          </button>
                          <button
                            onClick={() => handleRevokeInvite(invite.docId)}
                            disabled={processingId === invite.docId}
                            className="text-xs text-gray-400 hover:text-red-400 bg-white/5 hover:bg-red-500/5 border border-white/10 hover:border-red-500/20 px-2.5 py-1.5 rounded-lg transition disabled:opacity-50"
                          >
                            {t("settings.staff.revoke")}
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
                {t("settings.staff.inactiveSection", { count: inactiveStaff.length })}
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
                          {t("settings.staff.inactiveBadge")}
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
                          {t("settings.staff.reinvite")}
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
              <p className="text-sm text-gray-400">{t("settings.staff.noStaff")}</p>
              {isOwner && <p className="text-xs text-gray-600 mt-1">{t("settings.staff.noStaffHint")}</p>}
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
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("Technician");
  const [saving, setSaving] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function handleSend() {
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError(t("settings.inviteModal.invalidEmail"));
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
      const link = `${window.location.origin}/invite/${docRef.id}`;
      setInviteLink(link);
      const dataUrl = await QRCodeLib.toDataURL(link, {
        width: 220,
        margin: 2,
        color: { dark: "#FFFFFF", light: "#162032" },
      });
      setQrDataUrl(dataUrl);
    } catch {
      setError(t("settings.inviteModal.createError"));
    }
    setSaving(false);
  }

  async function handleCopy() {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#162032] border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">{t("settings.inviteModal.title")}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {inviteLink ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2 bg-green-500/10 border border-green-500/20 rounded-lg p-3 text-xs text-green-300">
              <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium mb-1">{t("settings.inviteModal.created")}</p>
                <p>{t("settings.inviteModal.scanInstruction", { email })}</p>
              </div>
            </div>

            {/* QR Code */}
            <div className="flex flex-col items-center gap-3 bg-[#0B1120] border border-white/10 rounded-xl p-5">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="Invite QR Code" className="w-44 h-44 rounded-lg" />
              ) : (
                <div className="w-44 h-44 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 text-[#F97316] animate-spin" />
                </div>
              )}
              <div className="text-center">
                <p className="text-xs text-gray-400">{t("settings.inviteModal.scanTo")} <span className="text-[#F97316] font-medium">{role}</span></p>
                <p className="text-xs text-gray-600 mt-0.5">{t("settings.inviteModal.orShareLink")}</p>
              </div>
            </div>

            {/* Link row */}
            <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
              <QrCode className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
              <p className="text-xs text-gray-400 break-all font-mono flex-1 min-w-0 truncate">{inviteLink}</p>
              <button
                onClick={handleCopy}
                className="flex-shrink-0 flex items-center gap-1 text-xs text-gray-400 hover:text-white transition"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>

            <button
              onClick={handleCopy}
              className="w-full bg-white/10 hover:bg-white/20 text-white text-sm font-medium py-2 rounded-lg transition flex items-center justify-center gap-2"
            >
              {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
              {copied ? t("settings.inviteModal.copied") : t("settings.inviteModal.copyLink")}
            </button>
            <button onClick={onClose} className="w-full text-gray-400 hover:text-gray-200 text-sm py-1 transition">
              {t("settings.inviteModal.done")}
            </button>
          </div>
        ) : (
          <>
            <FormField label={t("settings.inviteModal.emailLabel")} error={error}>
              <input
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(""); }}
                placeholder="staff@example.com"
                className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
              />
            </FormField>

            <FormField label={t("settings.inviteModal.roleLabel")}>
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
              {t("settings.inviteModal.qrNote")}
            </p>

            <div className="flex gap-3 pt-1">
              <button
                onClick={onClose}
                className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium py-2.5 rounded-lg transition text-sm"
              >
                {t("settings.inviteModal.cancel")}
              </button>
              <button
                onClick={handleSend}
                disabled={saving}
                className="flex-1 bg-[#F97316] hover:bg-[#ea6c0f] disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition text-sm flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {saving ? t("settings.inviteModal.creating") : t("settings.inviteModal.send")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Subscription Tab ─────────────────────────────────────────────────────────────
function SubscriptionTab({ center, centerId }: { center: ServiceCenter; centerId: string }) {
  const { t } = useTranslation();
  const quotaUsed = center.smsQuotaUsed ?? 0;
  const quotaLimit = center.smsQuotaLimit ?? (center.plan === "pro" ? 1000 : 200);
  const quotaPct = quotaLimit > 0 ? Math.round((quotaUsed / quotaLimit) * 100) : 0;

  const [codeCopied, setCodeCopied] = useState(false);
  const [showUpgradeForm, setShowUpgradeForm] = useState(false);
  const [upgradePeriod, setUpgradePeriod] = useState<"monthly" | "yearly">("monthly");
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipPreview, setSlipPreview] = useState<string | null>(null);
  const [upgradeNote, setUpgradeNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [existingRequest, setExistingRequest] = useState<UpgradeRequest | null>(null);
  const [upgradeHistory, setUpgradeHistory] = useState<UpgradeRequest[]>([]);
  const [payments, setPayments] = useState<{ id: string; amount: number; plan: string; period: string; status: string; paidAt?: Timestamp; notes?: string }[]>([]);
  const [viewSlip, setViewSlip] = useState<string | null>(null);
  const slipInputRef = useRef<HTMLInputElement>(null);

  // Monthly payment slip state
  const [showMonthlySlipForm, setShowMonthlySlipForm] = useState(false);
  const [monthlySlipFile, setMonthlySlipFile] = useState<File | null>(null);
  const [monthlySlipPreview, setMonthlySlipPreview] = useState<string | null>(null);
  const [monthlySlipNote, setMonthlySlipNote] = useState("");
  const [monthlySlipPeriod, setMonthlySlipPeriod] = useState<"monthly" | "yearly">("monthly");
  const [submittingSlip, setSubmittingSlip] = useState(false);
  const [slipRequests, setSlipRequests] = useState<PaymentSlipRequest[]>([]);
  const [pendingSlipRequest, setPendingSlipRequest] = useState<PaymentSlipRequest | null>(null);
  const monthlySlipInputRef = useRef<HTMLInputElement>(null);

  // Load upgrade request history and real payment records
  useEffect(() => {
    getDocs(
      query(
        collection(db, "upgradeRequests"),
        where("centerId", "==", centerId),
        orderBy("createdAt", "desc"),
      )
    ).then((snap) => {
      const requests = snap.docs.map((d) => ({ id: d.id, ...d.data() } as UpgradeRequest));
      setUpgradeHistory(requests);
      const pending = requests.find((r) => r.status === "pending");
      if (pending) setExistingRequest(pending);
    }).catch(() => {/* rules not yet deployed */});

    getDocs(
      query(
        collection(db, "servicecenters", centerId, "payments"),
        orderBy("createdAt", "desc"),
      )
    ).then((snap) => {
      setPayments(snap.docs.map((d) => ({ id: d.id, ...d.data() } as any)));
    }).catch(() => {/* rules not yet deployed */});

    getDocs(
      query(
        collection(db, "paymentSlipRequests"),
        where("centerId", "==", centerId),
        orderBy("createdAt", "desc"),
      )
    ).then((snap) => {
      const reqs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as PaymentSlipRequest));
      setSlipRequests(reqs);
      const pending = reqs.find((r) => r.status === "pending");
      if (pending) setPendingSlipRequest(pending);
    }).catch(() => {/* rules not yet deployed */});
  }, [centerId]);

  function handleSlipSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSlipFile(file);
    setSlipPreview(URL.createObjectURL(file));
  }

  async function submitUpgradeRequest() {
    if (!slipFile || !center.paymentCode) return;
    setSubmitting(true);
    try {
      const ext = slipFile.name.split(".").pop();
      const slipRef = storageRef(storage, `paymentSlips/${centerId}/${Date.now()}.${ext}`);
      const task = uploadBytesResumable(slipRef, slipFile);
      await new Promise<void>((resolve, reject) => {
        task.on("state_changed", null, reject, resolve);
      });
      const slipUrl = await getDownloadURL(slipRef);
      const amount = upgradePeriod === "yearly" ? 79990 : 7999;

      const { addDoc, collection: col, serverTimestamp } = await import("firebase/firestore");
      await addDoc(col(db, "upgradeRequests"), {
        centerId,
        centerName: center.name,
        paymentCode: center.paymentCode,
        requestedPlan: "pro",
        period: upgradePeriod,
        amount,
        slipUrl,
        notes: upgradeNote || null,
        status: "pending",
        createdAt: serverTimestamp(),
      });
      setSubmitted(true);
      setShowUpgradeForm(false);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitMonthlyPaymentSlip() {
    if (!monthlySlipFile || !center.paymentCode) return;
    setSubmittingSlip(true);
    try {
      const ext = monthlySlipFile.name.split(".").pop();
      const slipRef = storageRef(storage, `paymentSlips/${centerId}/monthly/${Date.now()}.${ext}`);
      const task = uploadBytesResumable(slipRef, monthlySlipFile);
      await new Promise<void>((resolve, reject) => { task.on("state_changed", null, reject, resolve); });
      const slipUrl = await getDownloadURL(slipRef);
      const amount = center.plan === "pro"
        ? (monthlySlipPeriod === "yearly" ? 79990 : 7999)
        : (monthlySlipPeriod === "yearly" ? 59990 : 4999);

      const { addDoc, collection: col, serverTimestamp } = await import("firebase/firestore");
      const ref = await addDoc(col(db, "paymentSlipRequests"), {
        centerId,
        centerName: center.name,
        paymentCode: center.paymentCode,
        plan: center.plan,
        period: monthlySlipPeriod,
        amount,
        slipUrl,
        notes: monthlySlipNote || null,
        status: "pending",
        createdAt: serverTimestamp(),
      });
      const newReq: PaymentSlipRequest = {
        id: ref.id,
        centerId,
        centerName: center.name,
        paymentCode: center.paymentCode,
        plan: center.plan,
        period: monthlySlipPeriod,
        amount,
        slipUrl,
        notes: monthlySlipNote || undefined,
        status: "pending",
        createdAt: { seconds: Date.now() / 1000 } as Timestamp,
      };
      setSlipRequests((prev) => [newReq, ...prev]);
      setPendingSlipRequest(newReq);
      setShowMonthlySlipForm(false);
      setMonthlySlipFile(null);
      setMonthlySlipPreview(null);
      setMonthlySlipNote("");
    } finally {
      setSubmittingSlip(false);
    }
  }

  const payCode = center.paymentCode ?? "—";

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h2 className="text-base font-semibold text-white">{t("settings.subscription.sectionTitle")}</h2>
        <p className="text-sm text-gray-400 mt-0.5">{t("settings.subscription.subtitle")}</p>
      </div>

      {/* Payment Reference Code */}
      <div className="bg-[#162032] border border-white/10 rounded-xl p-5">
        <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">{t("settings.subscription.paymentRefCode")}</div>
        <div className="flex items-center gap-3">
          <span className="text-2xl font-mono font-bold text-orange-400 tracking-widest">{payCode}</span>
          <button
            onClick={() => { navigator.clipboard.writeText(payCode); setCodeCopied(true); setTimeout(() => setCodeCopied(false), 2000); }}
            className="text-gray-400 hover:text-white transition-colors"
          >
            {codeCopied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">{t("settings.subscription.paymentRefHint")}</p>
      </div>

      {/* Monthly Payment Slip */}
      <div className="bg-[#162032] border border-white/10 rounded-xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-white">{t("settings.subscription.submitMonthly")}</div>
            <p className="text-xs text-gray-400 mt-0.5">{t("settings.subscription.submitMonthlyDesc")}</p>
          </div>
          {!pendingSlipRequest && !showMonthlySlipForm && (
            <button
              onClick={() => setShowMonthlySlipForm(true)}
              className="flex items-center gap-1.5 text-xs font-medium bg-orange-500/15 hover:bg-orange-500/25 text-orange-400 px-3 py-1.5 rounded-lg transition flex-shrink-0"
            >
              <Upload className="w-3.5 h-3.5" />
              {t("settings.subscription.uploadSlip")}
            </button>
          )}
        </div>

        {pendingSlipRequest ? (
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-green-300">{t("settings.subscription.slipSubmitted")}</p>
              <p className="text-xs text-gray-400 mt-0.5">{t("settings.subscription.slipSubmittedDesc")}</p>
              {pendingSlipRequest.slipUrl && (
                <button
                  onClick={() => setViewSlip(pendingSlipRequest.slipUrl!)}
                  className="mt-1.5 flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300 transition-colors"
                >
                  <FileText className="w-3 h-3" /> {t("settings.subscription.viewSlip")}
                </button>
              )}
            </div>
          </div>
        ) : showMonthlySlipForm ? (
          <div className="bg-black/20 border border-white/10 rounded-xl p-4 space-y-4">
            <div className="space-y-1">
              <label className="text-xs text-gray-400">{t("settings.subscription.billingPeriod")}</label>
              <select
                value={monthlySlipPeriod}
                onChange={(e) => setMonthlySlipPeriod(e.target.value as "monthly" | "yearly")}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
              >
                <option value="monthly">Monthly — LKR {center.plan === "pro" ? "7,999" : "4,999"}</option>
                <option value="yearly">Yearly — LKR {center.plan === "pro" ? "79,990" : "59,990"}</option>
              </select>
            </div>

            <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3 text-xs text-gray-300 space-y-1">
              <p className="font-medium text-orange-300">{t("settings.subscription.paymentInstructions")}</p>
              <p>1. Transfer <strong>LKR {monthlySlipPeriod === "yearly" ? (center.plan === "pro" ? "79,990" : "59,990") : (center.plan === "pro" ? "7,999" : "4,999")}</strong> to the PitStopIQ bank account.</p>
              <p>2. Use <strong className="text-orange-300 font-mono">{payCode}</strong> as the payment reference.</p>
              <p>3. Upload the bank slip below and submit.</p>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-gray-400">{t("settings.subscription.uploadSlipLabel")}</label>
              <input ref={monthlySlipInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setMonthlySlipFile(f);
                setMonthlySlipPreview(URL.createObjectURL(f));
              }} />
              {monthlySlipPreview ? (
                <div className="relative">
                  <img src={monthlySlipPreview} alt="slip" className="w-full max-h-48 object-contain rounded-lg border border-gray-700" />
                  <button
                    onClick={() => { setMonthlySlipFile(null); setMonthlySlipPreview(null); }}
                    className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white rounded-full p-1 transition"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => monthlySlipInputRef.current?.click()}
                  className="w-full border-2 border-dashed border-gray-700 hover:border-orange-500/50 rounded-lg p-6 text-center text-sm text-gray-500 hover:text-gray-300 transition"
                >
                  <Camera className="w-6 h-6 mx-auto mb-2 opacity-50" />
                  {t("settings.subscription.clickUpload")}
                </button>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-xs text-gray-400">{t("settings.subscription.noteLabel")}</label>
              <input
                value={monthlySlipNote}
                onChange={(e) => setMonthlySlipNote(e.target.value)}
                placeholder={t("settings.subscription.notePlaceholder")}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={submitMonthlyPaymentSlip}
                disabled={submittingSlip || !monthlySlipFile}
                className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white text-sm font-semibold py-2.5 rounded-lg transition flex items-center justify-center gap-2"
              >
                {submittingSlip ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {submittingSlip ? t("settings.subscription.submitting") : t("settings.subscription.submitSlip")}
              </button>
              <button
                onClick={() => { setShowMonthlySlipForm(false); setMonthlySlipFile(null); setMonthlySlipPreview(null); }}
                className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-medium py-2.5 rounded-lg transition"
              >
                {t("settings.subscription.cancel")}
              </button>
            </div>
          </div>
        ) : null}

        {/* Previous slip requests */}
        {slipRequests.filter((r) => r.status !== "pending").length > 0 && (
          <div className="divide-y divide-white/5 border-t border-white/5 pt-3 space-y-0">
            {slipRequests.filter((r) => r.status !== "pending").map((r) => (
              <div key={r.id} className="py-2 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-gray-300">
                    LKR {r.amount.toLocaleString()} · {r.plan.toUpperCase()} · {r.period}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {r.createdAt ? new Date((r.createdAt as Timestamp).seconds * 1000).toLocaleDateString() : "—"}
                  </p>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${
                  r.status === "confirmed" ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
                }`}>
                  {r.status === "confirmed" ? t("settings.subscription.confirmed") : t("settings.subscription.rejected")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Current Plan */}
      <div className="bg-[#162032] border border-white/10 rounded-xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">{t("settings.subscription.currentPlan")}</div>
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
            {t("settings.subscription.active")}
          </span>
        </div>
      </div>

      {/* SMS Usage */}
      <div className="bg-[#162032] border border-white/10 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-white">{t("settings.subscription.smsUsage")}</span>
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
          <span>{t("settings.subscription.pctUsed", { percent: quotaPct })}</span>
          <span>{t("settings.subscription.smsRemaining", { count: Math.max(0, quotaLimit - quotaUsed).toLocaleString() })}</span>
        </div>
      </div>

      {/* Upgrade to Pro */}
      {center.plan === "basic" && (
        <div className="bg-gradient-to-br from-orange-500/10 to-amber-500/5 border border-orange-500/20 rounded-xl p-5 space-y-4">
          <div>
            <div className="text-sm font-semibold text-white mb-1">{t("settings.subscription.upgradePro")}</div>
            <p className="text-xs text-gray-400">{t("settings.subscription.upgradeProDesc")}</p>
          </div>

          {submitted || existingRequest ? (
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-green-300">{t("settings.subscription.upgradeSubmitted")}</p>
                <p className="text-xs text-gray-400 mt-0.5">{t("settings.subscription.upgradeSubmittedDesc")}</p>
              </div>
            </div>
          ) : !showUpgradeForm ? (
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => { setShowUpgradeForm(true); setUpgradePeriod("monthly"); }}
                className="flex-1 bg-[#F97316] hover:bg-[#ea6c0f] text-white text-sm font-semibold py-2.5 rounded-lg transition"
              >
                {t("settings.subscription.requestMonthly")}
              </button>
              <button
                onClick={() => { setShowUpgradeForm(true); setUpgradePeriod("yearly"); }}
                className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-medium py-2.5 rounded-lg transition flex items-center justify-center gap-1"
              >
                {t("settings.subscription.requestYearly")}
                <span className="text-xs text-green-400 font-semibold">{t("settings.subscription.saveYearly")}</span>
              </button>
            </div>
          ) : (
            <div className="bg-black/20 border border-white/10 rounded-xl p-4 space-y-4">
              <div className="text-sm font-medium text-white">
                {upgradePeriod === "yearly" ? t("settings.subscription.yearlyPro") : t("settings.subscription.monthlyPro")}
              </div>

              {/* Payment instructions */}
              <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3 text-xs text-gray-300 space-y-1">
                <p className="font-medium text-orange-300">{t("settings.subscription.paymentInstructions")}</p>
                <p>1. Transfer <strong>{upgradePeriod === "yearly" ? "LKR 79,990" : "LKR 7,999"}</strong> to the PitStopIQ bank account.</p>
                <p>2. Use <strong className="text-orange-300 font-mono">{payCode}</strong> as the payment reference.</p>
                <p>3. Upload the bank slip below and submit.</p>
              </div>

              {/* Period selector */}
              <div className="space-y-1">
                <label className="text-xs text-gray-400">{t("settings.subscription.billingPeriod")}</label>
                <select
                  value={upgradePeriod}
                  onChange={(e) => setUpgradePeriod(e.target.value as "monthly" | "yearly")}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                >
                  <option value="monthly">Monthly — LKR 7,999</option>
                  <option value="yearly">Yearly — LKR 79,990 (Save 17%)</option>
                </select>
              </div>

              {/* Slip upload */}
              <div className="space-y-2">
                <label className="text-xs text-gray-400">{t("settings.subscription.uploadSlipLabel")}</label>
                <input ref={slipInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleSlipSelect} />
                {slipPreview ? (
                  <div className="relative">
                    <img src={slipPreview} alt="slip" className="w-full max-h-48 object-contain rounded-lg border border-gray-700" />
                    <button
                      onClick={() => { setSlipFile(null); setSlipPreview(null); }}
                      className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white rounded-full p-1 transition"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => slipInputRef.current?.click()}
                    className="w-full border-2 border-dashed border-gray-700 hover:border-orange-500/50 rounded-lg p-6 text-center text-sm text-gray-500 hover:text-gray-300 transition"
                  >
                    <Camera className="w-6 h-6 mx-auto mb-2 opacity-50" />
                    {t("settings.subscription.clickUpload")}
                  </button>
                )}
              </div>

              {/* Optional note */}
              <div className="space-y-1">
                <label className="text-xs text-gray-400">{t("settings.subscription.noteLabel")}</label>
                <input
                  value={upgradeNote}
                  onChange={(e) => setUpgradeNote(e.target.value)}
                  placeholder={t("settings.subscription.notePlaceholder")}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={submitUpgradeRequest}
                  disabled={submitting || !slipFile}
                  className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white text-sm font-semibold py-2.5 rounded-lg transition flex items-center justify-center gap-2"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {submitting ? t("settings.subscription.submitting") : t("settings.subscription.submitRequest")}
                </button>
                <button
                  onClick={() => { setShowUpgradeForm(false); setSlipFile(null); setSlipPreview(null); }}
                  className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-medium py-2.5 rounded-lg transition"
                >
                  {t("settings.subscription.cancel")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Upgrade Request History */}
      {upgradeHistory.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-white mb-3">{t("settings.subscription.upgradeRequests")}</h3>
          <div className="bg-[#162032] border border-white/10 rounded-xl overflow-hidden divide-y divide-white/5">
            {upgradeHistory.map((req) => (
              <div key={req.id} className="p-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">
                    {req.period === "yearly" ? t("settings.subscription.proPlanYearly") : t("settings.subscription.proPlanMonthly")}
                    <span className="text-gray-400 ml-2 font-normal">LKR {req.amount.toLocaleString()}</span>
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {req.createdAt ? new Date((req.createdAt as Timestamp).seconds * 1000).toLocaleDateString() : "—"}
                    {req.notes ? ` · ${req.notes}` : ""}
                  </p>
                  {req.slipUrl && (
                    <button
                      onClick={() => setViewSlip(req.slipUrl!)}
                      className="mt-1.5 flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300 transition-colors"
                    >
                      <FileText className="w-3 h-3" />
                      {t("settings.subscription.viewPaymentSlip")}
                    </button>
                  )}
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${
                  req.status === "approved" ? "bg-green-500/15 text-green-400" :
                  req.status === "rejected" ? "bg-red-500/15 text-red-400" :
                  "bg-amber-500/15 text-amber-400"
                }`}>
                  {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Payment History */}
      <div>
        <h3 className="text-sm font-semibold text-white mb-3">{t("settings.subscription.paymentHistory")}</h3>
        {payments.length === 0 ? (
          <div className="bg-[#162032] border border-white/10 rounded-xl p-6 text-center">
            <CreditCard className="w-10 h-10 text-gray-600 mx-auto mb-2" />
            <p className="text-sm text-gray-400">{t("settings.subscription.noPayments")}</p>
            <p className="text-xs text-gray-600 mt-1">{t("settings.subscription.noPaymentsDesc")}</p>
          </div>
        ) : (
          <div className="bg-[#162032] border border-white/10 rounded-xl overflow-hidden divide-y divide-white/5">
            {payments.map((p) => (
              <div key={p.id} className="px-4 py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">
                    LKR {p.amount.toLocaleString()}
                    <span className="text-gray-400 text-xs ml-2 font-normal">{p.plan.toUpperCase()} · {p.period}</span>
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {p.paidAt ? new Date((p.paidAt as Timestamp).seconds * 1000).toLocaleDateString() : "—"}
                    {p.notes ? ` · ${p.notes}` : ""}
                  </p>
                </div>
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 flex-shrink-0">
                  {t("settings.subscription.paid")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cancel Subscription (Pro only) */}
      {center.plan === "pro" && (
        <div>
          <h3 className="text-sm font-semibold text-white mb-3">{t("settings.subscription.cancelSub")}</h3>
          <div className="bg-[#162032] border border-white/10 rounded-xl p-5">
            <p className="text-sm text-gray-400 mb-4">
              {t("settings.subscription.cancelSubDesc")}
            </p>
            <button
              onClick={() => alert("To cancel your subscription, please contact support. Cancellation flow will be available in a future update.")}
              className="text-sm text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500/50 px-4 py-2 rounded-lg transition"
            >
              {t("settings.subscription.cancelSubBtn")}
            </button>
          </div>
        </div>
      )}

      {/* Slip viewer modal */}
      {viewSlip && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setViewSlip(null)}
        >
          <div className="relative max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setViewSlip(null)}
              className="absolute -top-10 right-0 text-white/60 hover:text-white text-sm flex items-center gap-1"
            >
              <X className="w-4 h-4" /> {t("settings.subscription.close")}
            </button>
            {viewSlip.includes(".pdf") || viewSlip.includes("application%2Fpdf") ? (
              <div className="bg-[#162032] border border-white/10 rounded-xl p-6 text-center space-y-4">
                <FileText className="w-12 h-12 text-orange-400 mx-auto" />
                <p className="text-white text-sm">{t("settings.subscription.pdfSlip")}</p>
                <a
                  href={viewSlip}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
                >
                  <ExternalLink className="w-4 h-4" /> {t("settings.subscription.openPdf")}
                </a>
              </div>
            ) : (
              <>
                <img src={viewSlip} alt="payment slip" className="w-full rounded-xl shadow-2xl" />
                <a
                  href={viewSlip}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 flex items-center justify-center gap-2 text-xs text-orange-400 hover:text-orange-300"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> {t("settings.subscription.openFullSize")}
                </a>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Exports Tab ──────────────────────────────────────────────────────────────────
function ExportsTab({ centerId, plan }: { centerId: string; plan?: string }) {
  const { t } = useTranslation();
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
        <h2 className="text-base font-semibold text-white">{t("settings.exports.sectionTitle")}</h2>
        <p className="text-sm text-gray-400 mt-0.5">{t("settings.exports.subtitle")}</p>
      </div>

      <div className="space-y-3">
        <ExportCard
          icon={<User className="w-4 h-4 text-blue-400" />}
          iconBg="bg-blue-500/10"
          title={t("settings.exports.customers")}
          description={t("settings.exports.customersDesc")}
          onExport={exportCustomers}
          exporting={exporting === "customers"}
          exportingLabel={t("settings.exports.exporting")}
          exportCsvLabel={t("settings.exports.exportCsv")}
        />

        <ExportCard
          icon={<FileText className="w-4 h-4 text-green-400" />}
          iconBg="bg-green-500/10"
          title={t("settings.exports.vehicles")}
          description={t("settings.exports.vehiclesDesc")}
          onExport={exportVehicles}
          exporting={exporting === "vehicles"}
          exportingLabel={t("settings.exports.exporting")}
          exportCsvLabel={t("settings.exports.exportCsv")}
        />

        <ExportCardWithDateRange
          icon={<FileText className="w-4 h-4 text-[#F97316]" />}
          iconBg="bg-orange-500/10"
          title={t("settings.exports.services")}
          description={t("settings.exports.servicesDesc")}
          dateRange={dateRanges.services}
          onFromChange={v => setRange("services", "from", v)}
          onToChange={v => setRange("services", "to", v)}
          onExport={exportServices}
          exporting={exporting === "services"}
          exportingLabel={t("settings.exports.exporting")}
          exportCsvLabel={t("settings.exports.exportCsv")}
          fromLabel={t("settings.exports.from")}
          toLabel={t("settings.exports.to")}
        />

        <ExportCardWithDateRange
          icon={<CreditCard className="w-4 h-4 text-purple-400" />}
          iconBg="bg-purple-500/10"
          title={t("settings.exports.invoices")}
          description={t("settings.exports.invoicesDesc")}
          dateRange={dateRanges.invoices}
          onFromChange={v => setRange("invoices", "from", v)}
          onToChange={v => setRange("invoices", "to", v)}
          onExport={exportInvoices}
          exporting={exporting === "invoices"}
          exportingLabel={t("settings.exports.exporting")}
          exportCsvLabel={t("settings.exports.exportCsv")}
          fromLabel={t("settings.exports.from")}
          toLabel={t("settings.exports.to")}
        />

        <ExportCardWithDateRange
          icon={<MessageSquare className="w-4 h-4 text-amber-400" />}
          iconBg="bg-amber-500/10"
          title={t("settings.exports.smsLog")}
          description={t("settings.exports.smsLogDesc")}
          dateRange={dateRanges.sms}
          onFromChange={v => setRange("sms", "from", v)}
          onToChange={v => setRange("sms", "to", v)}
          onExport={exportSmsLog}
          exporting={exporting === "sms"}
          exportingLabel={t("settings.exports.exporting")}
          exportCsvLabel={t("settings.exports.exportCsv")}
          fromLabel={t("settings.exports.from")}
          toLabel={t("settings.exports.to")}
        />

        <div className={!isPro ? "opacity-50 pointer-events-none" : ""}>
          <ExportCard
            icon={<Package className="w-4 h-4 text-cyan-400" />}
            iconBg="bg-cyan-500/10"
            title={t("settings.exports.inventory")}
            description={t("settings.exports.inventoryDesc")}
            badge={!isPro ? "PRO" : undefined}
            onExport={exportInventory}
            exporting={exporting === "inventory"}
            exportingLabel={t("settings.exports.exporting")}
            exportCsvLabel={t("settings.exports.exportCsv")}
          />
        </div>
      </div>
    </div>
  );
}

function ExportCard({ icon, iconBg, title, description, badge, onExport, exporting, exportingLabel, exportCsvLabel }: {
  icon: React.ReactNode; iconBg: string; title: string; description: string;
  badge?: string; onExport: () => void; exporting: boolean; exportingLabel: string; exportCsvLabel: string;
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
        {exporting ? exportingLabel : exportCsvLabel}
      </button>
    </div>
  );
}

function ExportCardWithDateRange({ icon, iconBg, title, description, dateRange, onFromChange, onToChange, onExport, exporting, exportingLabel, exportCsvLabel, fromLabel, toLabel }: {
  icon: React.ReactNode; iconBg: string; title: string; description: string;
  dateRange: { from: string; to: string };
  onFromChange: (v: string) => void; onToChange: (v: string) => void;
  onExport: () => void; exporting: boolean; exportingLabel: string; exportCsvLabel: string; fromLabel: string; toLabel: string;
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
          {exporting ? exportingLabel : exportCsvLabel}
        </button>
      </div>
      <div className="flex items-center gap-2 pl-14">
        <div className="flex items-center gap-2 flex-1">
          <label className="text-xs text-gray-500 whitespace-nowrap">{fromLabel}</label>
          <input
            type="date"
            value={dateRange.from}
            onChange={e => onFromChange(e.target.value)}
            className="flex-1 bg-white/5 border border-white/10 text-white rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-[#F97316]"
          />
        </div>
        <div className="flex items-center gap-2 flex-1">
          <label className="text-xs text-gray-500 whitespace-nowrap">{toLabel}</label>
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
  const { t } = useTranslation();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const isDeletionScheduled = !!center.deletionScheduledAt;

  async function handleCancelDeletion() {
    if (!window.confirm(t("settings.danger.cancelDeletionConfirm"))) return;
    await updateDoc(doc(db, "servicecenters", centerId), {
      isDeleted: false,
      deletionScheduledAt: null,
    });
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h2 className="text-base font-semibold text-red-400">{t("settings.danger.sectionTitle")}</h2>
        <p className="text-sm text-gray-400 mt-0.5">{t("settings.danger.subtitle")}</p>
      </div>

      {isDeletionScheduled ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-5 space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-red-300 mb-1">{t("settings.danger.deletionScheduled")}</div>
              <p className="text-xs text-gray-400 leading-relaxed">
                {t("settings.danger.deletionScheduledDesc")}
              </p>
            </div>
          </div>
          <button
            onClick={handleCancelDeletion}
            className="bg-white/10 hover:bg-white/20 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            {t("settings.danger.cancelDeletion")}
          </button>
        </div>
      ) : (
        <div className="bg-[#162032] border border-red-500/20 rounded-xl p-5">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-red-500/10 rounded-lg flex items-center justify-center flex-shrink-0">
              <Trash2 className="w-5 h-5 text-red-400" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-white mb-1">{t("settings.danger.deleteCenterTitle")}</div>
              <p className="text-xs text-gray-400 leading-relaxed mb-4">
                {t("settings.danger.deleteCenterDesc")}
              </p>
              <button
                onClick={() => setShowDeleteModal(true)}
                className="flex items-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 text-sm font-medium px-4 py-2 rounded-lg transition"
              >
                <Trash2 className="w-4 h-4" />
                {t("settings.danger.deleteAccount")}
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
  const { t } = useTranslation();
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const isMatch = confirmText.trim() === centerName.trim();

  async function handleDelete() {
    if (!isMatch) { setError(t("settings.danger.nameNoMatch")); return; }
    setDeleting(true);
    setError("");
    try {
      await updateDoc(doc(db, "servicecenters", centerId), {
        isDeleted: true,
        deletionScheduledAt: Timestamp.now(),
      });
      navigate("/", { replace: true });
    } catch {
      setError(t("settings.danger.deleteError"));
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
            <h3 className="text-base font-semibold text-red-300">{t("settings.danger.deleteModalTitle")}</h3>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-red-300 leading-relaxed">
          {t("settings.danger.deleteModalWarning", { centerName })}
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-1.5">
            {t("settings.danger.typeToConfirm", { centerName })}
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
            {t("common.cancel")}
          </button>
          <button
            onClick={handleDelete}
            disabled={!isMatch || deleting}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white font-semibold py-2.5 rounded-lg transition text-sm flex items-center justify-center gap-2"
          >
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            {deleting ? t("settings.danger.scheduling") : t("settings.danger.deleteAccount")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Services Tab ─────────────────────────────────────────────────────────────────
function ServicesTab({ center, centerId, role }: {
  center: ServiceCenter; centerId: string; role?: UserRole;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const editable = ownerOrManager(role);
  const isPro = center.plan === "pro";

  async function toggleInspection() {
    if (!editable || !isPro) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "servicecenters", centerId), {
        inspectionEnabled: !center.inspectionEnabled,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-bold text-white mb-1">Services & Modules</h2>
        <p className="text-sm text-gray-400">Configure optional modules for your service center.</p>
      </div>

      {/* Vehicle Inspection */}
      <div className="bg-[#162032] border border-white/10 rounded-xl p-5 space-y-4">
        <div className="flex items-start gap-3">
          <ClipboardList className="w-5 h-5 text-[#F97316] flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-white">Vehicle Inspection</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Conduct a 5-point pre-service inspection (condition, fuel, checklist, damage photos) linked to each job.
                </p>
              </div>
              {isPro && editable ? (
                <button
                  onClick={toggleInspection}
                  disabled={saving}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
                    center.inspectionEnabled ? "bg-[#F97316]" : "bg-white/10"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${
                      center.inspectionEnabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              ) : (
                <span className={`text-xs px-2 py-1 rounded-full border ${
                  center.inspectionEnabled
                    ? "bg-green-500/20 text-green-300 border-green-500/30"
                    : "bg-white/5 text-gray-500 border-white/10"
                }`}>
                  {center.inspectionEnabled ? "Enabled" : "Disabled"}
                </span>
              )}
            </div>
            {!isPro && (
              <div className="mt-3 flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                Vehicle Inspection is a Pro-only feature. Upgrade your plan to enable it.
              </div>
            )}
            {saved && (
              <p className="text-xs text-green-400 mt-2 flex items-center gap-1">
                <CheckCircle className="w-3.5 h-3.5" /> Saved
              </p>
            )}
          </div>
        </div>
        <div className="border-t border-white/5 pt-3 text-xs text-gray-500 space-y-1">
          <p>• Prompted automatically after a new job is created (can be skipped)</p>
          <p>• Damage photos are auto-deleted from storage after 30 days</p>
          <p>• Inspection results are visible on the job detail page</p>
        </div>
      </div>
    </div>
  );
}

// ── Utility ──────────────────────────────────────────────────────────────────────
function today(): string {
  return new Date().toISOString().split("T")[0];
}
