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
  quotations: {
    view: boolean;
    viewDetail: boolean;
    create: boolean;
    edit: boolean;
    delete: boolean;
    downloadPdf: boolean;
    shareWhatsapp: boolean;
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
    // Run a physical stock count and finalize its adjustments
    stockCount: boolean;
  };
  outlets: {
    view: boolean;
    create: boolean;
    edit: boolean;
    delete: boolean;
  };
  pos: {
    view: boolean;
    // Ring up an outlet sale, which deducts inventory
    sell: boolean;
    // Void a completed sale (does not restore stock automatically)
    void: boolean;
    viewSales: boolean;
  };
  suppliers: {
    view: boolean;
    create: boolean;
    edit: boolean;
    delete: boolean;
    // Book a delivery in: restocks the items and sets their prices
    recordSupply: boolean;
    // Read the goods-received history (what was bought, and at what cost)
    viewSupplies: boolean;
    // Build a purchase-order plan for a supplier and text them to come by
    planOrders: boolean;
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
    // Mark how a distributor settled an order (cash, cheque, credit)
    recordPayments: boolean;
    // Handle "please stock more of this" asks raised from a distributor portal
    manageStockRequests: boolean;
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
    // Read-only: the audit trail of price changes, role changes, invoice
    // edits, and deletions across the business.
    viewAuditLog: boolean;
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

// An owner-defined role beyond the four built-in ones. `baseRole` only
// determines the underlying Firestore data-access ceiling (unchanged,
// governed entirely by firestore.rules); `permissions` is a full,
// independently-editable feature grid — it is not restricted to a subset of
// `baseRole`'s defaults.
export interface CustomRole {
  id: string;
  name: string;
  baseRole: StaffRoleKey;
  permissions: RolePermissions;
  createdAt?: unknown;
  updatedAt?: unknown;
}
