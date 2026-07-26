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
    // Ask the workshop for stock (technicians request parts they need for a job)
    request: boolean;
    // Approve/reject/issue those requests
    approveRequests: boolean;
    // Maintain the center's custom item categories
    manageCategories: boolean;
  };
  distributors: {
    view: boolean;
    create: boolean;
    edit: boolean;
    delete: boolean;
    // Generate/copy/revoke the link a distributor uses to reach their portal
    shareLink: boolean;
    viewOrders: boolean;
    // Finalize a purchase order, which releases the stock to the distributor
    finalizeOrders: boolean;
    // Hand stock over directly, without a purchase order
    release: boolean;
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
