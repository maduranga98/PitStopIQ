import { useState, useEffect } from "react";
import { Lock, RotateCcw, Save, Shield } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../contexts/AuthContext";
import { usePermissions } from "../../contexts/PermissionsContext";
import { DEFAULT_PERMISSIONS, getPermissionValue } from "../../lib/defaultPermissions";
import type { RolePermissions, StaffRoleKey } from "../../types/permissions";

// ── Types ─────────────────────────────────────────────────────────────────────

type PermissionItem = {
  key: string;               // dot-notation path into RolePermissions
  labelKey: string;          // i18n key under settings.rolePermissions.perms.*
  lockedOffFor?: StaffRoleKey[];
};

type PermissionSection = {
  sectionKey: string;        // i18n key under settings.rolePermissions.sections.*
  items: PermissionItem[];
};

// ── Section / item definitions ────────────────────────────────────────────────

const SECTIONS: PermissionSection[] = [
  {
    sectionKey: "customers",
    items: [
      { key: "customers.view",           labelKey: "customersView" },
      { key: "customers.create",         labelKey: "customersCreate" },
      { key: "customers.edit",           labelKey: "customersEdit" },
      { key: "customers.delete",         labelKey: "customersDelete",         lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "customers.viewSmsHistory", labelKey: "customersViewSmsHistory" },
    ],
  },
  {
    sectionKey: "vehicles",
    items: [
      { key: "vehicles.view",          labelKey: "vehiclesView" },
      { key: "vehicles.create",        labelKey: "vehiclesCreate" },
      { key: "vehicles.edit",          labelKey: "vehiclesEdit" },
      { key: "vehicles.delete",        labelKey: "vehiclesDelete",        lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "vehicles.viewHistory",   labelKey: "vehiclesViewHistory" },
      { key: "vehicles.viewQr",        labelKey: "vehiclesViewQr" },
      { key: "vehicles.uploadPhotos",  labelKey: "vehiclesUploadPhotos" },
    ],
  },
  {
    sectionKey: "serviceLibrary",
    items: [
      { key: "serviceLibrary.view",   labelKey: "serviceLibraryView" },
      { key: "serviceLibrary.create", labelKey: "serviceLibraryCreate" },
      { key: "serviceLibrary.edit",   labelKey: "serviceLibraryEdit" },
      { key: "serviceLibrary.delete", labelKey: "serviceLibraryDelete", lockedOffFor: ["technician", "cashier", "receptionist"] },
    ],
  },
  {
    sectionKey: "jobs",
    items: [
      { key: "jobs.viewAll",          labelKey: "jobsViewAll" },
      { key: "jobs.viewOwn",          labelKey: "jobsViewOwn" },
      { key: "jobs.create",           labelKey: "jobsCreate" },
      { key: "jobs.edit",             labelKey: "jobsEdit" },
      { key: "jobs.assignTechnician", labelKey: "jobsAssignTechnician" },
      { key: "jobs.recordServices",   labelKey: "jobsRecordServices" },
      { key: "jobs.addParts",         labelKey: "jobsAddParts" },
      { key: "jobs.addNotes",         labelKey: "jobsAddNotes" },
      { key: "jobs.markInProgress",   labelKey: "jobsMarkInProgress" },
      { key: "jobs.markDone",         labelKey: "jobsMarkDone" },
      { key: "jobs.markDelivered",    labelKey: "jobsMarkDelivered" },
      { key: "jobs.delete",           labelKey: "jobsDelete",           lockedOffFor: ["technician", "cashier", "receptionist"] },
    ],
  },
  {
    sectionKey: "inspection",
    items: [
      { key: "inspection.conduct",   labelKey: "inspectionConduct" },
      { key: "inspection.view",      labelKey: "inspectionView" },
      { key: "inspection.addDamage", labelKey: "inspectionAddDamage" },
    ],
  },
  {
    sectionKey: "invoices",
    items: [
      { key: "invoices.view",          labelKey: "invoicesView",          lockedOffFor: ["technician", "receptionist"] },
      { key: "invoices.viewDetail",    labelKey: "invoicesViewDetail",    lockedOffFor: ["technician", "receptionist"] },
      { key: "invoices.create",        labelKey: "invoicesCreate",        lockedOffFor: ["technician", "receptionist"] },
      { key: "invoices.edit",          labelKey: "invoicesEdit",          lockedOffFor: ["technician", "receptionist"] },
      { key: "invoices.applyDiscount", labelKey: "invoicesApplyDiscount", lockedOffFor: ["technician", "receptionist"] },
      { key: "invoices.markPayment",   labelKey: "invoicesMarkPayment",   lockedOffFor: ["technician", "receptionist"] },
      { key: "invoices.downloadPdf",   labelKey: "invoicesDownloadPdf",   lockedOffFor: ["technician", "receptionist"] },
      { key: "invoices.shareWhatsapp", labelKey: "invoicesShareWhatsapp", lockedOffFor: ["technician", "receptionist"] },
      { key: "invoices.delete",        labelKey: "invoicesDelete",        lockedOffFor: ["technician", "cashier", "receptionist"] },
    ],
  },
  {
    sectionKey: "inventory",
    items: [
      { key: "inventory.view",     labelKey: "inventoryView",     lockedOffFor: ["receptionist"] },
      { key: "inventory.create",   labelKey: "inventoryCreate",   lockedOffFor: ["receptionist"] },
      { key: "inventory.edit",     labelKey: "inventoryEdit",     lockedOffFor: ["receptionist"] },
      { key: "inventory.restock",  labelKey: "inventoryRestock",  lockedOffFor: ["receptionist"] },
      { key: "inventory.viewLogs", labelKey: "inventoryViewLogs", lockedOffFor: ["receptionist"] },
      { key: "inventory.delete",   labelKey: "inventoryDelete",   lockedOffFor: ["technician", "cashier", "receptionist"] },
    ],
  },
  {
    sectionKey: "analytics",
    items: [
      { key: "analytics.viewRevenue",          labelKey: "analyticsViewRevenue",          lockedOffFor: ["technician", "receptionist"] },
      { key: "analytics.viewServiceFrequency", labelKey: "analyticsViewServiceFrequency", lockedOffFor: ["technician", "receptionist"] },
      { key: "analytics.viewTechPerformance",  labelKey: "analyticsViewTechPerformance",  lockedOffFor: ["cashier", "receptionist"] },
      { key: "analytics.viewSmsAnalytics",     labelKey: "analyticsViewSmsAnalytics",     lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "analytics.exportCsv",            labelKey: "analyticsExportCsv",            lockedOffFor: ["technician", "receptionist"] },
    ],
  },
  {
    sectionKey: "sms",
    items: [
      { key: "sms.viewLog",    labelKey: "smsViewLog" },
      { key: "sms.sendManual", labelKey: "smsSendManual" },
    ],
  },
  {
    sectionKey: "staff",
    items: [
      { key: "staff.view", labelKey: "staffView" },
    ],
  },
  {
    sectionKey: "settings",
    items: [
      { key: "settings.viewProfile",          labelKey: "settingsViewProfile" },
      { key: "settings.editProfile",          labelKey: "settingsEditProfile",          lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "settings.editSmsSettings",      labelKey: "settingsEditSmsSettings",      lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "settings.editReminderSettings", labelKey: "settingsEditReminderSettings", lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "settings.manageServiceLibrary", labelKey: "settingsManageServiceLibrary", lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "settings.toggleInspection",     labelKey: "settingsToggleInspection",     lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "settings.viewSubscription",     labelKey: "settingsViewSubscription",     lockedOffFor: ["technician", "cashier", "receptionist"] },
    ],
  },
];

type RoleTab = { key: StaffRoleKey; roleNameKey: string };

const ROLE_TABS: RoleTab[] = [
  { key: "manager",      roleNameKey: "settings.tabs.staff" }, // use own labels below
  { key: "technician",   roleNameKey: "" },
  { key: "cashier",      roleNameKey: "" },
  { key: "receptionist", roleNameKey: "" },
];

const ROLE_LABELS: Record<StaffRoleKey, string> = {
  manager:      "Manager",
  technician:   "Technician",
  cashier:      "Cashier",
  receptionist: "Receptionist",
};

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-150 focus:outline-none ${
        disabled
          ? "opacity-40 cursor-not-allowed bg-gray-700"
          : checked
            ? "bg-[#F97316] cursor-pointer"
            : "bg-gray-700 cursor-pointer"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-150 ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function buildDefault(): Record<StaffRoleKey, RolePermissions> {
  return {
    manager:      { ...DEFAULT_PERMISSIONS.manager },
    technician:   { ...DEFAULT_PERMISSIONS.technician },
    cashier:      { ...DEFAULT_PERMISSIONS.cashier },
    receptionist: { ...DEFAULT_PERMISSIONS.receptionist },
  };
}

export default function RolePermissionsPage() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { permissions, loading, saveRolePermissions, resetRolePermissions } = usePermissions();
  const isPro = currentUser?.centerPlan === "pro";

  const [activeTab, setActiveTab] = useState<StaffRoleKey>("manager");
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [localPerms, setLocalPerms] = useState<Record<StaffRoleKey, RolePermissions>>(buildDefault);
  const [initialised, setInitialised] = useState(false);

  // Initialise local state once Firestore data arrives (only once, so local edits aren't overwritten)
  useEffect(() => {
    if (!loading && !initialised) {
      setLocalPerms({
        manager:      permissions?.manager      ?? DEFAULT_PERMISSIONS.manager,
        technician:   permissions?.technician   ?? DEFAULT_PERMISSIONS.technician,
        cashier:      permissions?.cashier      ?? DEFAULT_PERMISSIONS.cashier,
        receptionist: permissions?.receptionist ?? DEFAULT_PERMISSIONS.receptionist,
      });
      setInitialised(true);
    }
  }, [loading, initialised, permissions]);

  function isLockedOff(item: PermissionItem, role: StaffRoleKey): boolean {
    return Boolean(item.lockedOffFor?.includes(role));
  }

  function getItemValue(item: PermissionItem, role: StaffRoleKey): boolean {
    if (isLockedOff(item, role)) return false;
    return getPermissionValue(localPerms[role], item.key);
  }

  function setItemValue(item: PermissionItem, role: StaffRoleKey, value: boolean) {
    if (isLockedOff(item, role)) return;
    const parts = item.key.split(".");
    if (parts.length !== 2) return;
    const [section, field] = parts;
    setLocalPerms(prev => ({
      ...prev,
      [role]: {
        ...prev[role],
        [section]: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...(prev[role] as any)[section],
          [field]: value,
        },
      },
    }));
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveRolePermissions(activeTab, localPerms[activeTab]);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setResetting(true);
    try {
      await resetRolePermissions(activeTab);
      setLocalPerms(prev => ({ ...prev, [activeTab]: DEFAULT_PERMISSIONS[activeTab] }));
      setConfirmReset(false);
      setSaved(false);
    } finally {
      setResetting(false);
    }
  }

  if (!isPro) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="bg-[#162032] border border-white/10 rounded-2xl p-8 max-w-sm text-center">
          <Shield className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h3 className="text-white font-semibold mb-1">{t("settings.rolePermissions.proRequired")}</h3>
          <p className="text-gray-400 text-sm">{t("settings.rolePermissions.proRequiredDesc")}</p>
        </div>
      </div>
    );
  }

  const activeRoleLabel = ROLE_LABELS[activeTab];

  return (
    <div className="space-y-6">
      {/* Role tabs */}
      <div className="flex gap-1 bg-[#0B1120] border border-white/10 rounded-xl p-1 w-fit">
        {ROLE_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); setConfirmReset(false); setSaved(false); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.key
                ? "bg-[#162032] text-white shadow"
                : "text-gray-400 hover:text-white"
            }`}
          >
            {ROLE_LABELS[tab.key]}
          </button>
        ))}
      </div>

      {loading || !initialised ? (
        <div className="text-gray-400 text-sm py-8 text-center">{t("settings.rolePermissions.loading")}</div>
      ) : (
        <div className="space-y-4">
          {/* Permission sections */}
          {SECTIONS.map(section => (
            <div key={section.sectionKey} className="bg-[#162032] border border-white/10 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/10">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {t(`settings.rolePermissions.sections.${section.sectionKey}`)}
                </span>
              </div>
              <div className="divide-y divide-white/5">
                {section.items.map(item => {
                  const locked = isLockedOff(item, activeTab);
                  const value = getItemValue(item, activeTab);
                  return (
                    <div key={item.key} className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-2 min-w-0">
                        {locked && <Lock className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />}
                        <span className={`text-sm ${locked ? "text-gray-600" : "text-gray-200"}`}>
                          {t(`settings.rolePermissions.perms.${item.labelKey}`)}
                        </span>
                        {locked && (
                          <span className="text-xs text-gray-600 italic hidden sm:inline">
                            — {t("settings.rolePermissions.notAvailableNote")}
                          </span>
                        )}
                      </div>
                      <div className="flex-shrink-0 ml-4">
                        <Toggle
                          checked={value}
                          onChange={v => setItemValue(item, activeTab, v)}
                          disabled={locked}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Always enabled */}
          <div className="bg-[#162032] border border-white/10 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/10">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                {t("settings.rolePermissions.alwaysEnabledSection")}
              </span>
            </div>
            <div className="divide-y divide-white/5">
              {(["dashboard", "changePassword"] as const).map(key => (
                <div key={key} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-400">
                      {t(`settings.rolePermissions.lockedOn.${key}`)}
                    </span>
                    <span className="text-xs text-gray-600 italic hidden sm:inline">
                      — {t(`settings.rolePermissions.lockedOn.${key}Note`)}
                    </span>
                  </div>
                  <Toggle checked={true} onChange={() => {}} disabled={true} />
                </div>
              ))}
            </div>
          </div>

          {/* Owner-only */}
          <div className="bg-[#162032] border border-white/10 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/10">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                {t("settings.rolePermissions.ownerOnlySection")}
              </span>
            </div>
            <div className="divide-y divide-white/5">
              {(["inviteStaff", "editRoles", "deactivateStaff", "managePermissions", "paymentSlip"] as const).map(key => (
                <div key={key} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Lock className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />
                    <span className="text-sm text-gray-600">
                      {t(`settings.rolePermissions.ownerOnly.${key}`)}
                    </span>
                    <span className="text-xs text-gray-600 italic hidden sm:inline">
                      — {t(`settings.rolePermissions.ownerOnly.${key}Note`)}
                    </span>
                  </div>
                  <Toggle checked={false} onChange={() => {}} disabled={true} />
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2">
            {confirmReset ? (
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-400">
                  {t("settings.rolePermissions.resetConfirm", { role: activeRoleLabel })}
                </span>
                <button
                  onClick={() => setConfirmReset(false)}
                  className="px-3 py-1.5 text-xs text-gray-400 hover:text-white border border-white/10 rounded-lg transition"
                >
                  {t("settings.rolePermissions.cancel")}
                </button>
                <button
                  onClick={handleReset}
                  disabled={resetting}
                  className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 border border-red-500/30 rounded-lg transition disabled:opacity-50"
                >
                  {resetting ? t("settings.rolePermissions.resetting") : t("settings.rolePermissions.reset")}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmReset(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm text-gray-400 hover:text-white border border-white/10 rounded-xl transition"
              >
                <RotateCcw className="w-4 h-4" />
                {t("settings.rolePermissions.resetToDefaults")}
              </button>
            )}

            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-[#F97316] hover:bg-[#EA6C10] text-white rounded-xl transition disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving
                ? t("settings.rolePermissions.saving")
                : saved
                  ? t("settings.rolePermissions.saved")
                  : t("settings.rolePermissions.saveChanges")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
