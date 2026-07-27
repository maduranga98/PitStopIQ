import type { RolePermissions, StaffRoleKey } from "../types/permissions";

// Default permission values per role (from the PitstopIQ Role Permissions Plan v1.0)
export const DEFAULT_PERMISSIONS: Record<StaffRoleKey, RolePermissions> = {
  manager: {
    customers: { view: true, create: true, edit: true, delete: false, viewSmsHistory: true },
    vehicles: { view: true, create: true, edit: true, delete: false, viewHistory: true, viewQr: true, uploadPhotos: true },
    serviceLibrary: { view: true, create: true, edit: true, delete: false },
    jobs: { viewAll: true, viewOwn: true, create: true, edit: true, assignTechnician: true, recordServices: true, addParts: true, addNotes: true, markInProgress: true, markDone: true, markDelivered: true, delete: true },
    inspection: { conduct: true, view: true, addDamage: true },
    invoices: { view: true, viewDetail: true, create: true, edit: true, applyDiscount: true, markPayment: true, downloadPdf: true, shareWhatsapp: true, delete: true },
    inventory: { view: true, create: true, edit: true, restock: true, viewLogs: true, delete: false, request: true, approveRequests: true, manageCategories: true },
    suppliers: { view: true, create: true, edit: true, delete: false, recordSupply: true, viewSupplies: true },
    distributors: { view: true, create: true, edit: true, delete: false, shareLink: true, viewOrders: true, finalizeOrders: true, release: true, recordPayments: true, manageStockRequests: true },
    analytics: { viewRevenue: true, viewServiceFrequency: true, viewTechPerformance: true, viewSmsAnalytics: true, exportCsv: true },
    sms: { viewLog: true, sendManual: true },
    staff: { view: true },
    settings: { viewProfile: true, editProfile: false, editSmsSettings: false, editReminderSettings: false, manageServiceLibrary: true, toggleInspection: false, viewSubscription: false },
  },
  // A technician's app is deliberately narrow: the jobs assigned to them and
  // the stock they need to finish those jobs. No customer directory, no
  // vehicle directory, no money.
  technician: {
    customers: { view: false, create: false, edit: false, delete: false, viewSmsHistory: false },
    vehicles: { view: false, create: false, edit: false, delete: false, viewHistory: false, viewQr: false, uploadPhotos: false },
    serviceLibrary: { view: true, create: false, edit: false, delete: false },
    jobs: { viewAll: false, viewOwn: true, create: false, edit: false, assignTechnician: false, recordServices: true, addParts: true, addNotes: true, markInProgress: true, markDone: true, markDelivered: false, delete: false },
    inspection: { conduct: true, view: true, addDamage: true },
    invoices: { view: false, viewDetail: false, create: false, edit: false, applyDiscount: false, markPayment: false, downloadPdf: false, shareWhatsapp: false, delete: false },
    inventory: { view: true, create: false, edit: false, restock: false, viewLogs: false, delete: false, request: true, approveRequests: false, manageCategories: false },
    suppliers: { view: false, create: false, edit: false, delete: false, recordSupply: false, viewSupplies: false },
    distributors: { view: false, create: false, edit: false, delete: false, shareLink: false, viewOrders: false, finalizeOrders: false, release: false, recordPayments: false, manageStockRequests: false },
    analytics: { viewRevenue: false, viewServiceFrequency: false, viewTechPerformance: false, viewSmsAnalytics: false, exportCsv: false },
    sms: { viewLog: false, sendManual: false },
    staff: { view: false },
    settings: { viewProfile: false, editProfile: false, editSmsSettings: false, editReminderSettings: false, manageServiceLibrary: false, toggleInspection: false, viewSubscription: false },
  },
  cashier: {
    customers: { view: true, create: false, edit: false, delete: false, viewSmsHistory: true },
    vehicles: { view: true, create: false, edit: false, delete: false, viewHistory: true, viewQr: false, uploadPhotos: false },
    serviceLibrary: { view: true, create: false, edit: false, delete: false },
    jobs: { viewAll: true, viewOwn: false, create: false, edit: false, assignTechnician: false, recordServices: false, addParts: false, addNotes: true, markInProgress: false, markDone: false, markDelivered: true, delete: false },
    inspection: { conduct: false, view: false, addDamage: false },
    invoices: { view: true, viewDetail: true, create: true, edit: true, applyDiscount: true, markPayment: true, downloadPdf: true, shareWhatsapp: true, delete: false },
    // Cashiers bill the parts that were used, so they need to see stock and
    // its movement log — read-only (Firestore rules match this).
    inventory: { view: true, create: false, edit: false, restock: false, viewLogs: true, delete: false, request: false, approveRequests: false, manageCategories: false },
    // Suppliers are a buying relationship the owner runs; a cashier only needs
    // to know who supplied a part, which the item itself already carries.
    suppliers: { view: true, create: false, edit: false, delete: false, recordSupply: false, viewSupplies: false },
    // Cashiers settle what distributors owe: they read the order ledger and
    // record payments against it, but never release stock themselves.
    distributors: { view: true, create: false, edit: false, delete: false, shareLink: false, viewOrders: true, finalizeOrders: false, release: false, recordPayments: true, manageStockRequests: false },
    analytics: { viewRevenue: false, viewServiceFrequency: false, viewTechPerformance: false, viewSmsAnalytics: false, exportCsv: false },
    sms: { viewLog: false, sendManual: false },
    staff: { view: false },
    settings: { viewProfile: false, editProfile: false, editSmsSettings: false, editReminderSettings: false, manageServiceLibrary: false, toggleInspection: false, viewSubscription: false },
  },
  receptionist: {
    customers: { view: true, create: true, edit: true, delete: false, viewSmsHistory: false },
    vehicles: { view: true, create: true, edit: true, delete: false, viewHistory: true, viewQr: true, uploadPhotos: true },
    serviceLibrary: { view: true, create: false, edit: false, delete: false },
    jobs: { viewAll: true, viewOwn: false, create: true, edit: true, assignTechnician: true, recordServices: false, addParts: false, addNotes: true, markInProgress: false, markDone: false, markDelivered: true, delete: false },
    inspection: { conduct: true, view: true, addDamage: true },
    invoices: { view: false, viewDetail: false, create: false, edit: false, applyDiscount: false, markPayment: false, downloadPdf: false, shareWhatsapp: false, delete: false },
    inventory: { view: false, create: false, edit: false, restock: false, viewLogs: false, delete: false, request: false, approveRequests: false, manageCategories: false },
    suppliers: { view: false, create: false, edit: false, delete: false, recordSupply: false, viewSupplies: false },
    distributors: { view: false, create: false, edit: false, delete: false, shareLink: false, viewOrders: false, finalizeOrders: false, release: false, recordPayments: false, manageStockRequests: false },
    analytics: { viewRevenue: false, viewServiceFrequency: false, viewTechPerformance: false, viewSmsAnalytics: false, exportCsv: false },
    sms: { viewLog: false, sendManual: false },
    staff: { view: false },
    settings: { viewProfile: false, editProfile: false, editSmsSettings: false, editReminderSettings: false, manageServiceLibrary: false, toggleInspection: false, viewSubscription: false },
  },
};

// Permissions permanently locked OFF (✗) for a role — cannot be enabled by the owner
export const LOCKED_OFF: Record<StaffRoleKey, ReadonlySet<string>> = {
  manager: new Set([]),
  technician: new Set([
    // The customer directory and the vehicle directory are not part of the
    // technician app — a job card already carries the plate and customer name.
    "customers.view",
    "customers.create",
    "customers.edit",
    "customers.delete",
    "customers.viewSmsHistory",
    "vehicles.view",
    "vehicles.create",
    "vehicles.edit",
    "vehicles.delete",
    "vehicles.viewHistory",
    "vehicles.viewQr",
    "vehicles.uploadPhotos",
    "serviceLibrary.delete",
    "jobs.delete",
    "invoices.view",
    "invoices.viewDetail",
    "invoices.create",
    "invoices.edit",
    "invoices.applyDiscount",
    "invoices.markPayment",
    "invoices.downloadPdf",
    "invoices.shareWhatsapp",
    "invoices.delete",
    "inventory.create",
    "inventory.edit",
    "inventory.restock",
    "inventory.viewLogs",
    "inventory.delete",
    "inventory.approveRequests",
    "inventory.manageCategories",
    // Buying stock in is the office's job, not the workshop floor's.
    "suppliers.view",
    "suppliers.create",
    "suppliers.edit",
    "suppliers.delete",
    "suppliers.recordSupply",
    "suppliers.viewSupplies",
    // Distributors are a commercial relationship the owner runs — nothing in
    // the technician app touches it.
    "distributors.view",
    "distributors.create",
    "distributors.edit",
    "distributors.delete",
    "distributors.shareLink",
    "distributors.viewOrders",
    "distributors.finalizeOrders",
    "distributors.release",
    "distributors.recordPayments",
    "distributors.manageStockRequests",
    // No reporting for technicians — they see their own job list, nothing else.
    "analytics.viewRevenue",
    "analytics.viewServiceFrequency",
    "analytics.viewTechPerformance",
    "analytics.viewSmsAnalytics",
    "analytics.exportCsv",
    "settings.editProfile",
    "settings.editSmsSettings",
    "settings.editReminderSettings",
    "settings.manageServiceLibrary",
    "settings.toggleInspection",
    "settings.viewSubscription",
  ]),
  cashier: new Set([
    "customers.delete",
    "vehicles.delete",
    "serviceLibrary.delete",
    "jobs.delete",
    "invoices.delete",
    "inventory.create",
    "inventory.edit",
    "inventory.restock",
    "inventory.delete",
    "inventory.request",
    "inventory.approveRequests",
    "inventory.manageCategories",
    "suppliers.create",
    "suppliers.edit",
    "suppliers.delete",
    "suppliers.recordSupply",
    "suppliers.viewSupplies",
    "distributors.create",
    "distributors.edit",
    "distributors.delete",
    "distributors.shareLink",
    "distributors.finalizeOrders",
    "distributors.release",
    "distributors.manageStockRequests",
    "analytics.viewTechPerformance",
    "analytics.viewSmsAnalytics",
    "settings.editProfile",
    "settings.editSmsSettings",
    "settings.editReminderSettings",
    "settings.manageServiceLibrary",
    "settings.toggleInspection",
    "settings.viewSubscription",
  ]),
  receptionist: new Set([
    "customers.delete",
    "vehicles.delete",
    "serviceLibrary.delete",
    "jobs.delete",
    "invoices.view",
    "invoices.viewDetail",
    "invoices.create",
    "invoices.edit",
    "invoices.applyDiscount",
    "invoices.markPayment",
    "invoices.downloadPdf",
    "invoices.shareWhatsapp",
    "invoices.delete",
    "inventory.view",
    "inventory.create",
    "inventory.edit",
    "inventory.restock",
    "inventory.viewLogs",
    "inventory.delete",
    "inventory.request",
    "inventory.approveRequests",
    "inventory.manageCategories",
    "suppliers.view",
    "suppliers.create",
    "suppliers.edit",
    "suppliers.delete",
    "suppliers.recordSupply",
    "suppliers.viewSupplies",
    "distributors.view",
    "distributors.create",
    "distributors.edit",
    "distributors.delete",
    "distributors.shareLink",
    "distributors.viewOrders",
    "distributors.finalizeOrders",
    "distributors.release",
    "distributors.recordPayments",
    "distributors.manageStockRequests",
    "analytics.viewRevenue",
    "analytics.viewServiceFrequency",
    "analytics.viewTechPerformance",
    "analytics.viewSmsAnalytics",
    "analytics.exportCsv",
    "settings.editProfile",
    "settings.editSmsSettings",
    "settings.editReminderSettings",
    "settings.manageServiceLibrary",
    "settings.toggleInspection",
    "settings.viewSubscription",
  ]),
};

// Permissions permanently locked ON (★) for all staff roles
// D1 (dashboard) and SE7 (change password) are always accessible; they are
// not stored in the permissions document — they are hardcoded as always true.
export const GLOBAL_LOCKED_ON = new Set<string>([
  // No stored-permission keys here; dashboard access and password change
  // are handled outside this system.
]);

// A permissions document saved by an older build has no entry for permissions
// added since. Reading those as `false` silently switches features off for
// every center that ever customised a role, so fall back to the role default
// for any key the stored document doesn't mention.
export function mergeWithDefaults(role: StaffRoleKey, stored: RolePermissions | undefined): RolePermissions {
  const defaults = DEFAULT_PERMISSIONS[role];
  if (!stored) return defaults;
  const merged = {} as Record<string, Record<string, boolean>>;
  for (const [section, fields] of Object.entries(defaults)) {
    const storedSection = (stored as unknown as Record<string, Record<string, boolean> | undefined>)[section];
    merged[section] = { ...fields, ...(storedSection ?? {}) };
  }
  return merged as unknown as RolePermissions;
}

// Retrieve the value at a dot-notation path from a permissions object
export function getPermissionValue(perms: RolePermissions, key: string): boolean {
  const parts = key.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node: any = perms;
  for (const part of parts) {
    if (node == null || typeof node !== "object") return false;
    node = node[part];
  }
  return Boolean(node);
}
