import { useState } from "react";
import { Lock, RotateCcw, Save, Shield } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { usePermissions } from "../../contexts/PermissionsContext";
import { DEFAULT_PERMISSIONS, LOCKED_OFF, getPermissionValue } from "../../lib/defaultPermissions";
import type { RolePermissions, StaffRoleKey } from "../../types/permissions";

// ── Types ─────────────────────────────────────────────────────────────────────

type PermissionItem = {
  key: string;       // dot-notation path into RolePermissions
  label: string;
  lockedOffFor?: StaffRoleKey[]; // roles where this is permanently locked off
  lockedOnAll?: boolean;         // locked on for every role (e.g. change password)
};

type PermissionSection = {
  title: string;
  items: PermissionItem[];
};

// ── Section definitions ───────────────────────────────────────────────────────

const SECTIONS: PermissionSection[] = [
  {
    title: "Customers",
    items: [
      { key: "customers.view",          label: "View customers" },
      { key: "customers.create",        label: "Add customers" },
      { key: "customers.edit",          label: "Edit customers" },
      { key: "customers.delete",        label: "Delete customers",  lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "customers.viewSmsHistory",label: "View SMS history" },
    ],
  },
  {
    title: "Vehicles",
    items: [
      { key: "vehicles.view",         label: "View vehicles" },
      { key: "vehicles.create",       label: "Add vehicles" },
      { key: "vehicles.edit",         label: "Edit vehicle details" },
      { key: "vehicles.delete",       label: "Delete vehicles",       lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "vehicles.viewHistory",  label: "View service history" },
      { key: "vehicles.viewQr",       label: "View vehicle QR code" },
      { key: "vehicles.uploadPhotos", label: "Upload vehicle photos" },
    ],
  },
  {
    title: "Service Library",
    items: [
      { key: "serviceLibrary.view",   label: "View service library" },
      { key: "serviceLibrary.create", label: "Add services" },
      { key: "serviceLibrary.edit",   label: "Edit services" },
      { key: "serviceLibrary.delete", label: "Delete services",       lockedOffFor: ["technician", "cashier", "receptionist"] },
    ],
  },
  {
    title: "Service Jobs",
    items: [
      { key: "jobs.viewAll",          label: "View all jobs (center-wide)" },
      { key: "jobs.viewOwn",          label: "View own assigned jobs only" },
      { key: "jobs.create",           label: "Create job cards" },
      { key: "jobs.edit",             label: "Edit job cards" },
      { key: "jobs.assignTechnician", label: "Assign technician" },
      { key: "jobs.recordServices",   label: "Record services performed" },
      { key: "jobs.addParts",         label: "Add parts used" },
      { key: "jobs.addNotes",         label: "Add internal notes" },
      { key: "jobs.markInProgress",   label: "Mark: Pending → In Progress" },
      { key: "jobs.markDone",         label: "Mark: In Progress → Done" },
      { key: "jobs.markDelivered",    label: "Mark: Done → Delivered" },
      { key: "jobs.delete",           label: "Delete job cards",       lockedOffFor: ["technician", "cashier", "receptionist"] },
    ],
  },
  {
    title: "Vehicle Inspection",
    items: [
      { key: "inspection.conduct",  label: "Conduct inspection" },
      { key: "inspection.view",     label: "View inspection records" },
      { key: "inspection.addDamage",label: "Add damage reports & photos" },
    ],
  },
  {
    title: "Invoices & Billing",
    items: [
      { key: "invoices.view",         label: "View invoice list",     lockedOffFor: ["technician", "receptionist"] },
      { key: "invoices.viewDetail",   label: "View invoice detail",   lockedOffFor: ["technician", "receptionist"] },
      { key: "invoices.create",       label: "Create invoices",       lockedOffFor: ["technician", "receptionist"] },
      { key: "invoices.edit",         label: "Edit line items",       lockedOffFor: ["technician", "receptionist"] },
      { key: "invoices.applyDiscount",label: "Apply discount",        lockedOffFor: ["technician", "receptionist"] },
      { key: "invoices.markPayment",  label: "Mark payment status",   lockedOffFor: ["technician", "receptionist"] },
      { key: "invoices.downloadPdf",  label: "Download PDF",          lockedOffFor: ["technician", "receptionist"] },
      { key: "invoices.shareWhatsapp",label: "Share via WhatsApp",    lockedOffFor: ["technician", "receptionist"] },
      { key: "invoices.delete",       label: "Delete invoices",       lockedOffFor: ["technician", "cashier", "receptionist"] },
    ],
  },
  {
    title: "Inventory",
    items: [
      { key: "inventory.view",     label: "View inventory",        lockedOffFor: ["receptionist"] },
      { key: "inventory.create",   label: "Add inventory items",   lockedOffFor: ["receptionist"] },
      { key: "inventory.edit",     label: "Edit inventory items",  lockedOffFor: ["receptionist"] },
      { key: "inventory.restock",  label: "Restock inventory",     lockedOffFor: ["receptionist"] },
      { key: "inventory.viewLogs", label: "View restock & deduction log", lockedOffFor: ["receptionist"] },
      { key: "inventory.delete",   label: "Delete inventory items",lockedOffFor: ["technician", "cashier", "receptionist"] },
    ],
  },
  {
    title: "Analytics & Reports",
    items: [
      { key: "analytics.viewRevenue",          label: "Revenue charts",              lockedOffFor: ["technician", "receptionist"] },
      { key: "analytics.viewServiceFrequency", label: "Service frequency reports",   lockedOffFor: ["technician", "receptionist"] },
      { key: "analytics.viewTechPerformance",  label: "Technician performance",      lockedOffFor: ["cashier", "receptionist"] },
      { key: "analytics.viewSmsAnalytics",     label: "SMS delivery analytics",      lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "analytics.exportCsv",            label: "Export CSV reports",          lockedOffFor: ["technician", "receptionist"] },
    ],
  },
  {
    title: "SMS & Notifications",
    items: [
      { key: "sms.viewLog",    label: "View SMS log" },
      { key: "sms.sendManual", label: "Send manual SMS" },
    ],
  },
  {
    title: "Staff",
    items: [
      { key: "staff.view", label: "View staff list" },
    ],
  },
  {
    title: "Settings",
    items: [
      { key: "settings.viewProfile",          label: "View center profile" },
      { key: "settings.editProfile",          label: "Edit center profile",       lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "settings.editSmsSettings",      label: "Edit SMS settings",         lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "settings.editReminderSettings", label: "Edit reminder settings",    lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "settings.manageServiceLibrary", label: "Manage service library",    lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "settings.toggleInspection",     label: "Toggle inspection module",  lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "settings.viewSubscription",     label: "View subscription status",  lockedOffFor: ["technician", "cashier", "receptionist"] },
    ],
  },
];

// Items that are owner-only and cannot be configured for any role
const OWNER_ONLY_ITEMS = [
  { label: "Invite staff members",        note: "Owner only — cannot be delegated" },
  { label: "Edit staff roles",            note: "Owner only — cannot be delegated" },
  { label: "Deactivate staff accounts",   note: "Owner only — cannot be delegated" },
  { label: "Manage role permissions",     note: "Owner only — cannot be delegated" },
  { label: "Upload payment slip",         note: "Owner only — billing responsibility" },
];

// Items locked ON for all roles
const LOCKED_ON_ITEMS = [
  { label: "View dashboard",              note: "Always accessible to all staff" },
  { label: "Change own password",         note: "Always accessible to all staff" },
];

// ── Role tab config ───────────────────────────────────────────────────────────

type RoleTab = { key: StaffRoleKey; label: string };

const ROLE_TABS: RoleTab[] = [
  { key: "manager",      label: "Manager" },
  { key: "technician",   label: "Technician" },
  { key: "cashier",      label: "Cashier" },
  { key: "receptionist", label: "Receptionist" },
];

// ── Toggle component ──────────────────────────────────────────────────────────

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

export default function RolePermissionsPage() {
  const { currentUser } = useAuth();
  const { permissions, loading, saveRolePermissions, resetRolePermissions } = usePermissions();
  const isPro = currentUser?.centerPlan === "pro";

  const [activeTab, setActiveTab] = useState<StaffRoleKey>("manager");
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [localPerms, setLocalPerms] = useState<Record<StaffRoleKey, RolePermissions>>(() => ({
    manager:      permissions?.manager      ?? DEFAULT_PERMISSIONS.manager,
    technician:   permissions?.technician   ?? DEFAULT_PERMISSIONS.technician,
    cashier:      permissions?.cashier      ?? DEFAULT_PERMISSIONS.cashier,
    receptionist: permissions?.receptionist ?? DEFAULT_PERMISSIONS.receptionist,
  }));

  // Sync local state when Firestore data arrives
  const [synced, setSynced] = useState(false);
  if (!synced && !loading && permissions) {
    setLocalPerms({
      manager:      permissions.manager,
      technician:   permissions.technician,
      cashier:      permissions.cashier,
      receptionist: permissions.receptionist,
    });
    setSynced(true);
  }

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
          <h3 className="text-white font-semibold mb-1">Pro Plan Required</h3>
          <p className="text-gray-400 text-sm">Role permission customisation is available on the Pro plan.</p>
        </div>
      </div>
    );
  }

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
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-gray-400 text-sm py-8 text-center">Loading permissions…</div>
      ) : (
        <div className="space-y-4">
          {/* Permission sections */}
          {SECTIONS.map(section => (
            <div key={section.title} className="bg-[#162032] border border-white/10 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/10">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{section.title}</span>
              </div>
              <div className="divide-y divide-white/5">
                {section.items.map(item => {
                  const locked = isLockedOff(item, activeTab);
                  const value = getItemValue(item, activeTab);
                  return (
                    <div key={item.key} className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-2">
                        {locked && <Lock className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />}
                        <span className={`text-sm ${locked ? "text-gray-600" : "text-gray-200"}`}>{item.label}</span>
                        {locked && (
                          <span className="text-xs text-gray-600 italic">— not available for this role</span>
                        )}
                      </div>
                      <Toggle
                        checked={value}
                        onChange={v => setItemValue(item, activeTab, v)}
                        disabled={locked}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Locked ON section */}
          <div className="bg-[#162032] border border-white/10 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/10">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Always Enabled</span>
            </div>
            <div className="divide-y divide-white/5">
              {LOCKED_ON_ITEMS.map(item => (
                <div key={item.label} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-400">{item.label}</span>
                    <span className="text-xs text-gray-600 italic">— {item.note}</span>
                  </div>
                  <Toggle checked={true} onChange={() => {}} disabled={true} />
                </div>
              ))}
            </div>
          </div>

          {/* Owner-only locked section */}
          <div className="bg-[#162032] border border-white/10 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/10">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Owner Only</span>
            </div>
            <div className="divide-y divide-white/5">
              {OWNER_ONLY_ITEMS.map(item => (
                <div key={item.label} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Lock className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />
                    <span className="text-sm text-gray-600">{item.label}</span>
                    <span className="text-xs text-gray-600 italic">— {item.note}</span>
                  </div>
                  <Toggle checked={false} onChange={() => {}} disabled={true} />
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2">
            {/* Reset confirmation */}
            {confirmReset ? (
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-400">
                  Reset {ROLE_TABS.find(t => t.key === activeTab)?.label} to defaults?
                </span>
                <button
                  onClick={() => setConfirmReset(false)}
                  className="px-3 py-1.5 text-xs text-gray-400 hover:text-white border border-white/10 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReset}
                  disabled={resetting}
                  className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 border border-red-500/30 rounded-lg transition disabled:opacity-50"
                >
                  {resetting ? "Resetting…" : "Reset"}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmReset(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm text-gray-400 hover:text-white border border-white/10 rounded-xl transition"
              >
                <RotateCcw className="w-4 h-4" />
                Reset to Defaults
              </button>
            )}

            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-[#F97316] hover:bg-[#EA6C10] text-white rounded-xl transition disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? "Saving…" : saved ? "Saved!" : "Save Changes"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
