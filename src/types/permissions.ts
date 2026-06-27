export interface RolePermissions {
  customers: {
    view: boolean;
    create: boolean;
    edit: boolean;
    delete: boolean;
    viewSmsHistory: boolean;
  };
  vehicles: {
    view: boolean;
    create: boolean;
    edit: boolean;
    delete: boolean;
    viewHistory: boolean;
    viewQr: boolean;
    uploadPhotos: boolean;
  };
  serviceLibrary: {
    view: boolean;
    create: boolean;
    edit: boolean;
    delete: boolean;
  };
  jobs: {
    viewAll: boolean;
    viewOwn: boolean;
    create: boolean;
    edit: boolean;
    assignTechnician: boolean;
    recordServices: boolean;
    addParts: boolean;
    addNotes: boolean;
    markInProgress: boolean;
    markDone: boolean;
    markDelivered: boolean;
    delete: boolean;
  };
  inspection: {
    conduct: boolean;
    view: boolean;
    addDamage: boolean;
  };
  invoices: {
    view: boolean;
    viewDetail: boolean;
    create: boolean;
    edit: boolean;
    applyDiscount: boolean;
    markPayment: boolean;
    downloadPdf: boolean;
    shareWhatsapp: boolean;
    delete: boolean;
  };
  inventory: {
    view: boolean;
    create: boolean;
    edit: boolean;
    restock: boolean;
    viewLogs: boolean;
    delete: boolean;
  };
  analytics: {
    viewRevenue: boolean;
    viewServiceFrequency: boolean;
    viewTechPerformance: boolean;
    viewSmsAnalytics: boolean;
    exportCsv: boolean;
  };
  sms: {
    viewLog: boolean;
    sendManual: boolean;
  };
  staff: {
    view: boolean;
  };
  settings: {
    viewProfile: boolean;
    editProfile: boolean;
    editSmsSettings: boolean;
    editReminderSettings: boolean;
    manageServiceLibrary: boolean;
    toggleInspection: boolean;
    viewSubscription: boolean;
  };
}

export type StaffRoleKey = "manager" | "technician" | "cashier" | "receptionist";
export type AllRolePermissions = Record<StaffRoleKey, RolePermissions>;
