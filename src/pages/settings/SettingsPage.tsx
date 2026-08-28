import { useEffect, useState, useRef, Suspense } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { lazyWithRetry } from "../../lib/lazyWithRetry";
import {
  collection, query, where, getDocs, doc,
  onSnapshot, orderBy, Timestamp,
} from "firebase/firestore";
import { safeUpdateDoc, safeAddDoc } from "../../lib/firestoreWrite";
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import {
  MessageSquare, Users, CreditCard, Download,
  AlertTriangle, Camera, CheckCircle, X, UserPlus, ExternalLink,
  Info, Trash2, ChevronRight, Shield, Loader2,
  User, Package, FileText, Send, Copy, Check, Upload, ClipboardList,
  Eye, EyeOff, Lock, Landmark, CalendarClock, Store, Truck, Building2, Printer,
} from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { db, storage, functions } from "../../config/firebase";
import { useAuth } from "../../contexts/AuthContext";
import { usePermission } from "../../contexts/PermissionsContext";
import { downloadCSV } from "../../lib/csvExport";
import {
  BANK_ACCOUNT, nextMonthlyPaymentDate, monthsPaidFromPayments,
  STORE_ADDON_PRICE, STORE_ADDON_LABEL, storeAddonsMonthlyTotal,
  SMS_PACKAGE_PRICE, SMS_PACKAGE_LABEL, SMS_PACKAGE_QUOTA, SMS_PACKAGE_PER_SMS,
  smsPackageSubscriptionsMonthlyTotal, BRANCH_PRICE,
} from "../../lib/subscription";
import type {
  ServiceCenter, StaffMember, UserRole, UpgradeRequest, PaymentSlipRequest,
  StoreAddonKey, StoreAddonRequest, SmsPackageKey, SmsPackageRequest, SmsPackageBillingType,
  BranchRequest,
} from "../../types/auth";
import { SRI_LANKA_DISTRICTS } from "../../types/auth";
import { useTranslation } from "react-i18next";
import { LoadingBlock } from "../../components/LoadingProgress";
import { jobTechnicianNames, type TechnicianNameFields } from "../../lib/jobTechnicians";
import { logAuditEvent } from "../../lib/auditLog";
import {
  DEFAULT_WEEKLY_HOURS, DEFAULT_SLOT_DURATION_MINUTES,
} from "../../lib/scheduling";
import type { DayKey, DayHours, WeeklyHours, CalendarOverrides } from "../../types/auth";
import { poyaDaysForYear } from "../../lib/sriLankaHolidays";
import {
  PAPER_SIZES, PAPER_SIZE_ORDER, PAPER_LIMITS, CUSTOM_PAPER_DEFAULTS,
  DEFAULT_PAPER_SIZE, resolvePaper, contentWidthMm,
} from "../../lib/printPaper";
import type { PaperSizeKey, InvoicePaperSettings } from "../../lib/printPaper";
import { CalendarOff, CalendarPlus, Sun } from "lucide-react";

// ── Helpers ─────────────────────────────────────────────────────────────────────
type TabId = "profile" | "sms" | "reminders" | "staff" | "services" | "printing" | "workingHours" | "subscription" | "exports" | "danger" | "rolePermissions";

const ownerOnly = (role?: UserRole) => role === "Owner";

const TAB_IDS: { id: TabId; labelKey: string; ownerOnly: boolean }[] = [
  { id: "profile",      labelKey: "settings.tabs.profile",      ownerOnly: false },
  { id: "sms",          labelKey: "settings.tabs.sms",          ownerOnly: false },
  { id: "reminders",    labelKey: "settings.tabs.reminders",    ownerOnly: false },
  { id: "staff",        labelKey: "settings.tabs.staff",        ownerOnly: false },
  { id: "services",     labelKey: "settings.tabs.services",     ownerOnly: false },
  { id: "printing",     labelKey: "settings.tabs.printing",     ownerOnly: false },
  { id: "workingHours",    labelKey: "settings.tabs.workingHours",    ownerOnly: true },
  { id: "subscription",    labelKey: "settings.tabs.subscription",    ownerOnly: true },
  { id: "exports",         labelKey: "settings.tabs.exports",         ownerOnly: true },
  { id: "rolePermissions", labelKey: "settings.tabs.rolePermissions", ownerOnly: true },
  { id: "danger",          labelKey: "settings.tabs.danger",          ownerOnly: true },
];

const ROLE_COLORS: Record<UserRole, string> = {
  Owner:        "bg-orange-500/20 text-orange-300 border-orange-500/30",
  Manager:      "bg-blue-500/20 text-blue-300 border-blue-500/30",
  Technician:   "bg-green-500/20 text-green-300 border-green-500/30",
  Cashier:      "bg-purple-500/20 text-purple-300 border-purple-500/30",
  Receptionist: "bg-gray-500/20 text-gray-300 border-gray-500/30",
};

const ALL_ROLES: UserRole[] = ["Owner", "Manager", "Technician", "Cashier", "Receptionist"];

function generateStaffPassword(fullName: string, phone: string): string {
  const firstName = fullName.trim().split(" ")[0].toLowerCase().replace(/[^a-z]/g, "") || "staff";
  const lastFour = phone.replace(/\D/g, "").slice(-4) || "1234";
  return `${firstName}${lastFour}`;
}

function validateStaffPhone(phone: string): boolean {
  return /^(07\d{8}|\+947\d{8})$/.test(phone);
}

function staffLoginUsername(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("94")) return `0${digits.slice(2)}`;
  if (digits.startsWith("7") && digits.length === 9) return `0${digits}`;
  return digits;
}

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
      <PageHeader
        icon={<Shield className="w-5 h-5" />}
        title={t("settings.title")}
        below={
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
        }
      />

      {/* Content */}
      {loading ? (
        <LoadingBlock className="pt-24 pb-12" />
      ) : (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {activeTab === "profile" && center && centerId && (
            <ProfileTab center={center} centerId={centerId} />
          )}
          {activeTab === "sms" && center && centerId && (
            <SmsTab center={center} centerId={centerId} role={role} />
          )}
          {activeTab === "reminders" && center && centerId && (
            <RemindersTab center={center} centerId={centerId} />
          )}
          {activeTab === "staff" && centerId && (
            <StaffTab centerId={centerId} role={role} currentUid={currentUser?.uid} plan={center?.plan} />
          )}
          {activeTab === "services" && center && centerId && (
            <ServicesTab center={center} centerId={centerId} />
          )}
          {activeTab === "printing" && center && centerId && (
            <PrintingTab center={center} centerId={centerId} />
          )}
          {activeTab === "workingHours" && center && centerId && ownerOnly(role) && (
            <WorkingHoursTab center={center} centerId={centerId} />
          )}
          {activeTab === "subscription" && center && centerId && ownerOnly(role) && (
            <SubscriptionTab center={center} centerId={centerId} />
          )}
          {activeTab === "exports" && centerId && ownerOnly(role) && (
            <ExportsTab centerId={centerId} plan={center?.plan} />
          )}
          {activeTab === "rolePermissions" && ownerOnly(role) && (
            <RolePermissionsTab />
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
function ProfileTab({ center, centerId }: {
  center: ServiceCenter; centerId: string;
}) {
  const { t } = useTranslation();
  // Owner/Manager both reach Settings, but editing here is its own permission.
  const editable = usePermission("settings.editProfile");
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

      await safeUpdateDoc(doc(db, "servicecenters", centerId), {
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
function RemindersTab({ center, centerId }: {
  center: ServiceCenter; centerId: string;
}) {
  const { t } = useTranslation();
  // Owner/Manager both reach Settings, but editing here is its own permission.
  const editable = usePermission("settings.editReminderSettings");

  const [cooldownDays, setCooldownDays] = useState(String(center.reminderCooldownDays ?? 7));
  const [inactiveDays, setInactiveDays] = useState(String(center.customerInactiveDays ?? 90));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const e: Record<string, string> = {};
    const days = parseInt(cooldownDays, 10);
    if (isNaN(days) || days < 1 || days > 60) e.cooldownDays = t("settings.reminders.cooldownError");
    const inactive = parseInt(inactiveDays, 10);
    if (isNaN(inactive) || inactive < 7 || inactive > 365) e.inactiveDays = t("settings.reminders.inactiveError");
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      await safeUpdateDoc(doc(db, "servicecenters", centerId), {
        reminderCooldownDays: parseInt(cooldownDays, 10),
        customerInactiveDays: parseInt(inactiveDays, 10),
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

        <FormField
          label={t("settings.reminders.inactiveLabel")}
          error={errors.inactiveDays}
          hint={t("settings.reminders.inactiveHint")}
        >
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={inactiveDays}
              onChange={e => setInactiveDays(e.target.value)}
              disabled={!editable}
              min={7}
              max={365}
              placeholder="90"
              className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316] disabled:opacity-50"
            />
            <span className="text-sm text-gray-400 whitespace-nowrap flex-shrink-0">{t("settings.reminders.cooldownUnit")}</span>
          </div>
          <p className="text-xs text-gray-600 mt-1">{t("settings.reminders.inactiveRange")}</p>
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

// ── Invoice Printing Tab ──────────────────────────────────────────────────────────
// The paper the center actually loads into its invoice printer. Saved on the
// center document and read back by every printable invoice (src/lib/printPaper.ts),
// which builds the @page rules from it — so a 76mm roll shop prints 76mm
// receipts and an A4 shop keeps full sheets, with no per-print fiddling.
function PrintingTab({ center, centerId }: {
  center: ServiceCenter; centerId: string;
}) {
  const { t } = useTranslation();
  const editable = usePermission("settings.editProfile");

  const stored = center.invoicePaper;
  const [size, setSize] = useState<PaperSizeKey>(stored?.size ?? DEFAULT_PAPER_SIZE);
  const [customWidth, setCustomWidth] = useState(
    String(stored?.widthMm ?? CUSTOM_PAPER_DEFAULTS.widthMm),
  );
  // Blank = continuous roll (no fixed page height).
  const [customHeight, setCustomHeight] = useState(
    stored?.heightMm ? String(stored.heightMm) : "",
  );
  const [margin, setMargin] = useState(
    stored?.marginMm !== undefined && stored?.marginMm !== null ? String(stored.marginMm) : "",
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // What the print CSS will actually resolve to, given what's typed right now.
  const preview = resolvePaper({
    invoicePaper: {
      size,
      widthMm: parseFloat(customWidth),
      heightMm: customHeight.trim() === "" ? null : parseFloat(customHeight),
      marginMm: margin.trim() === "" ? undefined : parseFloat(margin),
    },
  });

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (size === "custom") {
      const w = parseFloat(customWidth);
      if (isNaN(w) || w < PAPER_LIMITS.minWidthMm || w > PAPER_LIMITS.maxWidthMm) {
        e.width = t("settings.printing.widthError", {
          min: PAPER_LIMITS.minWidthMm, max: PAPER_LIMITS.maxWidthMm,
        });
      }
      if (customHeight.trim() !== "") {
        const h = parseFloat(customHeight);
        if (isNaN(h) || h < PAPER_LIMITS.minHeightMm || h > PAPER_LIMITS.maxHeightMm) {
          e.height = t("settings.printing.heightError", {
            min: PAPER_LIMITS.minHeightMm, max: PAPER_LIMITS.maxHeightMm,
          });
        }
      }
    }
    if (margin.trim() !== "") {
      const m = parseFloat(margin);
      if (isNaN(m) || m < PAPER_LIMITS.minMarginMm || m > PAPER_LIMITS.maxMarginMm) {
        e.margin = t("settings.printing.marginError", {
          min: PAPER_LIMITS.minMarginMm, max: PAPER_LIMITS.maxMarginMm,
        });
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      // Firestore rejects undefined, so build the object field by field.
      const paper: InvoicePaperSettings = { size };
      if (size === "custom") {
        paper.widthMm = parseFloat(customWidth);
        paper.heightMm = customHeight.trim() === "" ? null : parseFloat(customHeight);
      }
      if (margin.trim() !== "") paper.marginMm = parseFloat(margin);

      await safeUpdateDoc(doc(db, "servicecenters", centerId), {
        invoicePaper: paper,
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
        <h2 className="text-base font-semibold text-white">{t("settings.printing.sectionTitle")}</h2>
        <p className="text-sm text-gray-400 mt-0.5">{t("settings.printing.subtitle")}</p>
      </div>

      <div className="bg-[#162032] border border-white/10 rounded-xl p-5 space-y-5">
        <div>
          <label className="text-xs text-gray-400 block mb-2">{t("settings.printing.paperLabel")}</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {PAPER_SIZE_ORDER.map(key => {
              const spec = key === "custom" ? null : PAPER_SIZES[key as Exclude<PaperSizeKey, "custom">];
              const active = size === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => editable && setSize(key)}
                  disabled={!editable}
                  className={`text-left px-4 py-3 rounded-lg border transition disabled:opacity-50 ${
                    active
                      ? "border-[#F97316] bg-[#F97316]/10"
                      : "border-white/10 bg-white/5 hover:border-white/20"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Printer className={`w-4 h-4 ${active ? "text-[#F97316]" : "text-gray-500"}`} />
                    <span className="text-sm font-semibold text-white">
                      {spec ? spec.label : t("settings.printing.customLabel")}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {spec ? spec.description : t("settings.printing.customDesc")}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {size === "custom" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label={t("settings.printing.widthLabel")} error={errors.width}>
              <input
                type="number"
                value={customWidth}
                onChange={e => setCustomWidth(e.target.value)}
                disabled={!editable}
                min={PAPER_LIMITS.minWidthMm}
                max={PAPER_LIMITS.maxWidthMm}
                placeholder="76"
                className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316] disabled:opacity-50"
              />
            </FormField>
            <FormField
              label={t("settings.printing.heightLabel")}
              hint={t("settings.printing.heightHint")}
              error={errors.height}
            >
              <input
                type="number"
                value={customHeight}
                onChange={e => setCustomHeight(e.target.value)}
                disabled={!editable}
                min={PAPER_LIMITS.minHeightMm}
                max={PAPER_LIMITS.maxHeightMm}
                placeholder={t("settings.printing.heightPlaceholder")}
                className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316] disabled:opacity-50"
              />
            </FormField>
          </div>
        )}

        <FormField
          label={t("settings.printing.marginLabel")}
          hint={t("settings.printing.marginHint")}
          error={errors.margin}
        >
          <input
            type="number"
            value={margin}
            onChange={e => setMargin(e.target.value)}
            disabled={!editable}
            min={PAPER_LIMITS.minMarginMm}
            max={PAPER_LIMITS.maxMarginMm}
            placeholder={String(preview.marginMm)}
            className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316] disabled:opacity-50"
          />
        </FormField>

        {/* Resolved result — what the printer will be told to do. */}
        <div className="bg-white/5 border border-white/10 rounded-lg px-4 py-3">
          <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-2">
            {t("settings.printing.previewTitle")}
          </div>
          <div className="flex items-start gap-4">
            <div
              className="bg-white/90 border border-white/20 rounded flex-shrink-0"
              style={{
                width: Math.max(18, Math.round(preview.widthMm / 3)),
                height: Math.round((preview.heightMm ?? 180) / 3),
              }}
            />
            <div className="text-sm text-gray-300 space-y-0.5">
              <div className="font-semibold text-white">{preview.label}</div>
              <div className="text-xs text-gray-400">
                {preview.heightMm
                  ? t("settings.printing.previewSize", { width: preview.widthMm, height: preview.heightMm })
                  : t("settings.printing.previewRoll", { width: preview.widthMm })}
              </div>
              <div className="text-xs text-gray-400">
                {t("settings.printing.previewPrintable", {
                  width: Math.round(contentWidthMm(preview)), margin: preview.marginMm,
                })}
              </div>
              <div className="text-xs text-gray-400">
                {preview.receipt
                  ? t("settings.printing.previewReceiptLayout")
                  : t("settings.printing.previewPageLayout")}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-3 bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3">
        <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-blue-300">
          <span className="font-semibold">{t("settings.printing.tipLabel")}</span>{" "}
          {t("settings.printing.tipDesc")}
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
            {saving ? t("settings.printing.saving") : t("settings.printing.save")}
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-green-400 text-sm">
              <CheckCircle className="w-4 h-4" />{t("settings.printing.saved")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Working Hours Tab ─────────────────────────────────────────────────────────────
// Owner-only. Feeds src/lib/scheduling.ts (isCenterOpen / getAvailableSlots),
// which the customer portal's booking calendar and the staff Bookings page
// both use to work out which dates/slots are bookable.
const DISPLAY_DAY_ORDER: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const SLOT_DURATION_OPTIONS = [15, 30, 45, 60];

function WorkingHoursTab({ center, centerId }: {
  center: ServiceCenter; centerId: string;
}) {
  const { t } = useTranslation();

  const [weeklyHours, setWeeklyHours] = useState<WeeklyHours>(
    (center.weeklyHours as WeeklyHours) ?? DEFAULT_WEEKLY_HOURS,
  );
  const [slotDuration, setSlotDuration] = useState<number>(
    center.slotDurationMinutes ?? DEFAULT_SLOT_DURATION_MINUTES,
  );
  const [overrides, setOverrides] = useState<CalendarOverrides>(center.calendarOverrides ?? {});
  const [newOverrideDate, setNewOverrideDate] = useState("");
  const [newOverrideStatus, setNewOverrideStatus] = useState<"closed" | "open">("closed");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const currentYear = new Date().getFullYear();
  const upcomingHolidays = [
    ...poyaDaysForYear(currentYear).map((date) => ({ date, year: currentYear })),
    ...poyaDaysForYear(currentYear + 1).map((date) => ({ date, year: currentYear + 1 })),
  ].filter((h) => h.date >= new Date().toISOString().slice(0, 10));

  function updateDay(day: DayKey, patch: Partial<DayHours>) {
    setWeeklyHours((prev) => ({ ...prev, [day]: { ...prev[day], ...patch } }));
  }

  function addOverride() {
    if (!newOverrideDate) return;
    setOverrides((prev) => ({ ...prev, [newOverrideDate]: newOverrideStatus }));
    setNewOverrideDate("");
  }

  function removeOverride(date: string) {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[date];
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      await safeUpdateDoc(doc(db, "servicecenters", centerId), {
        weeklyHours,
        slotDurationMinutes: slotDuration,
        calendarOverrides: overrides,
        updatedAt: Timestamp.now(),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  const overrideEntries = Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h2 className="text-base font-semibold text-white">{t("settings.workingHours.sectionTitle")}</h2>
        <p className="text-sm text-gray-400 mt-0.5">{t("settings.workingHours.subtitle")}</p>
      </div>

      {/* Weekly schedule */}
      <div className="bg-[#162032] border border-white/10 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white">{t("settings.workingHours.weeklyScheduleTitle")}</h3>
        <div className="space-y-2">
          {DISPLAY_DAY_ORDER.map((day) => {
            const hours = weeklyHours[day] ?? { open: false };
            return (
              <div key={day} className="flex items-center gap-3 flex-wrap bg-white/5 border border-white/10 rounded-lg px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => updateDay(day, { open: !hours.open, start: hours.start ?? "08:00", end: hours.end ?? "17:00" })}
                  className={`w-24 flex-shrink-0 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors ${
                    hours.open
                      ? "bg-green-500/15 border-green-500/30 text-green-400"
                      : "bg-white/5 border-white/10 text-gray-500"
                  }`}
                >
                  {hours.open ? t("settings.workingHours.openLabel") : t("settings.workingHours.closedLabel")}
                </button>
                <span className="w-10 text-sm text-gray-300 capitalize">{day}</span>
                {hours.open && (
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      value={hours.start ?? "08:00"}
                      onChange={(e) => updateDay(day, { start: e.target.value })}
                      className="bg-[#0B1120] border border-white/10 text-white rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-[#F97316]"
                    />
                    <span className="text-gray-500 text-xs">–</span>
                    <input
                      type="time"
                      value={hours.end ?? "17:00"}
                      onChange={(e) => updateDay(day, { end: e.target.value })}
                      className="bg-[#0B1120] border border-white/10 text-white rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-[#F97316]"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <FormField label={t("settings.workingHours.slotDurationLabel")} hint={t("settings.workingHours.slotDurationHint")}>
          <div className="flex items-center gap-2">
            <select
              value={slotDuration}
              onChange={(e) => setSlotDuration(Number(e.target.value))}
              className="bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
            >
              {SLOT_DURATION_OPTIONS.map((m) => (
                <option key={m} value={m} className="bg-[#162032]">{m}</option>
              ))}
            </select>
            <span className="text-sm text-gray-400">{t("settings.workingHours.minutes")}</span>
          </div>
        </FormField>
      </div>

      {/* Poya / public holidays */}
      <div className="bg-[#162032] border border-white/10 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Sun className="w-4 h-4 text-orange-400" />
          <h3 className="text-sm font-semibold text-white">{t("settings.workingHours.holidaysTitle")}</h3>
        </div>
        <p className="text-xs text-gray-400">{t("settings.workingHours.holidaysDesc")}</p>
        <div className="max-h-56 overflow-y-auto space-y-1.5">
          {upcomingHolidays.map(({ date }) => {
            const override = overrides[date];
            return (
              <div key={date} className="flex items-center justify-between gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">
                <span className="text-gray-300">{date}</span>
                {override === "open" ? (
                  <span className="text-xs text-green-400">{t("settings.workingHours.markOpen")}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setOverrides((prev) => ({ ...prev, [date]: "open" }))}
                    className="text-xs text-[#F97316] hover:text-[#fb923c]"
                  >
                    {t("settings.workingHours.markOpen")}
                  </button>
                )}
              </div>
            );
          })}
          {upcomingHolidays.length === 0 && (
            <p className="text-xs text-gray-500">—</p>
          )}
        </div>
      </div>

      {/* Manual overrides */}
      <div className="bg-[#162032] border border-white/10 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-white">{t("settings.workingHours.overridesTitle")}</h3>
        <p className="text-xs text-gray-400">{t("settings.workingHours.overridesDesc")}</p>

        <div className="flex flex-wrap items-end gap-2">
          <FormField label={t("settings.workingHours.overrideDateLabel")}>
            <input
              type="date"
              value={newOverrideDate}
              onChange={(e) => setNewOverrideDate(e.target.value)}
              className="bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
            />
          </FormField>
          <FormField label={t("settings.workingHours.overrideStatusLabel")}>
            <select
              value={newOverrideStatus}
              onChange={(e) => setNewOverrideStatus(e.target.value as "closed" | "open")}
              className="bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
            >
              <option value="closed" className="bg-[#162032]">{t("settings.workingHours.markClosed")}</option>
              <option value="open" className="bg-[#162032]">{t("settings.workingHours.markOpen")}</option>
            </select>
          </FormField>
          <button
            type="button"
            onClick={addOverride}
            disabled={!newOverrideDate}
            className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white px-3 py-2 rounded-lg text-sm"
          >
            <CalendarPlus className="w-4 h-4" /> {t("settings.workingHours.addOverride")}
          </button>
        </div>

        <div className="space-y-1.5">
          {overrideEntries.map(([date, status]) => (
            <div key={date} className="flex items-center justify-between gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">
              <span className="flex items-center gap-2 text-gray-300">
                {status === "closed" ? <CalendarOff className="w-3.5 h-3.5 text-red-400" /> : <Sun className="w-3.5 h-3.5 text-green-400" />}
                {date} — {status === "closed" ? t("settings.workingHours.markClosed") : t("settings.workingHours.markOpen")}
              </span>
              <button type="button" onClick={() => removeOverride(date)} className="text-xs text-gray-500 hover:text-red-400">
                {t("settings.workingHours.removeOverride")}
              </button>
            </div>
          ))}
          {overrideEntries.length === 0 && (
            <p className="text-xs text-gray-500">{t("settings.workingHours.noOverrides")}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-[#F97316] hover:bg-[#ea6c0f] text-white px-5 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 transition flex items-center gap-2"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {saving ? t("settings.workingHours.saving") : t("settings.workingHours.save")}
        </button>
        {saved && (
          <span className="flex items-center gap-1.5 text-green-400 text-sm">
            <CheckCircle className="w-4 h-4" />{t("settings.workingHours.saved")}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Staff Tab ────────────────────────────────────────────────────────────────────
function StaffTab({ centerId, role: userRole, currentUid, plan }: {
  centerId: string; role?: UserRole; currentUid?: string; plan?: string;
}) {
  const { currentUser } = useAuth();
  const { t } = useTranslation();
  const [, setSearchParams] = useSearchParams();
  const isOwner = ownerOnly(userRole);
  // Multi-user staff is a Pro feature; the Basic plan includes the Owner only.
  const isPro = plan === "pro";
  const [staff, setStaff] = useState<StaffMember[]>([]);
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
    return staffUnsub;
  }, [centerId]);

  const activeStaff = staff.filter(s => s.active);
  const inactiveStaff = staff.filter(s => !s.active);

  async function handleRemove(staffId: string) {
    if (!window.confirm(t("settings.staff.removeConfirm"))) return;
    setProcessingId(staffId);
    try { await safeUpdateDoc(doc(db, "servicecenters", centerId, "staff", staffId), { active: false }); }
    finally { setProcessingId(null); }
  }

  async function handleChangeRole(staffId: string, role: UserRole) {
    setProcessingId(staffId);
    try {
      const previousRole = changeRoleFor?.current;
      await safeUpdateDoc(doc(db, "servicecenters", centerId, "staff", staffId), { role });
      if (currentUser && previousRole && previousRole !== role) {
        const target = staff.find(s => s.id === staffId);
        void logAuditEvent({
          centerId,
          action: "role_change",
          entityType: "staff",
          entityId: staffId,
          entityLabel: target?.fullName ?? staffId,
          changes: [{ field: "role", before: previousRole, after: role }],
          performedBy: currentUser.uid,
          performedByName: currentUser.displayName || currentUser.email || "Unknown",
        });
      }
      setChangeRoleFor(null);
    } finally { setProcessingId(null); }
  }

  // Re-activates a removed staff member with a freshly generated password and
  // resends their login credentials via SMS (createStaffAccount updates the
  // existing Firebase Auth account's password if one already exists).
  async function handleReinvite(member: StaffMember) {
    if (!member.phone) {
      window.alert("This staff member has no phone number on file — cannot resend login credentials.");
      return;
    }
    setProcessingId(member.id);
    try {
      const password = generateStaffPassword(member.fullName, member.phone);
      const createStaffAccount = httpsCallable(functions, "createStaffAccount");
      await createStaffAccount({
        centerId,
        staffId: member.id,
        phone: member.phone,
        fullName: member.fullName,
        role: member.role,
        password,
      });
      await safeUpdateDoc(doc(db, "servicecenters", centerId, "staff", member.id), {
        active: true,
        hasLogin: true,
      });
      window.alert(`Login credentials sent via SMS to ${member.phone}.`);
    } catch (err) {
      window.alert((err as Error)?.message ?? "Failed to resend login credentials.");
    } finally {
      setProcessingId(null);
    }
  }

  function staffDisplayName(m: StaffMember): string {
    return m.fullName || m.displayName || m.phone || "Staff";
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
          isPro ? (
            <button
              onClick={() => setShowInvite(true)}
              className="flex items-center gap-2 bg-[#F97316] hover:bg-[#ea6c0f] text-white px-4 py-2 rounded-lg text-sm font-semibold transition flex-shrink-0"
            >
              <UserPlus className="w-4 h-4" />
              {t("settings.staff.invite")}
            </button>
          ) : (
            <button
              onClick={() => setSearchParams({ tab: "subscription" })}
              className="flex items-center gap-2 bg-[#F97316]/10 hover:bg-[#F97316]/20 text-[#F97316] border border-[#F97316]/30 px-4 py-2 rounded-lg text-sm font-semibold transition flex-shrink-0"
              title={t("settings.staff.proInviteHint")}
            >
              <Lock className="w-4 h-4" />
              {t("settings.staff.invite")}
            </button>
          )
        )}
      </div>

      {/* Basic plan: multi-user is a Pro feature */}
      {isOwner && !isPro && (
        <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-300">{t("settings.staff.proTitle")}</p>
            <p className="text-xs text-amber-400/80 mt-0.5">{t("settings.staff.proDesc")}</p>
          </div>
          <button
            onClick={() => setSearchParams({ tab: "subscription" })}
            className="text-xs font-semibold text-amber-300 hover:text-amber-200 underline underline-offset-2 flex-shrink-0 mt-0.5"
          >
            {t("settings.staff.proUpgrade")}
          </button>
        </div>
      )}

      {loading ? (
        <LoadingBlock className="py-8" />
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
                      <div className="text-xs text-gray-500 mt-0.5 truncate">{member.phone}</div>
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
                      <div className="text-xs text-gray-600 mt-0.5 truncate">{member.phone}</div>
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

          {activeStaff.length === 0 && inactiveStaff.length === 0 && (
            <div className="text-center py-12">
              <Users className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <p className="text-sm text-gray-400">{t("settings.staff.noStaff")}</p>
              {isOwner && <p className="text-xs text-gray-600 mt-1">{t("settings.staff.noStaffHint")}</p>}
            </div>
          )}
        </div>
      )}

      {showInvite && isOwner && isPro && (
        <InviteModal centerId={centerId} onClose={() => setShowInvite(false)} />
      )}
    </div>
  );
}

function InviteModal({ centerId, onClose }: {
  centerId: string; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<UserRole>("Technician");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState<"username" | "password" | null>(null);

  async function handleSend() {
    if (!fullName.trim()) {
      setError("Enter the staff member's full name.");
      return;
    }
    if (!validateStaffPhone(phone.trim())) {
      setError("Enter a valid LK phone number (07XXXXXXXX or +947XXXXXXXX).");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const password = generateStaffPassword(fullName, phone.trim());
      const staffRef = await safeAddDoc(collection(db, "servicecenters", centerId, "staff"), {
        fullName: fullName.trim(),
        phone: phone.trim(),
        role,
        active: true,
        centerId,
        createdAt: Timestamp.now(),
      });
      const createStaffAccount = httpsCallable(functions, "createStaffAccount");
      await createStaffAccount({
        centerId,
        staffId: staffRef.id,
        phone: phone.trim(),
        fullName: fullName.trim(),
        role,
        password,
      });
      setCreated({ username: staffLoginUsername(phone.trim()), password });
    } catch (err) {
      setError((err as Error)?.message ?? t("settings.inviteModal.createError"));
    }
    setSaving(false);
  }

  async function handleCopy(field: "username" | "password", value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
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

        {created ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2 bg-green-500/10 border border-green-500/20 rounded-lg p-3 text-xs text-green-300">
              <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium mb-1">Account created</p>
                <p>Login credentials and the app link were sent via SMS to {phone.trim()}.</p>
              </div>
            </div>

            <div className="bg-[#0B1120] border border-white/10 rounded-lg px-4 py-3 space-y-1">
              <p className="text-xs text-gray-500">Login Username (Phone Number)</p>
              <div className="flex items-center justify-between">
                <p className="text-sm font-mono text-white">{created.username}</p>
                <button onClick={() => handleCopy("username", created.username)} className="text-gray-400 hover:text-white transition">
                  {copied === "username" ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div className="bg-[#0B1120] border border-white/10 rounded-lg px-4 py-3 space-y-1">
              <p className="text-xs text-gray-500">Password</p>
              <div className="flex items-center justify-between">
                <p className="text-sm font-mono text-white">{showPassword ? created.password : "••••••••"}</p>
                <div className="flex items-center gap-2">
                  <button onClick={() => setShowPassword(v => !v)} className="text-gray-400 hover:text-white transition">
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={() => handleCopy("password", created.password)} className="text-gray-400 hover:text-white transition">
                    {copied === "password" ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            <button onClick={onClose} className="w-full bg-white/10 hover:bg-white/20 text-white text-sm font-medium py-2 rounded-lg transition">
              {t("settings.inviteModal.done")}
            </button>
          </div>
        ) : (
          <>
            <FormField label="Full Name">
              <input
                type="text"
                value={fullName}
                onChange={e => { setFullName(e.target.value); setError(""); }}
                placeholder="e.g. Kumara Perera"
                className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
              />
            </FormField>

            <FormField label="Phone Number" error={error}>
              <input
                type="tel"
                value={phone}
                onChange={e => { setPhone(e.target.value); setError(""); }}
                placeholder="07XXXXXXXX or +947XXXXXXXX"
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
              The staff member will receive their login username and password via SMS, along with a link to the app.
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
type SubTab = "overview" | "payments" | "store" | "history";

function SubscriptionTab({ center, centerId }: { center: ServiceCenter; centerId: string }) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const [searchParams] = useSearchParams();
  const quotaUsed = center.smsQuotaUsed ?? 0;
  const quotaLimit = center.smsQuotaLimit ?? (center.plan === "pro" ? 1000 : 200);
  const quotaPct = quotaLimit > 0 ? Math.round((quotaUsed / quotaLimit) * 100) : 0;

  const [subTab, setSubTab] = useState<SubTab>(searchParams.get("sub") === "store" ? "store" : "overview");
  const [codeCopied, setCodeCopied] = useState(false);
  const [bankCopied, setBankCopied] = useState<string | null>(null);
  const [showUpgradeForm, setShowUpgradeForm] = useState(false);
  const [upgradePeriod, setUpgradePeriod] = useState<"monthly" | "yearly">("monthly");
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [slipPreview, setSlipPreview] = useState<string | null>(null);
  const [upgradeNote, setUpgradeNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [existingRequest, setExistingRequest] = useState<UpgradeRequest | null>(null);
  const [upgradeHistory, setUpgradeHistory] = useState<UpgradeRequest[]>([]);
  // Downgrade (Pro → Basic) request — no payment slip, admin-approved.
  const [showDowngradeForm, setShowDowngradeForm] = useState(false);
  const [downgradeNote, setDowngradeNote] = useState("");
  const [submittingDowngrade, setSubmittingDowngrade] = useState(false);
  const [downgradeSubmitted, setDowngradeSubmitted] = useState(false);
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

  // Store add-ons (Outlets/POS, Distributors) — purchase requests
  const [storeAddonRequests, setStoreAddonRequests] = useState<StoreAddonRequest[]>([]);
  const [purchasingAddon, setPurchasingAddon] = useState<StoreAddonKey | null>(null);
  const [addonSlipFile, setAddonSlipFile] = useState<File | null>(null);
  const [addonSlipPreview, setAddonSlipPreview] = useState<string | null>(null);
  const [addonSlipNote, setAddonSlipNote] = useState("");
  const [submittingAddon, setSubmittingAddon] = useState(false);
  const addonSlipInputRef = useRef<HTMLInputElement>(null);
  const storeAddonsActive = center.storeAddons ?? {};
  const pendingAddonRequest = (addon: StoreAddonKey) =>
    storeAddonRequests.find(r => r.addon === addon && r.status === "pending");

  // SMS top-up packages — purchase requests
  const [smsPackageRequests, setSmsPackageRequests] = useState<SmsPackageRequest[]>([]);
  const [purchasingSmsPackage, setPurchasingSmsPackage] = useState<SmsPackageKey | null>(null);
  const [smsBillingType, setSmsBillingType] = useState<SmsPackageBillingType>("one_time");
  const [smsSlipFile, setSmsSlipFile] = useState<File | null>(null);
  const [smsSlipPreview, setSmsSlipPreview] = useState<string | null>(null);
  const [smsSlipNote, setSmsSlipNote] = useState("");
  const [submittingSmsPackage, setSubmittingSmsPackage] = useState(false);
  const smsSlipInputRef = useRef<HTMLInputElement>(null);
  const pendingSmsPackageRequest = (pkg: SmsPackageKey) =>
    smsPackageRequests.find(r => r.package === pkg && r.status === "pending");

  // New branch requests — no payment slip; the super admin manually
  // provisions the branch and settles billing once approved.
  const [branchRequests, setBranchRequests] = useState<BranchRequest[]>([]);
  const [showBranchRequestForm, setShowBranchRequestForm] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [branchAddress, setBranchAddress] = useState("");
  const [branchPhone, setBranchPhone] = useState("");
  const [branchDistrict, setBranchDistrict] = useState("");
  const [branchPlan, setBranchPlan] = useState<"basic" | "pro">("pro");
  const [branchNote, setBranchNote] = useState("");
  const [submittingBranch, setSubmittingBranch] = useState(false);
  const pendingBranchRequest = branchRequests.find(r => r.status === "pending");

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

    getDocs(
      query(
        collection(db, "storeAddonRequests"),
        where("centerId", "==", centerId),
        orderBy("createdAt", "desc"),
      )
    ).then((snap) => {
      setStoreAddonRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() } as StoreAddonRequest)));
    }).catch(() => {/* rules not yet deployed */});

    getDocs(
      query(
        collection(db, "smsPackageRequests"),
        where("centerId", "==", centerId),
        orderBy("createdAt", "desc"),
      )
    ).then((snap) => {
      setSmsPackageRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() } as SmsPackageRequest)));
    }).catch(() => {/* rules not yet deployed */});

    getDocs(
      query(
        collection(db, "branchRequests"),
        where("centerId", "==", centerId),
        orderBy("createdAt", "desc"),
      )
    ).then((snap) => {
      setBranchRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() } as BranchRequest)));
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

      const { collection: col, serverTimestamp } = await import("firebase/firestore");
      await safeAddDoc(col(db, "upgradeRequests"), {
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

  async function submitDowngradeRequest() {
    if (!center.paymentCode) return;
    setSubmittingDowngrade(true);
    try {
      const { collection: col, serverTimestamp } = await import("firebase/firestore");
      const ref = await safeAddDoc(col(db, "upgradeRequests"), {
        centerId,
        centerName: center.name,
        paymentCode: center.paymentCode,
        requestedPlan: "basic",
        type: "downgrade",
        period: "monthly",
        amount: 0,
        notes: downgradeNote || null,
        status: "pending",
        createdAt: serverTimestamp(),
      });
      const newReq: UpgradeRequest = {
        id: ref.id,
        centerId,
        centerName: center.name,
        paymentCode: center.paymentCode,
        requestedPlan: "basic",
        type: "downgrade",
        period: "monthly",
        amount: 0,
        status: "pending",
        notes: downgradeNote || undefined,
        createdAt: { seconds: Date.now() / 1000 } as Timestamp,
      };
      setUpgradeHistory((prev) => [newReq, ...prev]);
      setExistingRequest(newReq);
      setDowngradeSubmitted(true);
      setShowDowngradeForm(false);
      setDowngradeNote("");
    } finally {
      setSubmittingDowngrade(false);
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
      const planAmount = center.plan === "pro"
        ? (monthlySlipPeriod === "yearly" ? 79990 : 7999)
        : (monthlySlipPeriod === "yearly" ? 59990 : 4999);
      // Active Store add-ons and recurring SMS packages ride along on the
      // regular subscription payment — their monthly fee is folded into this
      // slip's total (×12 for yearly) rather than billed separately.
      const addonMonthly = storeAddonsMonthlyTotal(center.storeAddons)
        + smsPackageSubscriptionsMonthlyTotal(center.smsPackageSubscriptions);
      const amount = planAmount + (monthlySlipPeriod === "yearly" ? addonMonthly * 12 : addonMonthly);

      const { collection: col, serverTimestamp } = await import("firebase/firestore");
      const ref = await safeAddDoc(col(db, "paymentSlipRequests"), {
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

  async function submitStoreAddonPurchase() {
    if (!purchasingAddon || !addonSlipFile || !center.paymentCode) return;
    const addon = purchasingAddon;
    setSubmittingAddon(true);
    try {
      const ext = addonSlipFile.name.split(".").pop();
      const slipRef = storageRef(storage, `paymentSlips/${centerId}/storeAddons/${addon}-${Date.now()}.${ext}`);
      const task = uploadBytesResumable(slipRef, addonSlipFile);
      await new Promise<void>((resolve, reject) => { task.on("state_changed", null, reject, resolve); });
      const slipUrl = await getDownloadURL(slipRef);
      const amount = STORE_ADDON_PRICE[addon];

      const { collection: col, serverTimestamp } = await import("firebase/firestore");
      const ref = await safeAddDoc(col(db, "storeAddonRequests"), {
        centerId,
        centerName: center.name,
        paymentCode: center.paymentCode,
        addon,
        amount,
        slipUrl,
        notes: addonSlipNote || null,
        status: "pending",
        createdAt: serverTimestamp(),
      });
      const newReq: StoreAddonRequest = {
        id: ref.id,
        centerId,
        centerName: center.name,
        paymentCode: center.paymentCode,
        addon,
        amount,
        slipUrl,
        notes: addonSlipNote || undefined,
        status: "pending",
        createdAt: { seconds: Date.now() / 1000 } as Timestamp,
      };
      setStoreAddonRequests((prev) => [newReq, ...prev]);
      setPurchasingAddon(null);
      setAddonSlipFile(null);
      setAddonSlipPreview(null);
      setAddonSlipNote("");
    } finally {
      setSubmittingAddon(false);
    }
  }

  async function submitSmsPackagePurchase() {
    if (!purchasingSmsPackage || !smsSlipFile || !center.paymentCode) return;
    const pkg = purchasingSmsPackage;
    const billingType = smsBillingType;
    setSubmittingSmsPackage(true);
    try {
      const ext = smsSlipFile.name.split(".").pop();
      const slipRef = storageRef(storage, `paymentSlips/${centerId}/smsPackages/${pkg}-${Date.now()}.${ext}`);
      const task = uploadBytesResumable(slipRef, smsSlipFile);
      await new Promise<void>((resolve, reject) => { task.on("state_changed", null, reject, resolve); });
      const slipUrl = await getDownloadURL(slipRef);
      const amount = SMS_PACKAGE_PRICE[pkg];
      const quota = SMS_PACKAGE_QUOTA[pkg];

      const { collection: col, serverTimestamp } = await import("firebase/firestore");
      const ref = await safeAddDoc(col(db, "smsPackageRequests"), {
        centerId,
        centerName: center.name,
        paymentCode: center.paymentCode,
        package: pkg,
        billingType,
        quota,
        amount,
        slipUrl,
        notes: smsSlipNote || null,
        status: "pending",
        createdAt: serverTimestamp(),
      });
      const newReq: SmsPackageRequest = {
        id: ref.id,
        centerId,
        centerName: center.name,
        paymentCode: center.paymentCode,
        package: pkg,
        billingType,
        quota,
        amount,
        slipUrl,
        notes: smsSlipNote || undefined,
        status: "pending",
        createdAt: { seconds: Date.now() / 1000 } as Timestamp,
      };
      setSmsPackageRequests((prev) => [newReq, ...prev]);
      setPurchasingSmsPackage(null);
      setSmsSlipFile(null);
      setSmsSlipPreview(null);
      setSmsSlipNote("");
      setSmsBillingType("one_time");
    } finally {
      setSubmittingSmsPackage(false);
    }
  }

  async function submitBranchRequest() {
    if (!branchName.trim() || !branchAddress.trim() || !branchPhone.trim() || !branchDistrict || !currentUser) return;
    setSubmittingBranch(true);
    try {
      const { collection: col, serverTimestamp } = await import("firebase/firestore");
      const amount = BRANCH_PRICE[branchPlan];
      const ref = await safeAddDoc(col(db, "branchRequests"), {
        centerId,
        centerName: center.name,
        ownerUid: currentUser.uid,
        requestedBranchName: branchName.trim(),
        address: branchAddress.trim(),
        phone: branchPhone.trim(),
        district: branchDistrict,
        requestedPlan: branchPlan,
        amount,
        notes: branchNote || null,
        status: "pending",
        createdAt: serverTimestamp(),
      });
      const newReq: BranchRequest = {
        id: ref.id,
        centerId,
        centerName: center.name,
        ownerUid: currentUser.uid,
        requestedBranchName: branchName.trim(),
        address: branchAddress.trim(),
        phone: branchPhone.trim(),
        district: branchDistrict,
        requestedPlan: branchPlan,
        amount,
        notes: branchNote || undefined,
        status: "pending",
        createdAt: { seconds: Date.now() / 1000 } as Timestamp,
      };
      setBranchRequests((prev) => [newReq, ...prev]);
      setShowBranchRequestForm(false);
      setBranchName("");
      setBranchAddress("");
      setBranchPhone("");
      setBranchDistrict("");
      setBranchPlan("pro");
      setBranchNote("");
    } finally {
      setSubmittingBranch(false);
    }
  }

  const payCode = center.paymentCode ?? "—";

  // Next payment date: anchored to the center's creation day-of-month, rolled
  // forward one calendar month per paid month (see nextMonthlyPaymentDate).
  const monthsPaid = monthsPaidFromPayments(payments);
  const nextPayDate = nextMonthlyPaymentDate(center.createdAt, monthsPaid);

  const SUB_TABS: { id: SubTab; label: string }[] = [
    { id: "overview", label: "Plan Overview" },
    { id: "payments", label: "Payments" },
    { id: "store",    label: "Store" },
    { id: "history",  label: "History" },
  ];

  return (
    <div className="max-w-4xl space-y-6">
      {/* Sub-tab navigation */}
      <div className="flex gap-1 bg-[#162032] border border-white/10 rounded-xl p-1 w-fit">
        {SUB_TABS.map((st) => (
          <button
            key={st.id}
            onClick={() => setSubTab(st.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              subTab === st.id
                ? "bg-[#F97316] text-white"
                : "text-gray-400 hover:text-white hover:bg-white/5"
            }`}
          >
            {st.label}
          </button>
        ))}
      </div>

      {/* ── Overview tab ── */}
      {subTab === "overview" && (
        <div className="space-y-5">
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

          {/* Plan Comparison Table */}
          {(() => {
            const pc = "settings.subscription.planComparison";
            const isBasic = center.plan === "basic";
            const CheckMark = () => <span className="text-green-400 font-bold">✓</span>;
            const CrossMark = () => <span className="text-gray-600 font-bold">✗</span>;
            type Row =
              | { type: "feature"; key: string; basic: React.ReactNode; pro: React.ReactNode }
              | { type: "text"; key: string; basic: string; pro: string };
            const rows: Row[] = [
              { type: "text",    key: `${pc}.price`,               basic: t(`${pc}.priceBasic`),         pro: t(`${pc}.pricePro`) },
              { type: "text",    key: `${pc}.userAccounts`,        basic: t(`${pc}.userAccountsBasic`),  pro: t(`${pc}.userAccountsPro`) },
              { type: "feature", key: `${pc}.roleAccess`,          basic: <CrossMark />, pro: <CheckMark /> },
              { type: "feature", key: `${pc}.jobTicketAssignment`, basic: <CrossMark />, pro: <CheckMark /> },
              { type: "feature", key: `${pc}.customerManagement`,  basic: <CheckMark />, pro: <CheckMark /> },
              { type: "feature", key: `${pc}.vehicleManagement`,   basic: <CheckMark />, pro: <CheckMark /> },
              { type: "feature", key: `${pc}.serviceLibrary`,      basic: <CheckMark />, pro: <CheckMark /> },
              { type: "feature", key: `${pc}.jobCards`,            basic: <CheckMark />, pro: <CheckMark /> },
              { type: "feature", key: `${pc}.invoiceGeneration`,   basic: <CheckMark />, pro: <CheckMark /> },
              { type: "feature", key: `${pc}.invoiceFromLibrary`,  basic: <CheckMark />, pro: <CheckMark /> },
              { type: "feature", key: `${pc}.invoiceFromInventory`,basic: <CrossMark />, pro: <CheckMark /> },
              { type: "feature", key: `${pc}.pdfDownload`,         basic: <CheckMark />, pro: <CheckMark /> },
              { type: "feature", key: `${pc}.whatsappShare`,       basic: <CheckMark />, pro: <CheckMark /> },
              { type: "feature", key: `${pc}.smsCompletion`,       basic: <CheckMark />, pro: <CheckMark /> },
              { type: "feature", key: `${pc}.smsMileageReminder`,  basic: <CheckMark />, pro: <CheckMark /> },
              { type: "text",    key: `${pc}.smsQuota`,            basic: t(`${pc}.smsQuotaBasic`),     pro: t(`${pc}.smsQuotaPro`) },
              { type: "text",    key: `${pc}.inspectionModule`,    basic: "✗",                          pro: t(`${pc}.inspectionModulePro`) },
              { type: "feature", key: `${pc}.inspectionPhotos`,    basic: <CrossMark />, pro: <CheckMark /> },
              { type: "feature", key: `${pc}.inventoryManagement`, basic: <CrossMark />, pro: <CheckMark /> },
              { type: "feature", key: `${pc}.autoStockDeduction`,  basic: <CrossMark />, pro: <CheckMark /> },
              { type: "feature", key: `${pc}.analytics`,           basic: <CrossMark />, pro: <CheckMark /> },
              { type: "feature", key: `${pc}.multiBranch`,         basic: <CrossMark />, pro: <CheckMark /> },
              { type: "text",    key: `${pc}.branches`,            basic: t(`${pc}.branchesBasic`),     pro: t(`${pc}.branchesPro`) },
              { type: "feature", key: `${pc}.csvExport`,           basic: <CrossMark />, pro: <CheckMark /> },
            ];
            return (
              <div className="bg-[#162032] border border-white/10 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-white/10">
                  <div className="text-sm font-semibold text-white">{t(`${pc}.title`)}</div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10">
                        <th className="text-left px-4 py-3 text-xs text-gray-500 uppercase tracking-wider font-semibold w-1/2">{t(`${pc}.feature`)}</th>
                        <th className={`text-center px-4 py-3 text-xs uppercase tracking-wider font-bold w-1/4 ${isBasic ? "text-orange-400" : "text-gray-400"}`}>
                          {t(`${pc}.basic`)}
                          {isBasic && <div className="text-[10px] normal-case font-medium text-orange-300 mt-0.5">{t(`${pc}.yourPlan`)}</div>}
                        </th>
                        <th className={`text-center px-4 py-3 text-xs uppercase tracking-wider font-bold w-1/4 ${!isBasic ? "text-orange-400" : "text-gray-400"}`}>
                          {t(`${pc}.pro`)}
                          {!isBasic && <div className="text-[10px] normal-case font-medium text-orange-300 mt-0.5">{t(`${pc}.yourPlan`)}</div>}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {rows.map((row, idx) => (
                        <tr key={idx} className={idx % 2 === 0 ? "" : "bg-white/[0.02]"}>
                          <td className="px-4 py-2.5 text-gray-300 text-sm">{t(row.key)}</td>
                          <td className={`px-4 py-2.5 text-center font-medium ${isBasic ? "text-white" : "text-gray-500"}`}>
                            {row.type === "text"
                              ? <span className="text-sm">{row.basic as string}</span>
                              : row.basic}
                          </td>
                          <td className={`px-4 py-2.5 text-center font-medium ${!isBasic ? "text-white" : "text-gray-500"}`}>
                            {row.type === "text"
                              ? <span className={`text-sm ${!isBasic ? "" : "text-orange-400"}`}>{row.pro as string}</span>
                              : row.pro}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Payments tab ── */}
      {subTab === "payments" && (
        <div className="space-y-5">
          {/* Next Payment Date */}
          <div className="bg-[#162032] border border-white/10 rounded-xl p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-orange-500/15 flex items-center justify-center flex-shrink-0">
                <CalendarClock className="w-5 h-5 text-orange-400" />
              </div>
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-0.5">{t("settings.subscription.nextPaymentDate")}</div>
                <div className="text-lg font-bold text-white">
                  {nextPayDate
                    ? nextPayDate.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })
                    : "—"}
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-3">{t("settings.subscription.nextPaymentDateHint")}</p>
          </div>

          {/* Bank Account Details */}
          <div className="bg-[#162032] border border-white/10 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Landmark className="w-4 h-4 text-orange-400" />
              <span className="text-sm font-semibold text-white">{t("settings.subscription.bankDetails")}</span>
            </div>
            <p className="text-xs text-gray-400 mb-4">{t("settings.subscription.bankDetailsHint")}</p>
            <div className="space-y-2.5">
              {[
                { label: t("settings.subscription.bankAccountName"), value: BANK_ACCOUNT.accountName, display: BANK_ACCOUNT.accountName, copy: false },
                { label: t("settings.subscription.bankAccountNumber"), value: BANK_ACCOUNT.accountNumber, display: BANK_ACCOUNT.accountNumberDisplay, copy: true },
                { label: t("settings.subscription.bankName"), value: BANK_ACCOUNT.bank, display: BANK_ACCOUNT.bank, copy: false },
                { label: t("settings.subscription.bankBranch"), value: BANK_ACCOUNT.branch, display: BANK_ACCOUNT.branch, copy: false },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-3 py-2 border-b border-white/5 last:border-0">
                  <span className="text-xs text-gray-500">{row.label}</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium text-white ${row.copy ? "font-mono tracking-wide" : ""}`}>{row.display}</span>
                    {row.copy && (
                      <button
                        onClick={() => { navigator.clipboard.writeText(row.value); setBankCopied(row.label); setTimeout(() => setBankCopied(null), 2000); }}
                        className="text-gray-400 hover:text-white transition-colors"
                        aria-label={t("settings.subscription.copy")}
                      >
                        {bankCopied === row.label ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
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

          {/* Upgrade to Pro — inside payments tab for basic users */}
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
                  <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3 text-xs text-gray-300 space-y-1">
                    <p className="font-medium text-orange-300">{t("settings.subscription.paymentInstructions")}</p>
                    <p>1. Transfer <strong>{upgradePeriod === "yearly" ? "LKR 79,990" : "LKR 7,999"}</strong> to the PitStopIQ bank account.</p>
                    <p>2. Use <strong className="text-orange-300 font-mono">{payCode}</strong> as the payment reference.</p>
                    <p>3. Upload the bank slip below and submit.</p>
                  </div>
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

          {/* Change Plan — downgrade request for pro users */}
          {center.plan === "pro" && (
            <div className="bg-[#162032] border border-white/10 rounded-xl p-5 space-y-4">
              <div>
                <div className="text-sm font-semibold text-white mb-0.5">{t("settings.subscription.changePlanTitle")}</div>
                <p className="text-xs text-gray-400">{t("settings.subscription.downgradeDesc")}</p>
              </div>
              {downgradeSubmitted || (existingRequest?.requestedPlan === "basic") ? (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 flex items-start gap-3">
                  <Info className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-amber-300">{t("settings.subscription.downgradeSubmittedTitle")}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{t("settings.subscription.downgradeSubmittedDesc")}</p>
                  </div>
                </div>
              ) : !showDowngradeForm ? (
                <button
                  onClick={() => setShowDowngradeForm(true)}
                  className="text-sm text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500/50 px-4 py-2 rounded-lg transition"
                >
                  {t("settings.subscription.downgradeBasic")}
                </button>
              ) : (
                <div className="bg-black/20 border border-white/10 rounded-xl p-4 space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs text-gray-400">{t("settings.subscription.noteLabel")}</label>
                    <input
                      value={downgradeNote}
                      onChange={(e) => setDowngradeNote(e.target.value)}
                      placeholder={t("settings.subscription.notePlaceholder")}
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={submitDowngradeRequest}
                      disabled={submittingDowngrade}
                      className="flex-1 bg-red-500/90 hover:bg-red-500 disabled:opacity-60 text-white text-sm font-semibold py-2.5 rounded-lg transition flex items-center justify-center gap-2"
                    >
                      {submittingDowngrade ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      {submittingDowngrade ? t("settings.subscription.submitting") : t("settings.subscription.downgradeConfirm")}
                    </button>
                    <button
                      onClick={() => { setShowDowngradeForm(false); setDowngradeNote(""); }}
                      className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-medium py-2.5 rounded-lg transition"
                    >
                      {t("settings.subscription.cancel")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Store tab ── */}
      {subTab === "store" && (
        <div className="space-y-5">
          <div className="bg-[#162032] border border-white/10 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-1">
              <Store className="w-4 h-4 text-orange-400" />
              <span className="text-sm font-semibold text-white">Store Add-ons</span>
            </div>
            <p className="text-xs text-gray-400">
              Optional sections you can add to your account. Each is locked until its payment slip is approved,
              and once active its monthly fee is added to your regular subscription payment.
            </p>
          </div>

          <StoreAddonCard
            addon="outlets"
            icon={Store}
            title="Outlets & POS"
            description="Run a point-of-sale counter and manage outlet stock, separate from job-card invoicing."
            active={Boolean(storeAddonsActive.outlets)}
            pending={pendingAddonRequest("outlets")}
            purchasing={purchasingAddon === "outlets"}
            onStartPurchase={() => setPurchasingAddon("outlets")}
            onCancelPurchase={() => { setPurchasingAddon(null); setAddonSlipFile(null); setAddonSlipPreview(null); setAddonSlipNote(""); }}
            payCode={payCode}
            slipFile={addonSlipFile}
            slipPreview={addonSlipPreview}
            note={addonSlipNote}
            setNote={setAddonSlipNote}
            slipInputRef={addonSlipInputRef}
            onSlipSelect={(f) => { setAddonSlipFile(f); setAddonSlipPreview(URL.createObjectURL(f)); }}
            onSlipClear={() => { setAddonSlipFile(null); setAddonSlipPreview(null); }}
            onSubmit={submitStoreAddonPurchase}
            submitting={submittingAddon}
            onViewSlip={setViewSlip}
          />

          <StoreAddonCard
            addon="distributors"
            icon={Truck}
            title="Distributors"
            description="Give distributors an ordering portal, and track their orders, invoices and payments."
            active={Boolean(storeAddonsActive.distributors)}
            pending={pendingAddonRequest("distributors")}
            purchasing={purchasingAddon === "distributors"}
            onStartPurchase={() => setPurchasingAddon("distributors")}
            onCancelPurchase={() => { setPurchasingAddon(null); setAddonSlipFile(null); setAddonSlipPreview(null); setAddonSlipNote(""); }}
            payCode={payCode}
            slipFile={addonSlipFile}
            slipPreview={addonSlipPreview}
            note={addonSlipNote}
            setNote={setAddonSlipNote}
            slipInputRef={addonSlipInputRef}
            onSlipSelect={(f) => { setAddonSlipFile(f); setAddonSlipPreview(URL.createObjectURL(f)); }}
            onSlipClear={() => { setAddonSlipFile(null); setAddonSlipPreview(null); }}
            onSubmit={submitStoreAddonPurchase}
            submitting={submittingAddon}
            onViewSlip={setViewSlip}
          />

          {/* ── New Branch Request ── */}
          <BranchRequestCard
            pending={pendingBranchRequest}
            showForm={showBranchRequestForm}
            onStartRequest={() => setShowBranchRequestForm(true)}
            onCancel={() => {
              setShowBranchRequestForm(false);
              setBranchName(""); setBranchAddress(""); setBranchPhone(""); setBranchDistrict(""); setBranchPlan("pro"); setBranchNote("");
            }}
            branchName={branchName}
            setBranchName={setBranchName}
            branchAddress={branchAddress}
            setBranchAddress={setBranchAddress}
            branchPhone={branchPhone}
            setBranchPhone={setBranchPhone}
            branchDistrict={branchDistrict}
            setBranchDistrict={setBranchDistrict}
            branchPlan={branchPlan}
            setBranchPlan={setBranchPlan}
            branchNote={branchNote}
            setBranchNote={setBranchNote}
            onSubmit={submitBranchRequest}
            submitting={submittingBranch}
          />

          {/* Past branch requests */}
          {branchRequests.filter((r) => r.status !== "pending").length > 0 && (
            <div className="bg-[#162032] border border-white/10 rounded-xl overflow-hidden divide-y divide-white/5">
              {branchRequests.filter((r) => r.status !== "pending").map((r) => (
                <div key={r.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs text-gray-300">
                      {r.requestedBranchName} · {r.district} · {r.requestedPlan === "pro" ? "Pro" : "Basic"} (LKR {r.amount.toLocaleString()}/mo)
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {r.createdAt ? new Date((r.createdAt as Timestamp).seconds * 1000).toLocaleDateString() : "—"}
                      {r.notes ? ` · ${r.notes}` : ""}
                    </p>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${
                    r.status === "approved" ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
                  }`}>
                    {r.status === "approved" ? "Approved" : "Rejected"}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* ── SMS Top-up Packages ── */}
          <div className="bg-[#162032] border border-white/10 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-1">
              <MessageSquare className="w-4 h-4 text-orange-400" />
              <span className="text-sm font-semibold text-white">SMS Top-up Packages</span>
            </div>
            <p className="text-xs text-gray-400">
              Add more SMS credits on top of your plan's monthly quota. Choose whether a package is a
              one-time top-up or added to your monthly plan (like a Store add-on) when you purchase it.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(Object.keys(SMS_PACKAGE_PRICE) as SmsPackageKey[]).map((pkg) => (
              <SmsPackageCard
                key={pkg}
                pkg={pkg}
                pending={pendingSmsPackageRequest(pkg)}
                purchasing={purchasingSmsPackage === pkg}
                billingType={smsBillingType}
                setBillingType={setSmsBillingType}
                onStartPurchase={() => { setPurchasingSmsPackage(pkg); setSmsBillingType("one_time"); }}
                onCancelPurchase={() => { setPurchasingSmsPackage(null); setSmsSlipFile(null); setSmsSlipPreview(null); setSmsSlipNote(""); }}
                payCode={payCode}
                slipFile={smsSlipFile}
                slipPreview={smsSlipPreview}
                note={smsSlipNote}
                setNote={setSmsSlipNote}
                slipInputRef={smsSlipInputRef}
                onSlipSelect={(f) => { setSmsSlipFile(f); setSmsSlipPreview(URL.createObjectURL(f)); }}
                onSlipClear={() => { setSmsSlipFile(null); setSmsSlipPreview(null); }}
                onSubmit={submitSmsPackagePurchase}
                submitting={submittingSmsPackage}
                onViewSlip={setViewSlip}
              />
            ))}
          </div>

          {/* Past SMS package purchase requests */}
          {smsPackageRequests.filter((r) => r.status !== "pending").length > 0 && (
            <div className="bg-[#162032] border border-white/10 rounded-xl overflow-hidden divide-y divide-white/5">
              {smsPackageRequests.filter((r) => r.status !== "pending").map((r) => (
                <div key={r.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs text-gray-300">
                      {SMS_PACKAGE_LABEL[r.package]} ({r.billingType === "recurring" ? "monthly" : "one-time"}) · LKR {r.amount.toLocaleString()}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {r.createdAt ? new Date((r.createdAt as Timestamp).seconds * 1000).toLocaleDateString() : "—"}
                    </p>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${
                    r.status === "confirmed" ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
                  }`}>
                    {r.status === "confirmed" ? "Confirmed" : "Rejected"}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Past add-on purchase requests */}
          {storeAddonRequests.filter((r) => r.status !== "pending").length > 0 && (
            <div className="bg-[#162032] border border-white/10 rounded-xl overflow-hidden divide-y divide-white/5">
              {storeAddonRequests.filter((r) => r.status !== "pending").map((r) => (
                <div key={r.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs text-gray-300">
                      {STORE_ADDON_LABEL[r.addon]} · LKR {r.amount.toLocaleString()}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {r.createdAt ? new Date((r.createdAt as Timestamp).seconds * 1000).toLocaleDateString() : "—"}
                    </p>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${
                    r.status === "confirmed" ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
                  }`}>
                    {r.status === "confirmed" ? "Confirmed" : "Rejected"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── History tab ── */}
      {subTab === "history" && (
        <div className="space-y-5">
          {/* Upgrade Request History */}
          <div>
            <h3 className="text-sm font-semibold text-white mb-3">{t("settings.subscription.upgradeRequests")}</h3>
            {upgradeHistory.length === 0 ? (
              <div className="bg-[#162032] border border-white/10 rounded-xl p-6 text-center">
                <ClipboardList className="w-10 h-10 text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-400">No upgrade requests yet.</p>
              </div>
            ) : (
              <div className="bg-[#162032] border border-white/10 rounded-xl overflow-hidden divide-y divide-white/5">
                {upgradeHistory.map((req) => (
                  <div key={req.id} className="p-4 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white">
                        {req.requestedPlan === "basic"
                          ? t("settings.subscription.downgradeToBasic")
                          : (req.period === "yearly" ? t("settings.subscription.proPlanYearly") : t("settings.subscription.proPlanMonthly"))}
                        <span className="text-gray-400 ml-2 font-normal">
                          {req.requestedPlan === "basic" ? t("settings.subscription.noCharge") : `LKR ${req.amount.toLocaleString()}`}
                        </span>
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
            )}
          </div>

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
                <p className="text-sm text-gray-400 mb-4">{t("settings.subscription.cancelSubDesc")}</p>
                <button
                  onClick={() => { setSubTab("payments"); setShowDowngradeForm(true); }}
                  className="text-sm text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500/50 px-4 py-2 rounded-lg transition"
                >
                  {t("settings.subscription.cancelSubBtn")}
                </button>
              </div>
            </div>
          )}
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

// ── Store Add-on Card ────────────────────────────────────────────────────────────
// One purchasable Store section: Not purchased → upload form → Pending
// approval → Active. Both cards on the Store tab share this, driven by the
// single purchase-form state SubscriptionTab holds (only one can be mid-purchase
// at a time).
function StoreAddonCard({
  addon, icon: Icon, title, description, active, pending, purchasing,
  onStartPurchase, onCancelPurchase, payCode,
  slipFile, slipPreview, note, setNote, slipInputRef, onSlipSelect, onSlipClear,
  onSubmit, submitting, onViewSlip,
}: {
  addon: StoreAddonKey;
  icon: React.ElementType;
  title: string;
  description: string;
  active: boolean;
  pending: StoreAddonRequest | undefined;
  purchasing: boolean;
  onStartPurchase: () => void;
  onCancelPurchase: () => void;
  payCode: string;
  slipFile: File | null;
  slipPreview: string | null;
  note: string;
  setNote: (v: string) => void;
  slipInputRef: React.RefObject<HTMLInputElement | null>;
  onSlipSelect: (file: File) => void;
  onSlipClear: () => void;
  onSubmit: () => void;
  submitting: boolean;
  onViewSlip: (url: string) => void;
}) {
  const price = STORE_ADDON_PRICE[addon];

  return (
    <div className="bg-[#162032] border border-white/10 rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-orange-500/15 flex items-center justify-center flex-shrink-0">
            <Icon className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-white">{title}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-gray-400 border border-white/10">
                LKR {price.toLocaleString()}/mo
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5 max-w-md">{description}</p>
          </div>
        </div>
        {active ? (
          <span className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-green-500/15 text-green-400 flex-shrink-0">
            <CheckCircle className="w-3.5 h-3.5" /> Active
          </span>
        ) : pending ? (
          <span className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-400 flex-shrink-0">
            <Lock className="w-3.5 h-3.5" /> Pending approval
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-white/5 text-gray-400 border border-white/10 flex-shrink-0">
            <Lock className="w-3.5 h-3.5" /> Locked
          </span>
        )}
      </div>

      {active ? null : pending ? (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-200">
          Payment slip submitted — waiting on approval. This section stays locked until then.
          {pending.slipUrl && (
            <button
              onClick={() => onViewSlip(pending.slipUrl)}
              className="ml-2 text-orange-400 hover:text-orange-300 underline"
            >
              View slip
            </button>
          )}
        </div>
      ) : purchasing ? (
        <div className="bg-black/20 border border-white/10 rounded-xl p-4 space-y-4">
          <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3 text-xs text-gray-300 space-y-1">
            <p className="font-medium text-orange-300">Payment instructions</p>
            <p>1. Transfer <strong>LKR {price.toLocaleString()}</strong> to the PitStopIQ bank account.</p>
            <p>2. Use <strong className="text-orange-300 font-mono">{payCode}</strong> as the payment reference.</p>
            <p>3. Upload the bank slip below and submit. Once approved, {title} unlocks and its LKR{" "}
              {price.toLocaleString()}/mo fee is added to your regular subscription payment.</p>
          </div>

          <div className="space-y-2">
            <label className="text-xs text-gray-400">Upload payment slip</label>
            <input
              ref={slipInputRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onSlipSelect(f); }}
            />
            {slipPreview ? (
              <div className="relative">
                <img src={slipPreview} alt="slip" className="w-full max-h-48 object-contain rounded-lg border border-gray-700" />
                <button
                  onClick={onSlipClear}
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
                Click to upload
              </button>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-xs text-gray-400">Note (optional)</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything the reviewer should know"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={onSubmit}
              disabled={submitting || !slipFile}
              className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white text-sm font-semibold py-2.5 rounded-lg transition flex items-center justify-center gap-2"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {submitting ? "Submitting…" : "Submit for Approval"}
            </button>
            <button
              onClick={onCancelPurchase}
              className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-medium py-2.5 rounded-lg transition"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={onStartPurchase}
          className="flex items-center gap-1.5 text-xs font-medium bg-orange-500/15 hover:bg-orange-500/25 text-orange-400 px-3 py-1.5 rounded-lg transition"
        >
          <Upload className="w-3.5 h-3.5" />
          Purchase {title}
        </button>
      )}
    </div>
  );
}

// ── New Branch Request Card ──────────────────────────────────────────────────
// No payment slip: the super admin manually provisions the branch and
// settles billing (LKR 4,000/mo) once approved, so this just files a formal
// request in place of the old "contact us" instruction.
function BranchRequestCard({
  pending, showForm, onStartRequest, onCancel,
  branchName, setBranchName, branchAddress, setBranchAddress,
  branchPhone, setBranchPhone, branchDistrict, setBranchDistrict,
  branchPlan, setBranchPlan, branchNote, setBranchNote, onSubmit, submitting,
}: {
  pending: BranchRequest | undefined;
  showForm: boolean;
  onStartRequest: () => void;
  onCancel: () => void;
  branchName: string; setBranchName: (v: string) => void;
  branchAddress: string; setBranchAddress: (v: string) => void;
  branchPhone: string; setBranchPhone: (v: string) => void;
  branchDistrict: string; setBranchDistrict: (v: string) => void;
  branchPlan: "basic" | "pro"; setBranchPlan: (v: "basic" | "pro") => void;
  branchNote: string; setBranchNote: (v: string) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const canSubmit = branchName.trim() && branchAddress.trim() && branchPhone.trim() && branchDistrict;

  return (
    <div className="bg-[#162032] border border-white/10 rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-orange-500/15 flex items-center justify-center flex-shrink-0">
            <Building2 className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <span className="text-sm font-semibold text-white">New Branch</span>
            <p className="text-xs text-gray-400 mt-0.5 max-w-md">
              Ask us to set up an additional branch under your account — LKR {BRANCH_PRICE.pro.toLocaleString()}/mo on
              Pro or LKR {BRANCH_PRICE.basic.toLocaleString()}/mo on Basic. We'll reach out to confirm details and
              get it provisioned.
            </p>
          </div>
        </div>
        {pending && (
          <span className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-400 flex-shrink-0">
            <Lock className="w-3.5 h-3.5" /> Pending review
          </span>
        )}
      </div>

      {pending ? (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-200">
          Request for "{pending.requestedBranchName}" ({pending.requestedPlan === "pro" ? "Pro" : "Basic"} · LKR{" "}
          {pending.amount.toLocaleString()}/mo) submitted — we'll be in touch to get it set up.
        </div>
      ) : showForm ? (
        <div className="bg-black/20 border border-white/10 rounded-xl p-4 space-y-3">
          <FormField label="Branch Name">
            <input
              type="text"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder="e.g. Kandy Branch"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
            />
          </FormField>
          <FormField label="Address">
            <input
              type="text"
              value={branchAddress}
              onChange={(e) => setBranchAddress(e.target.value)}
              placeholder="Branch address"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
            />
          </FormField>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Phone">
              <input
                type="tel"
                value={branchPhone}
                onChange={(e) => setBranchPhone(e.target.value)}
                placeholder="07XXXXXXXX"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
              />
            </FormField>
            <FormField label="District">
              <select
                value={branchDistrict}
                onChange={(e) => setBranchDistrict(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
              >
                <option value="">Select district</option>
                {SRI_LANKA_DISTRICTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </FormField>
          </div>
          <FormField label="Plan for the new branch">
            <div className="grid grid-cols-2 gap-2">
              {(["pro", "basic"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setBranchPlan(p)}
                  className={`text-left px-3 py-2 rounded-lg border text-xs transition ${
                    branchPlan === p
                      ? "border-orange-500 bg-orange-500/10 text-white"
                      : "border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-600"
                  }`}
                >
                  <span className="block font-semibold">{p === "pro" ? "Pro" : "Basic"}</span>
                  <span className="text-gray-500">LKR {BRANCH_PRICE[p].toLocaleString()}/mo</span>
                </button>
              ))}
            </div>
          </FormField>
          <FormField label="Note (optional)">
            <input
              value={branchNote}
              onChange={(e) => setBranchNote(e.target.value)}
              placeholder="Anything else we should know"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
            />
          </FormField>
          <div className="flex gap-2 pt-1">
            <button
              onClick={onSubmit}
              disabled={submitting || !canSubmit}
              className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white text-sm font-semibold py-2.5 rounded-lg transition flex items-center justify-center gap-2"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {submitting ? "Submitting…" : "Submit Request"}
            </button>
            <button
              onClick={onCancel}
              className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-medium py-2.5 rounded-lg transition"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={onStartRequest}
          className="flex items-center gap-1.5 text-xs font-medium bg-orange-500/15 hover:bg-orange-500/25 text-orange-400 px-3 py-1.5 rounded-lg transition"
        >
          <Building2 className="w-3.5 h-3.5" />
          Request New Branch
        </button>
      )}
    </div>
  );
}

// ── SMS Top-up Package Card ──────────────────────────────────────────────────
// Not purchased → upload form (with a one-time / recurring choice) → Pending
// approval. Only one package can be mid-purchase at a time (shared state on
// SubscriptionTab), same pattern as StoreAddonCard.
function SmsPackageCard({
  pkg, pending, purchasing, billingType, setBillingType,
  onStartPurchase, onCancelPurchase, payCode,
  slipFile, slipPreview, note, setNote, slipInputRef, onSlipSelect, onSlipClear,
  onSubmit, submitting, onViewSlip,
}: {
  pkg: SmsPackageKey;
  pending: SmsPackageRequest | undefined;
  purchasing: boolean;
  billingType: SmsPackageBillingType;
  setBillingType: (v: SmsPackageBillingType) => void;
  onStartPurchase: () => void;
  onCancelPurchase: () => void;
  payCode: string;
  slipFile: File | null;
  slipPreview: string | null;
  note: string;
  setNote: (v: string) => void;
  slipInputRef: React.RefObject<HTMLInputElement | null>;
  onSlipSelect: (file: File) => void;
  onSlipClear: () => void;
  onSubmit: () => void;
  submitting: boolean;
  onViewSlip: (url: string) => void;
}) {
  const price = SMS_PACKAGE_PRICE[pkg];
  const quota = SMS_PACKAGE_QUOTA[pkg];
  const perSms = SMS_PACKAGE_PER_SMS[pkg];

  return (
    <div className="bg-[#162032] border border-white/10 rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white">{SMS_PACKAGE_LABEL[pkg]}</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-gray-400 border border-white/10">
              LKR {perSms.toFixed(2)}/SMS
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">LKR {price.toLocaleString()} for {quota.toLocaleString()} SMS credits</p>
        </div>
        {pending && (
          <span className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-400 flex-shrink-0">
            <Lock className="w-3.5 h-3.5" /> Pending
          </span>
        )}
      </div>

      {pending ? (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-200">
          Payment slip submitted ({pending.billingType === "recurring" ? "monthly" : "one-time"}) — waiting on approval.
          {pending.slipUrl && (
            <button
              onClick={() => onViewSlip(pending.slipUrl)}
              className="ml-2 text-orange-400 hover:text-orange-300 underline"
            >
              View slip
            </button>
          )}
        </div>
      ) : purchasing ? (
        <div className="bg-black/20 border border-white/10 rounded-xl p-4 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs text-gray-400">Add this to your monthly plan, or just this month?</label>
            <div className="flex gap-2">
              <button
                onClick={() => setBillingType("one_time")}
                className={`flex-1 text-xs font-medium py-2 rounded-lg border transition ${
                  billingType === "one_time"
                    ? "bg-orange-500/15 border-orange-500/40 text-orange-300"
                    : "bg-white/5 border-white/10 text-gray-400 hover:text-gray-200"
                }`}
              >
                Just this month
              </button>
              <button
                onClick={() => setBillingType("recurring")}
                className={`flex-1 text-xs font-medium py-2 rounded-lg border transition ${
                  billingType === "recurring"
                    ? "bg-orange-500/15 border-orange-500/40 text-orange-300"
                    : "bg-white/5 border-white/10 text-gray-400 hover:text-gray-200"
                }`}
              >
                Add to monthly plan
              </button>
            </div>
            {billingType === "recurring" && (
              <p className="text-xs text-gray-500">
                LKR {price.toLocaleString()}/mo will be added to your regular subscription payment going forward.
              </p>
            )}
          </div>

          <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3 text-xs text-gray-300 space-y-1">
            <p className="font-medium text-orange-300">Payment instructions</p>
            <p>1. Transfer <strong>LKR {price.toLocaleString()}</strong> to the PitStopIQ bank account.</p>
            <p>2. Use <strong className="text-orange-300 font-mono">{payCode}</strong> as the payment reference.</p>
            <p>3. Upload the bank slip below and submit. Once approved, {quota.toLocaleString()} SMS credits are added to your quota.</p>
          </div>

          <div className="space-y-2">
            <label className="text-xs text-gray-400">Upload payment slip</label>
            <input
              ref={slipInputRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onSlipSelect(f); }}
            />
            {slipPreview ? (
              <div className="relative">
                <img src={slipPreview} alt="slip" className="w-full max-h-48 object-contain rounded-lg border border-gray-700" />
                <button
                  onClick={onSlipClear}
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
                Click to upload
              </button>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-xs text-gray-400">Note (optional)</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything the reviewer should know"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={onSubmit}
              disabled={submitting || !slipFile}
              className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white text-sm font-semibold py-2.5 rounded-lg transition flex items-center justify-center gap-2"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {submitting ? "Submitting…" : "Submit for Approval"}
            </button>
            <button
              onClick={onCancelPurchase}
              className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-medium py-2.5 rounded-lg transition"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={onStartPurchase}
          className="flex items-center gap-1.5 text-xs font-medium bg-orange-500/15 hover:bg-orange-500/25 text-orange-400 px-3 py-1.5 rounded-lg transition"
        >
          <Upload className="w-3.5 h-3.5" />
          Purchase {SMS_PACKAGE_LABEL[pkg]}
        </button>
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
      // Plain collection fetch + client-side filter/sort — avoids depending on a
      // composite index for isDeleted + name (see the same fallback pattern in
      // InventoryListPage, and the vehicles/inventory export fix above).
      const snap = await getDocs(collection(db, "servicecenters", centerId, "customers"));
      const headers = ["Name", "Phone", "NIC", "Vehicle Count", "Last Service Date", "Notes", "Created At"];
      const rows = snap.docs
        .map(d => d.data())
        .filter(c => !c.isDeleted)
        .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")))
        .map(c => [
          c.name ?? "", c.phone ?? "", c.nic ?? "",
          String(c.vehicleCount ?? 0),
          c.lastServiceDate ? new Date(c.lastServiceDate.seconds * 1000).toISOString().split("T")[0] : "",
          c.notes ?? "",
          c.createdAt ? new Date(c.createdAt.seconds * 1000).toISOString().split("T")[0] : "",
        ]);
      downloadCSV(`customers_${today()}.csv`, headers, rows);
    } finally { setExporting(null); }
  }

  async function exportVehicles() {
    setExporting("vehicles");
    try {
      // Plain collection fetch + client-side filter/sort — avoids depending on a
      // composite index for isDeleted + plateNumber, which this project doesn't
      // have provisioned (see the same fallback pattern in InventoryListPage).
      const snap = await getDocs(collection(db, "servicecenters", centerId, "vehicles"));
      const headers = ["Plate", "Make", "Model", "Year", "Colour", "Customer", "Current Mileage (km)", "Next Service (km)", "Oil Brand", "Oil Grade", "Oil Notes", "Created At"];
      const rows = snap.docs
        .map(d => d.data())
        .filter(v => !v.isDeleted)
        .sort((a, b) => String(a.plateNumber ?? "").localeCompare(String(b.plateNumber ?? "")))
        .map(v => [
          v.plateNumber ?? "", v.make ?? "", v.model ?? "", String(v.year ?? ""),
          v.colour ?? "", v.customerName ?? "",
          String(v.currentMileageKm ?? 0), String(v.nextServiceMileageKm ?? 0),
          v.oilBrand ?? "", v.oilGrade ?? "", v.oilViscosityNotes ?? "",
          v.createdAt ? new Date(v.createdAt.seconds * 1000).toISOString().split("T")[0] : "",
        ]);
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
          j.jobNumber ?? "", j.plateNumber ?? "", j.customerName ?? "",
          jobTechnicianNames(j as TechnicianNameFields).join(" / "),
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
      // Plain collection fetch + client-side filter/sort — avoids depending on a
      // composite index for isArchived + name (see the same fallback pattern in
      // InventoryListPage).
      const snap = await getDocs(collection(db, "servicecenters", centerId, "inventory"));
      const headers = [
        "Name", "Category", "Unit", "Current Qty", "Threshold",
        "Purchase Price", "Distributor Price", "Outlet Price", "Service Center Price", "Marked Price",
        "Supplier Name", "Supplier Company", "Supplier Brand", "Supplier Phone", "Notes", "Created At",
      ];
      const rows = snap.docs
        .map(d => d.data())
        .filter(i => !i.isArchived)
        .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")))
        .map(i => [
          i.name ?? "", i.category ?? "", i.unit ?? "",
          String(i.currentQty ?? 0), String(i.threshold ?? 0),
          // Items saved before the price book existed only carry unitCost.
          String(i.purchasePrice ?? i.unitCost ?? ""),
          String(i.distributorPrice ?? ""), String(i.outletPrice ?? ""),
          String(i.serviceCenterPrice ?? ""), String(i.markedPrice ?? ""),
          i.supplierName ?? "", i.supplierCompany ?? "", i.supplierBrand ?? "", i.supplierPhone ?? "",
          i.notes ?? "",
          i.createdAt ? new Date(i.createdAt.seconds * 1000).toISOString().split("T")[0] : "",
        ]);
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
  // Reflects a request already recorded on the center, or one just submitted.
  const [requested, setRequested] = useState(!!center.deletionRequestedAt);
  const isDeletionPending = requested || !!center.deletionRequestedAt;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h2 className="text-base font-semibold text-red-400">{t("settings.danger.sectionTitle")}</h2>
        <p className="text-sm text-gray-400 mt-0.5">{t("settings.danger.subtitle")}</p>
      </div>

      {isDeletionPending ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-red-300 mb-1">{t("settings.danger.deletionPending")}</div>
              <p className="text-xs text-gray-400 leading-relaxed">
                {t("settings.danger.deletionPendingDesc")}
              </p>
            </div>
          </div>
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
          center={center}
          centerId={centerId}
          onClose={() => setShowDeleteModal(false)}
          onRequested={() => { setRequested(true); setShowDeleteModal(false); }}
        />
      )}
    </div>
  );
}

function DeleteAccountModal({ center, centerId, onClose, onRequested }: {
  center: ServiceCenter; centerId: string; onClose: () => void; onRequested: () => void;
}) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const centerName = center.name;
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isMatch = confirmText.trim() === centerName.trim();

  async function handleRequestDeletion() {
    if (!isMatch) { setError(t("settings.danger.nameNoMatch")); return; }
    setSubmitting(true);
    setError("");
    try {
      // Record the request for the super admin to approve. The account keeps
      // working until they approve; approval runs the deleteServiceCenter
      // callable, which permanently erases everything.
      await safeAddDoc(collection(db, "accountDeletionRequests"), {
        centerId,
        centerName,
        ownerUid: center.ownerUid ?? centerId,
        requestedBy: currentUser?.uid ?? "",
        requestedByName: currentUser?.displayName ?? "",
        status: "pending",
        createdAt: Timestamp.now(),
      });
      await safeUpdateDoc(doc(db, "servicecenters", centerId), {
        deletionRequestedAt: Timestamp.now(),
      });
      onRequested();
    } catch {
      setError(t("settings.danger.deleteError"));
      setSubmitting(false);
    }
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
            onClick={handleRequestDeletion}
            disabled={!isMatch || submitting}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white font-semibold py-2.5 rounded-lg transition text-sm flex items-center justify-center gap-2"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            {submitting ? t("settings.danger.requesting") : t("settings.danger.requestDeletion")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Services Tab ─────────────────────────────────────────────────────────────────
function ServicesTab({ center, centerId }: {
  center: ServiceCenter; centerId: string;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Owner/Manager both reach Settings, but editing here is its own permission.
  const editable = usePermission("settings.manageServiceLibrary");
  const isPro = center.plan === "pro";

  async function toggleInspection() {
    if (!editable || !isPro) return;
    setSaving(true);
    try {
      await safeUpdateDoc(doc(db, "servicecenters", centerId), {
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

// ── Role Permissions Tab ──────────────────────────────────────────────────────────
// Declared at module scope so it isn't recreated (and its state reset) on every
// render of the tab.
const RolePermissionsPageComponent = lazyWithRetry(() => import("./RolePermissionsPage"));

function RolePermissionsTab() {
  return (
    <Suspense fallback={<LoadingBlock className="py-8" expectedMs={1500} />}>
      <RolePermissionsPageComponent />
    </Suspense>
  );
}

// ── Utility ──────────────────────────────────────────────────────────────────────
function today(): string {
  return new Date().toISOString().split("T")[0];
}
