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
    inventory: { view: true, create: true, edit: true, restock: true, viewLogs: true, delete: false, request: true, approveRequests: true },
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
    inventory: { view: true, create: false, edit: false, restock: false, viewLogs: false, delete: false, request: true, approveRequests: false },
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
    inventory: { view: true, create: false, edit: false, restock: false, viewLogs: true, delete: false, request: false, approveRequests: false },
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
    inventory: { view: false, create: false, edit: false, restock: false, viewLogs: false, delete: false, request: false, approveRequests: false },
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
