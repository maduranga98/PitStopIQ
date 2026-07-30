import type { Timestamp } from "firebase/firestore";

export type UserRole = "Owner" | "Manager" | "Technician" | "Cashier" | "Receptionist";

export interface ServiceCenter {
  id: string;
  name: string;
  phone: string;
  address: string;
  district: string;
  logoUrl?: string;
  businessRegistrationNumber?: string;
  smsSenderName: string;
  reminderThresholdKm?: number;
  reminderCooldownDays: number;
  // Days since a customer's last service after which they're treated as
  // "inactive" on the Customers list. Configurable per center's customer base;
  // defaults to 90 when unset.
  customerInactiveDays?: number;
  plan: "basic" | "pro";
  createdAt: Date;
  ownerId: string;
  // Multi-branch: the owner's Firebase Auth uid, shared across every branch
  // document that owner has (primary + additional branches).
  ownerUid: string;
  // false = primary branch (the one created at registration, centerId == uid).
  // true = an additional branch provisioned later by the super admin.
  isBranch: boolean;
  // The primary branch's centerId. null for the primary itself.
  primaryCenterId: string | null;
  // Friendly label for additional branches (falls back to `name` if unset).
  branchName?: string;
  // Monthly billing rate for this specific branch document:
  // 7999 primary-pro / 4999 primary-basic / 6999 additional-pro / 4499 additional-basic.
  monthlyRate: number;
  // Soft-delete flag distinct from `status` (billing state). false = the
  // super admin has closed this branch; data is retained, billing stops.
  isActive: boolean;
  // Payment reference code (short unique code for bank transfers)
  paymentCode?: string;
  // Super admin managed fields
  // active: payment current; grace_period: overdue but within 7-day grace;
  // pending_payment: slip uploaded, awaiting verification; blocked: access cut off
  status: "active" | "grace_period" | "pending_payment" | "blocked";
  ownerName?: string;
  ownerPhone?: string;
  registeredByAdminId?: string;
  // Subscription period
  currentPeriodStart?: Timestamp;
  currentPeriodEnd?: Timestamp;
  graceDeadline?: Timestamp;
  lastPaymentVerifiedAt?: Timestamp;
  lastPaymentAmount?: number;
  // SMS quota
  smsQuotaUsed: number;
  smsQuotaLimit: number; // 200 basic / 1000 pro
  // SMS templates (stored as strings; undefined = use default)
  completionSmsTemplate?: string;
  reminderSmsTemplate?: string;
  // Inspection module (Pro only, off by default)
  inspectionEnabled?: boolean;
  // Multi-user settings (Pro only)
  multiUser?: boolean;
  maxStaff?: number;
  // Account deletion
  isDeleted?: boolean;
  deletionScheduledAt?: Timestamp;
  // Set when the Owner has submitted a deletion request that is awaiting super
  // admin approval. Cleared by the super admin if the request is rejected.
  deletionRequestedAt?: Timestamp;
  // Store add-ons — Outlets/POS and Distributors are locked until the owner
  // buys them (payment slip + super admin approval, same flow as the plan
  // itself) and are billed alongside the regular monthly/yearly payment
  // thereafter. Super-admin managed, like the other billing fields.
  storeAddons?: Partial<Record<StoreAddonKey, boolean>>;
  // SMS top-up packages bought as a recurring monthly commitment — count of
  // active subscriptions per package tier (a center can stack more than one).
  // Their combined monthly fee rides along on the regular subscription
  // payment, same as storeAddons. One-time top-ups don't appear here; they
  // only ever bump smsQuotaLimit once.
  smsPackageSubscriptions?: Partial<Record<SmsPackageKey, number>>;
}

// The two purchasable Store add-ons. Each unlocks its section only once its
// StoreAddonRequest has been approved.
export type StoreAddonKey = "outlets" | "distributors";

// SMS top-up packages purchasable from the Store — see lib/subscription for
// pricing. Each can be bought as a one-time top-up (bumps smsQuotaLimit once)
// or as a recurring monthly add-on (bumps smsQuotaLimit once on approval, and
// its price is folded into every subsequent monthly payment, same as a Store
// add-on).
export type SmsPackageKey = "sms500" | "sms1000" | "sms2500" | "sms5000";

export type AccountDeletionRequestStatus = "pending" | "completed" | "rejected";

export interface AccountDeletionRequest {
  id: string;
  centerId: string;
  centerName: string;
  ownerUid: string;
  requestedBy: string;
  requestedByName: string;
  reason?: string;
  status: AccountDeletionRequestStatus;
  createdAt: Timestamp;
  reviewedAt?: Timestamp;
  reviewedBy?: string;
  reviewedByName?: string;
  completedAt?: Timestamp;
  completedBy?: string;
}

export interface SuperAdmin {
  id: string;
  email: string;
  displayName: string;
  createdAt: Timestamp;
}

export type PaymentStatus = "pending" | "paid";
export type PaymentPeriod = "monthly" | "yearly";

export interface ServiceCenterPayment {
  id: string;
  centerId: string;
  amount: number;
  plan: "basic" | "pro";
  period: PaymentPeriod;
  status: PaymentStatus;
  paidAt?: Timestamp;
  markedBy: string; // super admin uid
  markedByName: string;
  notes?: string;
  upgradeRequestId?: string;
  createdAt: Timestamp;
  // The billing month this payment covers, e.g. "2026-07" — distinct from
  // paidAt (when it was actually recorded). Lets the admin mark a payment
  // against the month it's for, even if paid late or in advance.
  forMonth?: string;
}

export type UpgradeRequestStatus = "pending" | "approved" | "rejected";
export type PaymentSlipRequestStatus = "pending" | "confirmed" | "rejected";

export interface PaymentSlipRequest {
  id: string;
  centerId: string;
  centerName: string;
  paymentCode: string;
  plan: "basic" | "pro";
  period: PaymentPeriod;
  amount: number;
  slipUrl: string;
  status: PaymentSlipRequestStatus;
  notes?: string;
  reviewedAt?: Timestamp;
  reviewedBy?: string;
  reviewedByName?: string;
  createdAt: Timestamp;
}

// A one-off purchase request for a Store add-on (Outlets/POS or
// Distributors). Same shape and review flow as PaymentSlipRequest — a bank
// slip the super admin confirms or rejects — but keyed to an add-on instead
// of the plan itself, and confirming it flips servicecenters.storeAddons
// rather than renewing the subscription period.
export type StoreAddonRequestStatus = "pending" | "confirmed" | "rejected";

export interface StoreAddonRequest {
  id: string;
  centerId: string;
  centerName: string;
  paymentCode: string;
  addon: StoreAddonKey;
  amount: number;
  slipUrl: string;
  status: StoreAddonRequestStatus;
  notes?: string;
  reviewedAt?: Timestamp;
  reviewedBy?: string;
  reviewedByName?: string;
  createdAt: Timestamp;
}

// A one-off purchase request for an SMS top-up package. Same review flow as
// StoreAddonRequest — a bank slip the super admin confirms or rejects — but
// keyed to an SMS package tier and carrying the billing choice the owner made
// at purchase time: "one_time" only bumps smsQuotaLimit once; "recurring"
// does the same but also adds the package's monthly fee to every future
// subscription payment (servicecenters.smsPackageSubscriptions).
export type SmsPackageRequestStatus = "pending" | "confirmed" | "rejected";
export type SmsPackageBillingType = "one_time" | "recurring";

export interface SmsPackageRequest {
  id: string;
  centerId: string;
  centerName: string;
  paymentCode: string;
  package: SmsPackageKey;
  billingType: SmsPackageBillingType;
  quota: number;
  amount: number;
  slipUrl: string;
  status: SmsPackageRequestStatus;
  notes?: string;
  reviewedAt?: Timestamp;
  reviewedBy?: string;
  reviewedByName?: string;
  createdAt: Timestamp;
}

// A request from an Owner to have the super admin provision a new branch
// under their account. No payment slip at request time — billing (see
// BRANCH_PRICE in lib/subscription: LKR 6,999/mo Pro, LKR 4,499/mo Basic) is
// settled once the super admin sets the branch up, the same manual process
// as before, but now with a formal request trail instead of an out-of-band
// "contact us" message.
export type BranchRequestStatus = "pending" | "approved" | "rejected";

export interface BranchRequest {
  id: string;
  centerId: string;
  centerName: string;
  ownerUid: string;
  requestedBranchName: string;
  address: string;
  phone: string;
  district: string;
  // Plan the new branch is requested on — determines its monthly rate.
  requestedPlan: "basic" | "pro";
  amount: number;
  notes?: string;
  status: BranchRequestStatus;
  reviewedAt?: Timestamp;
  reviewedBy?: string;
  reviewedByName?: string;
  createdAt: Timestamp;
}

export type PlanChangeType = "upgrade" | "downgrade";

export interface UpgradeRequest {
  id: string;
  centerId: string;
  centerName: string;
  paymentCode: string;
  // The plan the center wants to move to. "pro" = upgrade (payment slip
  // required), "basic" = downgrade (no payment, no slip). Older documents
  // predate downgrades and are always upgrades to "pro".
  requestedPlan: "basic" | "pro";
  // Absent on legacy upgrade docs; derive from requestedPlan when missing.
  type?: PlanChangeType;
  period: PaymentPeriod;
  amount: number;
  // Optional: downgrade requests carry no payment slip.
  slipUrl?: string;
  status: UpgradeRequestStatus;
  notes?: string;
  reviewedAt?: Timestamp;
  reviewedBy?: string;
  reviewedByName?: string;
  createdAt: Timestamp;
}

export interface StaffMember {
  id: string;
  email: string;
  displayName?: string;
  fullName: string;
  phone: string;
  role: UserRole;
  centerId: string;
  active: boolean;
  createdAt: Timestamp;
  lastLoginAt?: Timestamp;
  employeeId?: string;
  dateJoined?: Timestamp;
  notes?: string;
  inviteSent?: boolean;
  hasLogin?: boolean;
  authUid?: string;
  loginPhone?: string;
  // When set, this staff member's in-app feature access comes from a custom
  // role (servicecenters/{centerId}/customRoles/{customRoleId}) rather than
  // the plain default permissions for `role`. `role` itself still holds the
  // custom role's underlying base role, since Firestore security rules key
  // off that field and are unaware of custom roles.
  customRoleId?: string;
  customRoleName?: string;
}

export type AttendanceStatus = "present" | "absent" | "half_day" | "holiday";

export interface AttendanceMonth {
  days: Record<string, AttendanceStatus>; // key = "YYYY-MM-DD"
}

// ── Payroll ──────────────────────────────────────────────────────────────────
// A named earning or deduction line on a payslip (or a role's default
// template) — e.g. { label: "Fuel Allowance", amount: 5000 }.
export interface PayslipComponent {
  label: string;
  amount: number;
}

// Per-role defaults an Owner/Manager can save once and reuse whenever a
// payslip is generated for someone with that role — basic salary, a
// commission rate (since commission structures genuinely differ role to
// role), and a standard set of allowances/deductions. Doc id == the role
// name (UserRole), one per center at
// servicecenters/{centerId}/payrollRoleDefaults/{role}.
export interface PayrollRoleDefaults {
  role: UserRole;
  basicSalary: number;
  /** Default commission rate (%) applied to job revenue for this role, if any. */
  commissionRate?: number;
  allowances: PayslipComponent[];
  deductions: PayslipComponent[];
  centerId: string;
  updatedAt?: Timestamp;
  updatedBy?: string;
  updatedByName?: string;
}

export type PayslipStatus = "draft" | "finalized";

// A generated payslip for one staff member, one calendar month. Customizable
// per person (starts from the role defaults but every figure can be edited),
// and snapshots that month's attendance/jobs/hours so the numbers stay
// accurate even if the underlying records change later. Stored at
// servicecenters/{centerId}/staff/{staffId}/payslips/{payslipId}.
export interface Payslip {
  id: string;
  staffId: string;
  staffName: string;
  role: UserRole;
  employeeId?: string;
  /** "YYYY-MM" the payslip covers. */
  month: string;
  basicSalary: number;
  commissionRate?: number;
  commissionAmount: number;
  allowances: PayslipComponent[];
  deductions: PayslipComponent[];
  grossPay: number;
  totalDeductions: number;
  netPay: number;
  // Snapshot of that month's attendance/jobs, taken when the payslip is
  // generated so it reads correctly even after the month rolls over.
  attendanceRate: number;
  daysPresent: number;
  daysAbsent: number;
  totalJobs: number;
  totalHours: number;
  status: PayslipStatus;
  notes?: string;
  centerId: string;
  createdAt: Timestamp;
  createdBy: string;
  createdByName: string;
  updatedAt?: Timestamp;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: UserRole;
  centerId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
  createdBy: string;
}

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  centerId?: string;
  role?: UserRole;
  centerPlan?: "basic" | "pro";
  customRoleId?: string;
  customRoleName?: string;
}

// A single entry in a vehicle's activity log — either an automatically
// recorded system event (edited, photo added, reminder sent…) or a note a
// staff member left by hand, e.g. something to check or change on the
// vehicle's next visit.
export interface VehicleLogEntry {
  id: string;
  type: "system" | "note";
  message: string;
  // Only meaningful for notes: flags something the next visit should
  // specifically check or address.
  needsFollowUp?: boolean;
  authorName?: string;
  authorRole?: string;
  createdAt: Timestamp;
  // Set when a staff note has been corrected after the fact, so the entry can
  // say so rather than quietly reading as the original wording.
  editedAt?: Timestamp;
  editedByName?: string | null;
}

export type SmsLanguage = "sinhala" | "tamil" | "english";

export interface Customer {
  id: string;
  name: string;
  phone: string;
  nic?: string;
  notes?: string;
  smsLanguage?: SmsLanguage;
  isDeleted: boolean;
  vehicleCount: number;
  lastServiceDate: Timestamp | null;
  createdAt: Timestamp;
  centerId: string;
}

// Built-in categories; centers can also add their own custom categories,
// so vehicleType is stored as a plain string.
export type VehicleType = string;

export type ServiceLibraryCategory =
  | "Engine"
  | "Brakes"
  | "Tyres"
  | "Suspension"
  | "Electrical"
  | "Body"
  | "AC"
  | "General"
  | "Other";

export type ServiceLibraryUnit =
  | "per service"
  | "per litre"
  | "per item"
  | "per hour";

export interface ServicePriceItem {
  id: string;
  name: string;
  description?: string;
  category?: ServiceLibraryCategory;
  defaultPrice: number;
  /** @deprecated Use defaultPrice */
  price?: number;
  unit?: ServiceLibraryUnit;
  isActive?: boolean;
  // When set, this price only applies to vehicles of this type. Multiple
  // entries can share the same `name` — one per vehicle type — plus an
  // optional general entry with no vehicleType used as the fallback price.
  vehicleType?: VehicleType;
  centerId: string;
  createdAt: Timestamp;
}

export interface Vehicle {
  id: string;
  plateNumber: string;
  customerId: string;
  customerName: string;
  make?: string;
  model?: string;
  year?: number;
  vehicleType?: VehicleType;
  colour?: string;
  currentMileageKm: number;
  nextServiceMileageKm: number;
  oilBrand?: string;
  oilGrade?: string;
  oilViscosityNotes?: string;
  qrCodeUrl?: string;
  // True once the stored QR image encodes a resolvable short link
  // (pitstopiq.com/v/{code}). Older QRs encoded the vehicle id, which the
  // /v/ resolver can't map to a customer view, so they are regenerated.
  qrEncodesShortLink?: boolean;
  photoUrls?: string[];
  centerId: string;
  isDeleted: boolean;
  lastServiceDate?: Timestamp | null;
  // Time-based reminder scheduling (derived once a vehicle is serviced twice)
  serviceIntervalDays?: number;
  nextServiceDate?: Timestamp | null;
  reminderSent?: boolean;
  reminderSentAt?: Timestamp | null;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export interface ServiceRecord {
  id: string;
  vehicleId: string;
  plateNumber: string;
  customerId: string;
  serviceType: string;
  status: "pending" | "in_progress" | "done" | "delivered";
  // Lead technician, plus the whole crew when more than one worked the job.
  technicianName?: string;
  technicianNames?: string[];
  totalAmount?: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface SmsLog {
  id: string;
  customerId?: string;
  /** Set instead of customerId for thank-you SMS queued from a distributor order. */
  distributorId?: string;
  customerName: string;
  phone: string;
  vehicleId?: string;
  plateNumber?: string;
  jobId?: string;
  invoiceId?: string;
  /** Set instead of customerId/distributorId for a purchase-order SMS to a supplier. */
  supplierId?: string;
  messageType: "Completion" | "Reminder" | "Invitation" | "ThankYou" | "PurchaseOrder";
  status: "sent" | "delivered" | "failed" | "pending_blackout";
  message: string;
  sentAt: Timestamp;
  errorCode?: string;
  errorMessage?: string;
  providerResponse?: unknown;
  deliveredAt?: Timestamp;
  senderMask?: string;
  /** Optional sender mask override, checked against an approved allowlist server-side. */
  mask?: string;
  esmsTransactionId?: number;
  esmsCampaignId?: string | null;
}

export interface PartUsed {
  itemId: string;
  itemName: string;
  quantity: number;
  /**
   * What the customer is charged per unit — the item's service-center price.
   * Written on every new line; older lines only carry `unitCost`.
   */
  unitPrice?: number;
  /** @deprecated Kept for lines saved before service-center pricing existed. */
  unitCost?: number;
}

export interface RestockEntry {
  addedQty: number;
  addedBy: string;
  timestamp: Timestamp;
  note?: string;
}

// Stock handed to a technician against an approved inventory request. Kept
// apart from deductionLog, which records parts consumed by a specific service.
export interface IssueEntry {
  requestId: string;
  issuedQty: number;
  issuedTo: string;
  issuedBy: string;
  jobRef?: string;
  // Service-center price at the moment of issue, so the value of what left the
  // store room is recoverable even if the price book changes later.
  unitPrice?: number;
  timestamp: Timestamp;
}

export interface DeductionEntry {
  serviceId: string;
  vehicleId: string;
  date: Timestamp;
  qtyDeducted: number;
  remainingQty: number;
}

// Stock handed over to a distributor, either by finalizing one of their
// purchase orders or by releasing it to them directly from the item.
export interface ReleaseEntry {
  distributorId: string;
  distributorName: string;
  releasedQty: number;
  releasedBy: string;
  orderId?: string;
  orderNumber?: string;
  unitPrice?: number;
  timestamp: Timestamp;
  note?: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  // Built-in categories plus whatever the center has added itself, so this is
  // a plain string (see lib/inventoryOptions).
  category: string;
  // Same story as `category`: the built-in units plus whatever the center has
  // added itself (drums, cans, boxes…), so this is a plain string.
  unit: string;
  currentQty: number;
  threshold: number;
  // ── Price book ─────────────────────────────────────────────────────────────
  // One item, five figures: what it cost to buy and the four ways it can be
  // sold on. Every read goes through lib/inventoryPricing so the fallbacks stay
  // in one place — an item saved before this existed only has `unitCost`.
  /** What the center paid the supplier per unit. */
  purchasePrice?: number;
  /** @deprecated Superseded by purchasePrice; still written for old readers. */
  unitCost?: number;
  /** Price a distributor pays. */
  distributorPrice?: number;
  /** Price the center's own retail outlet sells at. */
  outletPrice?: number;
  /** Price billed on a service-center invoice when a technician uses the part. */
  serviceCenterPrice?: number;
  /** Manufacturer's marked price (MRP) printed on the item. */
  markedPrice?: number;
  // false hides the item from every distributor portal. Undefined = shareable.
  availableToDistributors?: boolean;
  // Where the stock comes from. supplierId points at the suppliers collection;
  // the rest is snapshotted so the item still reads correctly if the supplier
  // record is later edited or deactivated.
  supplierId?: string;
  supplierName?: string;
  supplierCompany?: string;
  supplierBrand?: string;
  supplierPhone?: string;
  notes?: string;
  isArchived?: boolean;
  restockLog?: RestockEntry[];
  deductionLog?: DeductionEntry[];
  issueLog?: IssueEntry[];
  releaseLog?: ReleaseEntry[];
  centerId: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export type InventoryRequestStatus = "pending" | "approved" | "rejected";

// A technician asking the workshop for stock. Approving one issues the parts
// and deducts them from the item's current quantity.
export interface InventoryRequest {
  id: string;
  itemId: string;
  itemName: string;
  unit: string;
  quantity: number;
  status: InventoryRequestStatus;
  note?: string;
  // Job the parts are needed for (free text: plate or job number). Kept for
  // requests saved before the vehicle/job picker existed, and as a fallback
  // display string when jobId isn't set.
  jobRef?: string;
  // The vehicle and job this request is for, picked from the center's active
  // jobs. Set together — a job always carries its vehicle. When present, an
  // approved request bills the part onto that job's invoice, not just onto
  // the shelf.
  vehicleId?: string;
  plateNumber?: string;
  jobId?: string;
  jobNumber?: string;
  requestedBy: string;      // staff uid
  requestedByName: string;
  createdAt: Timestamp;
  reviewedAt?: Timestamp;
  reviewedBy?: string;
  reviewedByName?: string;
  reviewNote?: string;
  // Quantity actually issued when approved (may be less than requested).
  issuedQty?: number;
}

// ── Outlets ──────────────────────────────────────────────────────────────────
// A retail counter the center sells stock from directly to walk-in buyers —
// deliberately not linked to a Customer or Vehicle record. It draws from the
// same shared inventory pool as the workshop; an outlet is where a sale
// happens, not a separate stockroom.
export interface Outlet {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  notes?: string;
  isActive: boolean;
  centerId: string;
  createdAt: Timestamp;
  createdBy: string;
  createdByName: string;
  updatedAt?: Timestamp;
  // The staff member who runs this outlet's counter — shown on the terminal
  // receipt/log even though the terminal link itself carries no login.
  assignedCashierId?: string;
  assignedCashierName?: string;
  // Secret token for this outlet's standalone POS terminal link (a separate
  // device at the counter, opened with no staff login — see
  // src/lib/outletsPos.ts). Regenerating it revokes the old link.
  posToken?: string;
  posShortCode?: string;
}

// ── Outlet POS ───────────────────────────────────────────────────────────────
export type PosPaymentMethod = "cash" | "card" | "bank_transfer";
export type PosSaleStatus = "completed" | "voided";

export interface PosSaleLine {
  itemId: string;
  itemName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface PosSale {
  id: string;
  saleNumber: string;
  outletId: string;
  outletName: string;
  items: PosSaleLine[];
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: PosPaymentMethod;
  amountTendered?: number;
  changeDue?: number;
  status: PosSaleStatus;
  soldBy: string;
  soldByName: string;
  voidedAt?: Timestamp;
  voidedBy?: string;
  voidedByName?: string;
  voidReason?: string;
  centerId: string;
  createdAt: Timestamp;
}

// ── Inventory movement ledger (audit trail) ─────────────────────────────────
// One row per stock-changing event, from every source — restock, a
// technician's issued request, a job's parts deduction, a distributor
// release, an outlet POS sale, a physical stock-count adjustment. Written
// once and never edited, so an item's full movement history can be read from
// one place instead of stitched together from the embedded logs above.
export type InventoryMovementType =
  | "restock"
  | "issue"
  | "deduction"
  | "release"
  | "pos_sale"
  | "stock_count";

export interface InventoryMovement {
  id: string;
  itemId: string;
  itemName: string;
  unit: string;
  type: InventoryMovementType;
  // Positive = stock added, negative = stock removed.
  qtyChange: number;
  qtyBefore: number;
  qtyAfter: number;
  outletId?: string;
  outletName?: string;
  /** id of the source doc (posSale, inventoryRequest, supplierSupply, stockCount…) */
  refId?: string;
  refLabel?: string;
  performedBy: string;
  performedByName: string;
  note?: string;
  centerId: string;
  createdAt: Timestamp;
}

// ── Physical stock count ─────────────────────────────────────────────────────
// A snapshot of what's on the shelf versus what the system says, taken by
// walking the floor and counting. Draft while lines are being entered;
// finalizing writes the counted quantities back to inventory (only where they
// differ) and logs each adjustment to the movement ledger, then the count
// itself is immutable.
export interface StockCountLine {
  itemId: string;
  itemName: string;
  unit: string;
  systemQty: number;
  countedQty: number;
  variance: number;
  note?: string;
}

export type StockCountStatus = "draft" | "finalized";

export interface StockCount {
  id: string;
  countNumber: string;
  status: StockCountStatus;
  lines: StockCountLine[];
  note?: string;
  performedBy: string;
  performedByName: string;
  centerId: string;
  createdAt: Timestamp;
  finalizedAt?: Timestamp;
  finalizedBy?: string;
  finalizedByName?: string;
}

// ── Suppliers ────────────────────────────────────────────────────────────────
// Who the workshop buys stock from. A supplier is a rep (name + mobile) acting
// for a company and, usually, a single brand — the way parts are actually
// bought in Sri Lanka. Recording a supply from one both restocks inventory and
// leaves a goods-received record behind.

export interface Supplier {
  id: string;
  /** The rep the workshop actually deals with. */
  name: string;
  companyName: string;
  brand: string;
  mobile: string;
  email?: string;
  address?: string;
  notes?: string;
  isActive: boolean;
  lastSupplyAt?: Timestamp;
  centerId: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

// One line of a supply: an item that arrived, how much of it, and the price
// book it was booked in at. Prices are snapshotted here so a later price change
// never rewrites what a past delivery cost.
export interface SupplyLine {
  itemId: string;
  itemName: string;
  unit: string;
  quantity: number;
  purchasePrice: number;
  lineTotal: number;
  distributorPrice?: number;
  outletPrice?: number;
  serviceCenterPrice?: number;
  markedPrice?: number;
  /** True when this line created the inventory item rather than restocking it. */
  isNewItem: boolean;
}

// How the workshop settled (part of) a delivery. This is money going the other
// way: cash over the counter, a transfer, a cheque written to the supplier, or
// the part taken on credit and still owed to them.
export type SupplierPaymentMethod = "cash" | "bank_transfer" | "cheque" | "credit";

export interface SupplierPayment {
  id: string;
  method: SupplierPaymentMethod;
  amount: number;
  /** When the money went out (or the credit was agreed). */
  date: Timestamp;
  note?: string;
  // Cheque only — all four are required when method is "cheque".
  chequeNumber?: string;
  bank?: string;
  branch?: string;
  /** The date written on the cheque: the day the account must be funded. */
  chequeDate?: Timestamp;
  // Cheque and credit only. "cleared" = the supplier's bank took the money /
  // the credit was settled; "returned" = the cheque bounced or was cancelled.
  clearance?: PaymentClearance;
  clearedAt?: Timestamp;
  clearedBy?: string;
  clearedByName?: string;
  returnedAt?: Timestamp;
  returnedBy?: string;
  returnedByName?: string;
  returnReason?: string;
  recordedBy: string;
  recordedByName: string;
  recordedAt: Timestamp;
}

export type SupplierPaymentStatus = "unpaid" | "partial" | "paid";

export interface SupplierSupply {
  id: string;
  /** Goods-received number, e.g. GRN-2607-0004. */
  supplyNumber: string;
  supplierId: string;
  supplierName: string;
  supplierCompany: string;
  supplierBrand?: string;
  items: SupplyLine[];
  total: number;
  /** The supplier's own invoice / bill reference. */
  invoiceRef?: string;
  note?: string;
  // How the delivery was settled. Same shape as an invoice's ledger, read the
  // same way: the entries are the truth and the three totals below are
  // re-derived from them on every write (see lib/supplierPayments).
  payments?: SupplierPayment[];
  /** Money actually paid out — cash, transfers and cheques that didn't bounce. */
  paidTotal?: number;
  /** Still owed to the supplier on credit. */
  creditTotal?: number;
  balanceDue?: number;
  paymentStatus?: SupplierPaymentStatus;
  centerId: string;
  createdAt: Timestamp;
  createdBy: string;
  createdByName: string;
}

// ── Distributors ─────────────────────────────────────────────────────────────
// A distributor takes stock off the owner's hands and sells it on. They have no
// login: the owner shares a link that opens a read-only catalog where the
// distributor builds a purchase order. Nothing leaves the store room until the
// owner finalizes that order.

export interface Distributor {
  id: string;
  name: string;
  contactPerson?: string;
  phone: string;
  email?: string;
  address?: string;
  notes?: string;
  isActive: boolean;
  // Secret half of the share link. Regenerating it invalidates every link the
  // distributor already has, which is how access is revoked.
  accessToken: string;
  // Short code minted in `links/{code}` so the owner can share a tiny URL.
  shortCode?: string;
  // false takes the portal offline without deleting the distributor.
  portalEnabled: boolean;
  lastOrderAt?: Timestamp;
  centerId: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export type DistributorOrderStatus = "submitted" | "finalized" | "rejected" | "cancelled";

export interface DistributorOrderItem {
  itemId: string;
  itemName: string;
  unit: string;
  // What the distributor asked for.
  requestedQty: number;
  // What the owner is actually releasing. Starts equal to requestedQty and can
  // be trimmed during review — 0 drops the line from the release.
  approvedQty: number;
  unitPrice: number;
  lineTotal: number;
}

// How a distributor settled (part of) an order. An order can carry any mix:
// some cash now, a cheque for the rest, the remainder on credit.
//   cash   — money handed over
//   cheque — a cheque received; not money until it clears, but recorded in full
//   credit — the portion explicitly taken on credit, still owed
export type DistributorPaymentMethod = "cash" | "cheque" | "credit";

export interface DistributorPayment {
  // Stable id so a mis-keyed entry can be removed from the array.
  id: string;
  method: DistributorPaymentMethod;
  amount: number;
  // When the money changed hands (or the credit was agreed).
  date: Timestamp;
  note?: string;
  // Cheque only — all four are required when method is "cheque".
  chequeNumber?: string;
  bank?: string;
  branch?: string;
  chequeDate?: Timestamp;
  // Cheque and credit only — same three states as an invoice payment, tracked
  // from the cheque & credit register.
  clearance?: PaymentClearance;
  clearedAt?: Timestamp;
  clearedBy?: string;
  clearedByName?: string;
  returnedAt?: Timestamp;
  returnedBy?: string;
  returnedByName?: string;
  returnReason?: string;
  recordedBy: string;
  recordedByName: string;
  recordedAt: Timestamp;
}

export type DistributorPaymentStatus = "unpaid" | "partial" | "paid";

export interface DistributorOrder {
  id: string;
  orderNumber: string;
  distributorId: string;
  distributorName: string;
  distributorPhone?: string;
  items: DistributorOrderItem[];
  note?: string;
  status: DistributorOrderStatus;
  // Total of the approved quantities — recomputed whenever the owner edits.
  total: number;
  payments?: DistributorPayment[];
  // Denormalised from `payments` on every write so the list and the portal can
  // show balances without re-summing, and so a cashier's write touches a fixed
  // set of keys the security rules can whitelist.
  // receivedTotal counts cash + cheques — actual money in. Credit is tracked
  // separately because it is a promise, not a payment, and still counts
  // towards the balance due.
  receivedTotal?: number;
  creditTotal?: number;
  balanceDue?: number;
  paymentStatus?: DistributorPaymentStatus;
  // "portal" = built by the distributor from their link; "staff" = raised in
  // the app on their behalf.
  createdVia: "portal" | "staff";
  centerId: string;
  createdAt: Timestamp;
  reviewNote?: string;
  reviewedAt?: Timestamp;
  reviewedBy?: string;
  reviewedByName?: string;
  finalizedAt?: Timestamp;
}

export type DistributorStockRequestStatus =
  | "pending"       // waiting for the workshop to look at it
  | "acknowledged"  // seen, more stock is on the way
  | "fulfilled"     // the stock is in and the distributor can order it
  | "declined";

// A distributor can only order what's on the shelf. When they need more than
// that, this is how they ask for it — a nudge to the workshop, not an order:
// nothing is reserved and no stock moves.
export interface DistributorStockRequest {
  id: string;
  distributorId: string;
  distributorName: string;
  itemId: string;
  itemName: string;
  unit: string;
  requestedQty: number;
  /** What was on the shelf when they asked — context for the reviewer. */
  availableQtyAtRequest: number;
  note?: string;
  status: DistributorStockRequestStatus;
  reviewNote?: string;
  reviewedAt?: Timestamp;
  reviewedBy?: string;
  reviewedByName?: string;
  centerId: string;
  createdAt: Timestamp;
}

// A complaint or suggestion a customer leaves from their public view (no
// login) — see submitCustomerFeedback in functions/index.js.
export type CustomerFeedbackType = "complaint" | "suggestion";
export type CustomerFeedbackStatus = "new" | "reviewed" | "resolved";

export interface CustomerFeedback {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  type: CustomerFeedbackType;
  message: string;
  status: CustomerFeedbackStatus;
  reviewedAt?: Timestamp;
  reviewedBy?: string;
  reviewedByName?: string;
  centerId: string;
  createdAt: Timestamp;
}

// ── Purchase order planning ─────────────────────────────────────────────────
// Buying from a supplier is naturally a per-supplier batch, not a per-item
// errand: one low-stock item is the reason to plan an order, but everything
// else that supplier carries should go on the same trip. A plan is a working
// document, not a permanent record — the goods-received note written by
// recordSupply() when the order actually arrives is the record that lasts;
// once that happens the plan itself is deleted (see lib/purchaseOrderPlans).

export type PurchaseOrderPlanStatus = "draft" | "sent";

export interface PurchaseOrderPlanLine {
  itemId: string;
  itemName: string;
  unit: string;
  category: string;
  /** Snapshot of stock levels at planning time, for context only. */
  currentQty: number;
  threshold: number;
  requestedQty: number;
}

// One doc per supplier (doc id == supplierId) so items added from separate
// low-stock alerts for the same supplier accumulate onto one order instead of
// spawning duplicates.
export interface PurchaseOrderPlan {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierCompany: string;
  supplierBrand?: string;
  supplierPhone: string;
  lines: PurchaseOrderPlanLine[];
  note?: string;
  status: PurchaseOrderPlanStatus;
  smsSentAt?: Timestamp;
  centerId: string;
  createdAt: Timestamp;
  createdBy: string;
  createdByName: string;
  updatedAt?: Timestamp;
  updatedBy?: string;
  updatedByName?: string;
}

export interface ServiceJob {
  id: string;
  jobNumber: string;
  vehicleId: string;
  plateNumber: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  make: string;
  model: string;
  year: number;
  // Snapshotted from the vehicle when the job is created, so per-vehicle-type
  // catalog prices can be re-resolved for this job's invoice.
  vehicleType?: VehicleType;
  mileageIn: number;
  mileageOut?: number;
  nextServiceMileageKm?: number;
  oilBrand?: string;
  oilGrade?: string;
  oilViscosityNotes?: string;
  // A service is rarely one person's work — a wash, a brake job and an AC
  // regas on the same car can be three technicians. The full crew lives in
  // technicianIds/technicianNames; technicianId/technicianName mirror the
  // first of them (the lead) so every reader written before crews existed —
  // reports, the employee page, older builds — keeps working untouched.
  technicianId: string;
  technicianName: string;
  technicianIds?: string[];
  technicianNames?: string[];
  // Who should conduct the vehicle inspection for this job. Optional — the
  // owner or whoever created the job may name someone, otherwise any
  // technician on the job (or anyone with inspection.conduct) can do it.
  inspectorId?: string;
  inspectorName?: string;
  services: string[];
  customServices: string[];
  internalNotes?: string;
  status: "pending" | "in_progress" | "done" | "delivered";
  partsUsed: PartUsed[];
  smsSent: boolean;
  startedAt?: Timestamp;
  completedAt?: Timestamp;
  deliveredAt?: Timestamp;
  centerId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface InvoiceLineItem {
  description: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export type InvoiceStatus = "pending" | "partial" | "paid";
export type DiscountType = "amount" | "percent";

// How a customer settled (part of) an invoice. One invoice can carry any mix:
// some cash at the counter, a cheque for the rest, the remainder on credit.
//   cash          — money handed over
//   card          — card machine at the counter
//   bank_transfer — money sent to the center's account
//   cheque        — a cheque received; recorded in full, with its own details
//   credit        — the portion explicitly taken on credit, still owed
export type InvoicePaymentMethod = "cash" | "card" | "bank_transfer" | "cheque" | "credit";

// Cash, a card and a transfer are done the moment they're taken. A cheque and a
// credit are not: the cheque still has to clear, and the credit still has to be
// collected. Both sit "pending" until an Owner or Manager confirms it came in.
// Absent on an entry that needs no confirmation, and read as "pending" on a
// cheque or credit saved before confirmation existed.
//   pending  — handed over, nothing has happened yet
//   cleared  — the bank paid it / the tab was collected
//   returned — the cheque bounced, or the credit was written back. It never
//              became money, so it drops out of every received total.
export type PaymentClearance = "pending" | "cleared" | "returned";

export interface InvoicePayment {
  // Stable id so a mis-keyed entry can be removed from the array.
  id: string;
  method: InvoicePaymentMethod;
  amount: number;
  // When the money changed hands (or the credit was agreed).
  date: Timestamp;
  note?: string;
  // Cheque only — all four are required when method is "cheque".
  chequeNumber?: string;
  bank?: string;
  branch?: string;
  chequeDate?: Timestamp;
  // Cheque and credit only.
  clearance?: PaymentClearance;
  clearedAt?: Timestamp;
  clearedBy?: string;
  clearedByName?: string;
  // Set when the cheque bounced (or the credit was written back).
  returnedAt?: Timestamp;
  returnedBy?: string;
  returnedByName?: string;
  returnReason?: string;
  recordedBy: string;
  recordedByName: string;
  recordedAt: Timestamp;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  serviceId?: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  vehicleId: string;
  plateNumber: string;
  serviceDate: Timestamp;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  discount: number;
  discountType: DiscountType;
  tax: number;
  grandTotal: number;
  status: InvoiceStatus;
  paidAmount: number;
  balanceDue: number;
  // How the invoice was settled. Once any entry exists these are the source of
  // truth: paidAmount, balanceDue and status are all re-derived from them on
  // every write (see lib/invoicePayments), so the ledger and the totals can
  // never drift apart. Invoices settled before this existed simply have none.
  payments?: InvoicePayment[];
  // Denormalised from `payments` so lists and reports don't have to re-sum.
  // receivedTotal counts cash, card, transfers and cheques — actual money in.
  // Credit is a promise, not a payment, so it is tracked apart and still
  // counts towards the balance due.
  receivedTotal?: number;
  creditTotal?: number;
  paidAt?: Timestamp;
  pdfUrl?: string;
  pdfGeneratedAt?: Timestamp;
  centerId: string;
  finalized?: boolean;
  finalizedAt?: Timestamp;
  smsSent?: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ── Quotations ───────────────────────────────────────────────────────────────
// A quotation is a pre-work estimate given to a customer. It shares the same
// line-item/discount/tax shape as an Invoice, but carries no payment ledger —
// it's not a bill until the customer accepts and a real invoice is raised.
export type QuotationStatus = "draft" | "sent" | "accepted" | "rejected" | "expired";

export interface Quotation {
  id: string;
  quotationNumber: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  vehicleId: string;
  plateNumber: string;
  quoteDate: Timestamp;
  validUntil?: Timestamp;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  discount: number;
  discountType: DiscountType;
  tax: number;
  grandTotal: number;
  status: QuotationStatus;
  notes?: string;
  centerId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ── Vehicle Inspection (Pro only) ────────────────────────────────────────────

export type FuelLevel = "empty" | "quarter" | "half" | "three_quarter" | "full";
export type OverallCondition = "good" | "minor_damage" | "major_damage";
export type ChecklistStatus = "ok" | "needs_attention" | "damaged";

export interface ChecklistItem {
  item: string;
  status: ChecklistStatus;
}

export interface DamageReport {
  id: string;
  location: string;
  description: string;
  photoUrl: string | null;
  photoDeleteAt: Timestamp;
  photosDeleted: boolean;
}

export interface VehicleInspection {
  conductedBy: string;
  completedAt: Timestamp;
  fuelLevel: FuelLevel;
  odometerReading: number;
  overallCondition: OverallCondition;
  checklistItems: ChecklistItem[];
  damageReports: DamageReport[];
  notes: string | null;
  skipped: boolean;
  nextPhotoDeleteAt?: Timestamp;
  photosDeleted?: boolean;
}

export const INSPECTION_CHECKLIST_ITEMS = [
  "Front Left Tyre",
  "Front Right Tyre",
  "Rear Left Tyre",
  "Rear Right Tyre",
  "Windscreen",
  "Front Bumper",
  "Rear Bumper",
  "Left Side Panels",
  "Right Side Panels",
  "Front Lights",
  "Rear Lights",
  "Left Mirror",
  "Right Mirror",
  "Interior / Seats",
  "Dashboard",
] as const;

export const SRI_LANKA_DISTRICTS = [
  "Ampara", "Anuradhapura", "Badulla", "Batticaloa", "Colombo",
  "Galle", "Gampaha", "Hambantota", "Jaffna", "Kalutara",
  "Kandy", "Kegalle", "Kilinochchi", "Kurunegala", "Mannar",
  "Matale", "Matara", "Monaragala", "Mullaitivu", "Nuwara Eliya",
  "Polonnaruwa", "Puttalam", "Ratnapura", "Trincomalee", "Vavuniya",
] as const;
