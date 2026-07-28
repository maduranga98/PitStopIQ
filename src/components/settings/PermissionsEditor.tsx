import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { RolePermissions, StaffRoleKey } from "../../types/permissions";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PermissionItem = {
  key: string;               // dot-notation path into RolePermissions
  labelKey: string;          // i18n key under settings.rolePermissions.perms.*
  lockedOffFor?: StaffRoleKey[];
};

export type PermissionSection = {
  sectionKey: string;        // i18n key under settings.rolePermissions.sections.*
  items: PermissionItem[];
};

// ── Section / item definitions ────────────────────────────────────────────────
// Single source of truth for the feature catalog shown by both the built-in
// Role Permissions editor and the Custom Roles editor.

export const SECTIONS: PermissionSection[] = [
  {
    sectionKey: "customers",
    items: [
      { key: "customers.view",           labelKey: "customersView",           lockedOffFor: ["technician"] },
      { key: "customers.create",         labelKey: "customersCreate",         lockedOffFor: ["technician"] },
      { key: "customers.edit",           labelKey: "customersEdit",           lockedOffFor: ["technician"] },
      { key: "customers.delete",         labelKey: "customersDelete",         lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "customers.viewSmsHistory", labelKey: "customersViewSmsHistory", lockedOffFor: ["technician"] },
    ],
  },
  {
    sectionKey: "vehicles",
    items: [
      { key: "vehicles.view",          labelKey: "vehiclesView",          lockedOffFor: ["technician"] },
      { key: "vehicles.create",        labelKey: "vehiclesCreate",        lockedOffFor: ["technician"] },
      { key: "vehicles.edit",          labelKey: "vehiclesEdit",          lockedOffFor: ["technician"] },
      { key: "vehicles.delete",        labelKey: "vehiclesDelete",        lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "vehicles.viewHistory",   labelKey: "vehiclesViewHistory",   lockedOffFor: ["technician"] },
      { key: "vehicles.viewQr",        labelKey: "vehiclesViewQr",        lockedOffFor: ["technician"] },
      { key: "vehicles.uploadPhotos",  labelKey: "vehiclesUploadPhotos",  lockedOffFor: ["technician"] },
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
    sectionKey: "quotations",
    items: [
      { key: "quotations.view",          labelKey: "quotationsView",          lockedOffFor: ["technician", "receptionist"] },
      { key: "quotations.viewDetail",    labelKey: "quotationsViewDetail",    lockedOffFor: ["technician", "receptionist"] },
      { key: "quotations.create",        labelKey: "quotationsCreate",        lockedOffFor: ["technician", "receptionist"] },
      { key: "quotations.edit",          labelKey: "quotationsEdit",          lockedOffFor: ["technician", "receptionist"] },
      { key: "quotations.downloadPdf",   labelKey: "quotationsDownloadPdf",   lockedOffFor: ["technician", "receptionist"] },
      { key: "quotations.shareWhatsapp", labelKey: "quotationsShareWhatsapp", lockedOffFor: ["technician", "receptionist"] },
      { key: "quotations.delete",        labelKey: "quotationsDelete",        lockedOffFor: ["technician", "cashier", "receptionist"] },
    ],
  },
  {
    sectionKey: "inventory",
    items: [
      { key: "inventory.view",            labelKey: "inventoryView",            lockedOffFor: ["receptionist"] },
      { key: "inventory.request",         labelKey: "inventoryRequest",         lockedOffFor: ["cashier", "receptionist"] },
      { key: "inventory.approveRequests", labelKey: "inventoryApproveRequests", lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "inventory.create",          labelKey: "inventoryCreate",          lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "inventory.edit",            labelKey: "inventoryEdit",            lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "inventory.restock",         labelKey: "inventoryRestock",         lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "inventory.viewLogs",        labelKey: "inventoryViewLogs",        lockedOffFor: ["technician", "receptionist"] },
      { key: "inventory.delete",          labelKey: "inventoryDelete",          lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "inventory.manageCategories", labelKey: "inventoryManageCategories", lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "inventory.stockCount",       labelKey: "inventoryStockCount",       lockedOffFor: ["technician", "cashier", "receptionist"] },
    ],
  },
  {
    sectionKey: "outlets",
    items: [
      { key: "outlets.view",   labelKey: "outletsView",   lockedOffFor: ["technician", "receptionist"] },
      { key: "outlets.create", labelKey: "outletsCreate", lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "outlets.edit",   labelKey: "outletsEdit",   lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "outlets.delete", labelKey: "outletsDelete", lockedOffFor: ["technician", "cashier", "receptionist"] },
    ],
  },
  {
    sectionKey: "pos",
    items: [
      { key: "pos.view",      labelKey: "posView",      lockedOffFor: ["technician", "receptionist"] },
      { key: "pos.sell",      labelKey: "posSell",      lockedOffFor: ["technician", "receptionist"] },
      { key: "pos.void",      labelKey: "posVoid",      lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "pos.viewSales", labelKey: "posViewSales", lockedOffFor: ["technician", "receptionist"] },
    ],
  },
  {
    sectionKey: "suppliers",
    items: [
      { key: "suppliers.view",          labelKey: "suppliersView",          lockedOffFor: ["technician", "receptionist"] },
      { key: "suppliers.create",        labelKey: "suppliersCreate",        lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "suppliers.edit",          labelKey: "suppliersEdit",          lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "suppliers.delete",        labelKey: "suppliersDelete",        lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "suppliers.recordSupply",  labelKey: "suppliersRecordSupply",  lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "suppliers.viewSupplies",  labelKey: "suppliersViewSupplies",  lockedOffFor: ["technician", "cashier", "receptionist"] },
    ],
  },
  {
    sectionKey: "distributors",
    items: [
      { key: "distributors.view",           labelKey: "distributorsView",           lockedOffFor: ["technician", "receptionist"] },
      { key: "distributors.create",         labelKey: "distributorsCreate",         lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "distributors.edit",           labelKey: "distributorsEdit",           lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "distributors.delete",         labelKey: "distributorsDelete",         lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "distributors.shareLink",      labelKey: "distributorsShareLink",      lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "distributors.viewOrders",     labelKey: "distributorsViewOrders",     lockedOffFor: ["technician", "receptionist"] },
      { key: "distributors.finalizeOrders", labelKey: "distributorsFinalizeOrders", lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "distributors.release",        labelKey: "distributorsRelease",        lockedOffFor: ["technician", "cashier", "receptionist"] },
      { key: "distributors.recordPayments", labelKey: "distributorsRecordPayments", lockedOffFor: ["technician", "receptionist"] },
      { key: "distributors.manageStockRequests", labelKey: "distributorsManageStockRequests", lockedOffFor: ["technician", "cashier", "receptionist"] },
    ],
  },
  {
    sectionKey: "analytics",
    items: [
      { key: "analytics.viewRevenue",          labelKey: "analyticsViewRevenue",          lockedOffFor: ["technician", "receptionist"] },
      { key: "analytics.viewServiceFrequency", labelKey: "analyticsViewServiceFrequency", lockedOffFor: ["technician", "receptionist"] },
      { key: "analytics.viewTechPerformance",  labelKey: "analyticsViewTechPerformance",  lockedOffFor: ["technician", "cashier", "receptionist"] },
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

// ── Toggle ────────────────────────────────────────────────────────────────────

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
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

// ── Grid ──────────────────────────────────────────────────────────────────────
// Renders the full feature catalog as toggle rows grouped by section. Used by
// both the built-in Role Permissions editor (where some toggles are locked
// off per role) and the Custom Roles editor (where nothing is locked — a
// custom role's feature grid is fully independent of its base role).

export function PermissionsGrid({
  perms, onChange, isLockedOff,
}: {
  perms: RolePermissions;
  onChange: (key: string, value: boolean) => void;
  isLockedOff?: (item: PermissionItem) => boolean;
}) {
  const { t } = useTranslation();

  function getValue(item: PermissionItem): boolean {
    const parts = item.key.split(".");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let node: any = perms;
    for (const part of parts) {
      if (node == null || typeof node !== "object") return false;
      node = node[part];
    }
    return Boolean(node);
  }

  return (
    <div className="space-y-4">
      {SECTIONS.map(section => (
        <div key={section.sectionKey} className="bg-[#162032] border border-white/10 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/10">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              {t(`settings.rolePermissions.sections.${section.sectionKey}`)}
            </span>
          </div>
          <div className="divide-y divide-white/5">
            {section.items.map(item => {
              const locked = isLockedOff?.(item) ?? false;
              const value = locked ? false : getValue(item);
              return (
                <div key={item.key} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {locked && <Lock className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />}
                    <span className={`text-sm ${locked ? "text-gray-600" : "text-gray-200"}`}>
                      {t(`settings.rolePermissions.perms.${item.labelKey}`)}
                    </span>
                  </div>
                  <div className="flex-shrink-0 ml-4">
                    <Toggle
                      checked={value}
                      onChange={v => onChange(item.key, v)}
                      disabled={locked}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
