import { useState, useEffect } from "react";
import { AlertTriangle, Lock, RotateCcw, Save, Shield, Users2, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../contexts/AuthContext";
import { usePermissions } from "../../contexts/PermissionsContext";
import { DEFAULT_PERMISSIONS, getPermissionValue, mergeWithDefaults } from "../../lib/defaultPermissions";
import { SECTIONS, Toggle, type PermissionItem } from "../../components/settings/PermissionsEditor";
import type { RolePermissions, StaffRoleKey } from "../../types/permissions";

// ── Section / item definitions ────────────────────────────────────────────────
// (moved to ../../components/settings/PermissionsEditor, shared with the
// Custom Roles editor)

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

// ── Main page ─────────────────────────────────────────────────────────────────

function writeErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  if (code.includes("permission-denied")) {
    return "Firestore rejected the change — only the account Owner can edit role permissions.";
  }
  if (code.includes("unavailable")) {
    return "You appear to be offline. The change will not be saved until you reconnect.";
  }
  return "Could not save the permissions. Please try again.";
}

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
  const navigate = useNavigate();
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
  const [error, setError] = useState("");

  // Initialise local state once Firestore data arrives (only once, so local edits aren't overwritten)
  useEffect(() => {
    if (!loading && !initialised) {
      setLocalPerms({
        manager:      mergeWithDefaults("manager", permissions?.manager),
        technician:   mergeWithDefaults("technician", permissions?.technician),
        cashier:      mergeWithDefaults("cashier", permissions?.cashier),
        receptionist: mergeWithDefaults("receptionist", permissions?.receptionist),
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

  // A rejected write used to disappear silently — the button simply went back
  // to "Save Changes" and the change was never stored.
  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await saveRolePermissions(activeTab, localPerms[activeTab]);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(writeErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setResetting(true);
    setError("");
    try {
      await resetRolePermissions(activeTab);
      setLocalPerms(prev => ({ ...prev, [activeTab]: DEFAULT_PERMISSIONS[activeTab] }));
      setConfirmReset(false);
      setSaved(false);
    } catch (err) {
      setError(writeErrorMessage(err));
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
      <div className="flex items-center justify-between gap-3 flex-wrap">
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
        <button
          onClick={() => navigate("/settings/custom-roles")}
          className="flex items-center gap-2 px-4 py-2 text-sm text-gray-300 hover:text-white border border-white/10 hover:border-white/20 rounded-xl transition-colors"
        >
          <Users2 className="w-4 h-4" />
          Custom Roles
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {loading || !initialised ? (
        <div className="text-gray-400 text-sm py-8 text-center">{t("settings.rolePermissions.loading")}</div>
      ) : (
        <div className="space-y-4">
          {error && (
            <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
              <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

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
